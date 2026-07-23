// agent-stream.ts — /agent-stream.json 的规范化事件 tail 引擎（实时流查看的数据源）。
//
// 数据源 = transcript 文件的增量 tail（非 pty）：各 harness 的 session 文件本地实时追加，server
//   按字节偏移增量读取 + 解析成规范化事件，前端只渲染。事后回放与实时是同一条代码路径。
//
// 三种读取模式（server 无状态·cursor/before 都是字节偏移，页与页平铺不重叠不撕裂）：
//   · tail    —— cursor 省略/为 'tail'：只读文件末尾最后 ~64KiB（大文件绝不整读），出最新一屏。
//   · forward —— cursor=<n>：从 n（上一页 cursor.next）向后增量，追新。
//   · backward—— before=<n>：读 [行首对齐, n) 区间，往前翻历史。
//   常规页单次响应封顶 ≤200 事件 / ≤256KiB 扫描，其余留给下一轮 cursor。
//
// 超长单行（真实 claude transcript 有 >1MiB 的 tool_result 行、实测最长 2.5MiB）：常规窗内找不到
//   任何行首时，用独立的行边界扫描预算（GIANT_LINE_SCAN=4MiB）定位该行的起止并整行读入解析
//   （事件正文仍截 4KiB）；超过 4MiB 的病态行降级为 raw 头部片段（truncated）。**任何一页的
//   cursor 都严格前进**（空事件中间页也前进）——消费方以 prev/next 推进、不得假设页页有事件。
//
// 保真红线：解析不了的行 → kind:'raw' 截断透传（unknown 不猜）；文件截断/轮转（cursor>size）→ reset。
//   源信息全收在 source 对象里，cursor 语义留给将来换源（run-store journal）不绑死「文件」。

import * as fs from 'node:fs';
import { CURSOR_HARNESSES, locateTranscriptFile } from '../agent-probe.js';

export const AGENT_STREAM_SCHEMA = 'ccm/web-viewer-agent-stream/v1';

const TAIL_BYTES = 64 * 1024; // tail / backward 单窗字节上限（绝不整读大文件）
const MAX_SCAN = 256 * 1024; // 常规页单次响应扫描字节上限
const GIANT_LINE_SCAN = 4 * 1024 * 1024; // 超长单行的边界搜索/整行解析预算（真实见过 2.5MiB 单行）
const MAX_EVENTS = 200; // 单次响应事件上限
const TEXT_MAX = 4096; // 单事件正文截断（含 base64/二进制样式超长值）
const DETAIL_MAX = 4096; // 事件 detail 截断
const PREVIEW_MAX = 512; // 工具调用入参一行预览截断
const DEFAULT_FRESHNESS_SEC = 300; // live 判活窗（mtime 新鲜度）

// 规范化事件（parser 出的纯形状·不含 id/offset——id 由 tailer 按行偏移赋，保证 parser 纯可测）。
export interface NormalizedEvent {
  kind: 'user' | 'assistant' | 'thinking' | 'tool' | 'tool_result' | 'system' | 'raw';
  title: string;
  text: string;
  detail?: string;
  ts?: string;
}

// 带 id 的对外事件（id = `${行起始字节}.${行内块序号}`·稳定 key·跨页不重复）。
interface StreamEvent extends NormalizedEvent {
  id: string;
  truncated?: boolean;
}

export interface AgentStreamRequest {
  agentId: string;
  harness: string;
  handleKind: string;
  handleValue: string;
  transcriptRef: string | null;
  cursorParam?: string | null; // 'tail' | 数字字符串 | null
  beforeParam?: string | null; // 数字字符串 | null
  env?: Record<string, string | undefined>;
  nowMs?: number;
  freshnessSec?: number;
}

export interface AgentStreamPayload {
  schema: string;
  agent_id: string;
  mode: 'tail' | 'forward' | 'backward' | 'none';
  source: {
    kind: 'transcript' | 'none';
    harness: string;
    path?: string;
    size?: number;
    mtime?: string;
    /** 文件身份（inode）——client 对比相邻页识别轮转（truncate 后再涨过旧 cursor 的形状）。 */
    ino?: number;
    reason?: string;
  };
  live: { active: boolean; as_of: string };
  cursor: { next: number; prev: number; at_start: boolean };
  events: StreamEvent[];
  reset: boolean;
}

// ── 截断助手 ────────────────────────────────────────────────────────────────────────────────

function clip(value: unknown, max: number): { text: string; truncated: boolean } {
  const s = typeof value === 'string' ? value : value == null ? '' : stringifyCompact(value);
  if (s.length <= max) return { text: s, truncated: false };
  // codepoint 安全截断：切点落在 surrogate pair 中间会产生孤立高位半对（lone surrogate·
  //   JSON.stringify 输出非法 UTF-8）——回退一位保持 well-formed。
  let end = max;
  const last = s.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return { text: `${s.slice(0, end)}…`, truncated: true };
}

function stringifyCompact(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// ── claude-code parser ──────────────────────────────────────────────────────────────────────
//   顶层 {type:user|assistant|system|summary, message:{role,content}, timestamp}。
//   message.content 为 string 或 block 数组（text / thinking / tool_use / tool_result）。
//   一行可含多个 content block → 多个事件。噪声顶层类型（queue-operation 等）→ 丢弃。

const CLAUDE_NOISE = new Set([
  'queue-operation',
  'last-prompt',
  'attachment',
  'file-history-snapshot',
  'x-cc-master-meta',
]);

function claudeToolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (isRecord(block)) {
          if (typeof block.text === 'string') return block.text;
          if (block.type === 'image') return '[image]';
          return stringifyCompact(block);
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return content == null ? '' : stringifyCompact(content);
}

function claudeBlocks(blocks: unknown[], role: string): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];
  for (const block of blocks) {
    if (typeof block === 'string') {
      out.push({ kind: role === 'user' ? 'user' : 'assistant', title: role, text: block });
      continue;
    }
    if (!isRecord(block)) continue;
    switch (block.type) {
      case 'text':
        out.push({
          kind: role === 'user' ? 'user' : 'assistant',
          title: role,
          text: str(block.text),
        });
        break;
      case 'thinking': {
        const thinking = str(block.thinking);
        if (thinking) out.push({ kind: 'thinking', title: 'thinking', text: thinking });
        break;
      }
      case 'tool_use':
        out.push({
          kind: 'tool',
          title: str(block.name) || 'tool',
          text: str(block.name) || 'tool',
          detail: stringifyCompact(block.input),
        });
        break;
      case 'tool_result':
        out.push({
          kind: 'tool_result',
          title: 'tool result',
          text: claudeToolResultText(block.content),
        });
        break;
      case 'image':
        out.push({ kind: role === 'user' ? 'user' : 'assistant', title: role, text: '[image]' });
        break;
      default:
        out.push({ kind: 'raw', title: str(block.type) || 'block', text: stringifyCompact(block) });
    }
  }
  return out;
}

function parseClaudeLine(raw: string): NormalizedEvent[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return [{ kind: 'raw', title: 'raw', text: raw }];
  }
  if (!isRecord(obj)) return [{ kind: 'raw', title: 'raw', text: raw }];
  const type = str(obj.type);
  if (CLAUDE_NOISE.has(type)) return [];
  const ts = str(obj.timestamp) || undefined;
  const message = isRecord(obj.message) ? obj.message : null;

  let events: NormalizedEvent[];
  if (type === 'user' || type === 'assistant') {
    const role = type;
    const content = message?.content;
    if (typeof content === 'string') {
      events = [{ kind: role === 'user' ? 'user' : 'assistant', title: role, text: content }];
    } else if (Array.isArray(content)) {
      events = claudeBlocks(content, role);
    } else {
      events = [];
    }
  } else if (type === 'system') {
    const text = str(obj.content) || str(obj.subtype) || stringifyCompact(obj);
    events = [{ kind: 'system', title: 'system', text }];
  } else if (type === 'summary') {
    events = [{ kind: 'system', title: 'summary', text: str(obj.summary) }];
  } else {
    events = [{ kind: 'raw', title: type || 'raw', text: raw }];
  }
  for (const e of events) if (ts && !e.ts) e.ts = ts;
  return events;
}

// ── codex parser ────────────────────────────────────────────────────────────────────────────
//   顶层 {timestamp, type, payload}。type=response_item 是各版本都在的模型 I/O 记录（canonical）。
//   event_msg 是 response_item 的派生重复视图（agent_message 文本同样在 response_item message）→ 跳过防重复。
//   session_meta / turn_context = 配置噪声 → 跳过。

function codexMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (isRecord(block) && typeof block.text === 'string' ? block.text : ''))
      .filter(Boolean)
      .join('');
  }
  return '';
}

function codexOutputText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (isRecord(output)) {
    if (typeof output.output === 'string') return output.output;
    if (typeof output.content === 'string') return output.content;
    return stringifyCompact(output);
  }
  return output == null ? '' : stringifyCompact(output);
}

function codexReasoningText(summary: unknown): string {
  if (!Array.isArray(summary)) return '';
  return summary
    .map((s) =>
      typeof s === 'string' ? s : isRecord(s) && typeof s.text === 'string' ? s.text : '',
    )
    .filter(Boolean)
    .join('\n');
}

function parseCodexLine(raw: string): NormalizedEvent[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return [{ kind: 'raw', title: 'raw', text: raw }];
  }
  if (!isRecord(obj)) return [{ kind: 'raw', title: 'raw', text: raw }];
  const topType = str(obj.type);
  const ts = str(obj.timestamp) || undefined;

  // 非 response_item：event_msg（重复视图）/ session_meta / turn_context 都跳过。
  if (topType !== 'response_item') return [];
  const payload = isRecord(obj.payload) ? obj.payload : null;
  if (!payload) return [];
  const pt = str(payload.type);

  let events: NormalizedEvent[] = [];
  switch (pt) {
    case 'message': {
      const role = str(payload.role);
      const text = codexMessageText(payload.content);
      if (!text) break;
      if (role === 'assistant') events = [{ kind: 'assistant', title: 'assistant', text }];
      else if (role === 'user') events = [{ kind: 'user', title: 'user', text }];
      else events = [{ kind: 'system', title: role || 'system', text }];
      break;
    }
    case 'reasoning': {
      const text = codexReasoningText(payload.summary);
      if (text) events = [{ kind: 'thinking', title: 'reasoning', text }];
      break;
    }
    case 'function_call':
      events = [
        {
          kind: 'tool',
          title: str(payload.name) || 'tool',
          text: str(payload.name) || 'tool',
          detail: str(payload.arguments),
        },
      ];
      break;
    case 'custom_tool_call':
      events = [
        {
          kind: 'tool',
          title: str(payload.name) || 'tool',
          text: str(payload.name) || 'tool',
          detail: str(payload.input),
        },
      ];
      break;
    case 'function_call_output':
    case 'custom_tool_call_output':
      events = [
        { kind: 'tool_result', title: 'tool result', text: codexOutputText(payload.output) },
      ];
      break;
    case 'web_search_call': {
      const action = isRecord(payload.action) ? payload.action : null;
      events = [
        {
          kind: 'tool',
          title: 'web_search',
          text: str(action?.query) || 'web_search',
          detail: stringifyCompact(payload.action),
        },
      ];
      break;
    }
    case 'tool_search_call':
      events = [
        {
          kind: 'tool',
          title: 'tool_search',
          text: 'tool_search',
          detail: stringifyCompact(payload.arguments),
        },
      ];
      break;
    case 'tool_search_output':
      events = [
        { kind: 'tool_result', title: 'tool_search result', text: '[tool search results]' },
      ];
      break;
    default:
      events = [{ kind: 'raw', title: pt || 'raw', text: raw }];
  }
  for (const e of events) if (ts && !e.ts) e.ts = ts;
  return events;
}

// ── kimi-code parser ──────────────────────────────────────────────────────────────────────────
//   wire.jsonl（`sessions/<wd>/<sid>/agents/main/wire.jsonl`）是 kimi 的**内部 typed 转录**，
//   非 `kimi -p --output-format stream-json` 的 OpenAI-message 形状。顶层 {type, time?}。会话内容分两处：
//     · context.append_message {message:{role, content:[{type:'text',text}]}} —— 规范消息（实测仅 user）。
//     · context.append_loop_event {event:{type, …}} —— 一个 turn 的流式产出：
//         content.part {part:{type:'text',text}|{type:'think',think}} · tool.call {name,args,…} ·
//         tool.result {result:{output,note}} · step.begin/step.end（turn-step 遥测，非会话内容）。
//   丢弃：turn.prompt（user 输入的重复触发视图·append_message 才是规范来源）+ metadata/config/permission/
//   tools.*/llm.*/usage.record/turn.cancel（配置与遥测噪声）。解析不了 / 未知 → raw 透传（保真·不猜）。
//   time 是 epoch ms（数值）→ 转 ISO 挂到 event.ts（claude/codex 是 ISO 字符串，此处对齐）。

const KIMI_NOISE = new Set([
  'metadata',
  'config.update',
  'permission.set_mode',
  'tools.set_active_tools',
  'tools.update_store',
  'llm.request',
  'llm.tools_snapshot',
  'usage.record',
  'turn.cancel',
  'turn.prompt', // user 输入的重复触发视图——context.append_message 是规范来源，跳过防重复。
]);

function kimiMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (isRecord(block) && typeof block.text === 'string' ? block.text : ''))
      .filter(Boolean)
      .join('');
  }
  return '';
}

// wire.jsonl 的 time / created_at 是 epoch ms 数值；转 ISO（去毫秒·对齐 claude/codex 的字符串 ts）。
function kimiTs(obj: Record<string, unknown>): string | undefined {
  const t = obj.time ?? obj.created_at;
  if (typeof t === 'number' && Number.isFinite(t)) {
    return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  return typeof t === 'string' && t ? t : undefined;
}

function kimiLoopEvent(event: Record<string, unknown>, raw: string): NormalizedEvent[] {
  const et = str(event.type);
  switch (et) {
    case 'content.part': {
      const part = isRecord(event.part) ? event.part : null;
      if (!part) return [];
      const pt = str(part.type);
      if (pt === 'think') {
        const think = str(part.think);
        return think ? [{ kind: 'thinking', title: 'thinking', text: think }] : [];
      }
      if (pt === 'text') {
        const text = str(part.text);
        return text ? [{ kind: 'assistant', title: 'assistant', text }] : [];
      }
      // 未知 part 变体 → raw 透传（保真·不静默丢弃新内容类型）。
      return [{ kind: 'raw', title: `content.part:${pt || 'part'}`, text: raw }];
    }
    case 'tool.call':
      return [
        {
          kind: 'tool',
          title: str(event.name) || 'tool',
          text: str(event.name) || 'tool',
          detail: stringifyCompact(event.args),
        },
      ];
    case 'tool.result': {
      const result = isRecord(event.result) ? event.result : null;
      const text =
        result && typeof result.output === 'string'
          ? result.output
          : result
            ? stringifyCompact(result.output ?? result)
            : stringifyCompact(event.result);
      return [{ kind: 'tool_result', title: 'tool result', text }];
    }
    case 'step.begin':
    case 'step.end':
      return []; // turn-step 遥测（usage / latency）——非会话内容，丢弃。
    default:
      return [{ kind: 'raw', title: et || 'loop-event', text: raw }]; // 未知 loop 事件 → raw 保真。
  }
}

function parseKimiLine(raw: string): NormalizedEvent[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return [{ kind: 'raw', title: 'raw', text: raw }];
  }
  if (!isRecord(obj)) return [{ kind: 'raw', title: 'raw', text: raw }];
  const type = str(obj.type);
  if (KIMI_NOISE.has(type)) return [];
  const ts = kimiTs(obj);

  let events: NormalizedEvent[];
  if (type === 'context.append_message') {
    const message = isRecord(obj.message) ? obj.message : null;
    const role = message ? str(message.role) : '';
    const text = message ? kimiMessageText(message.content) : '';
    if (!text) events = [];
    else if (role === 'assistant') events = [{ kind: 'assistant', title: 'assistant', text }];
    else if (role === 'user') events = [{ kind: 'user', title: 'user', text }];
    else events = [{ kind: 'system', title: role || 'system', text }];
  } else if (type === 'context.append_loop_event') {
    const event = isRecord(obj.event) ? obj.event : null;
    events = event ? kimiLoopEvent(event, raw) : [];
  } else {
    events = [{ kind: 'raw', title: type || 'raw', text: raw }];
  }
  for (const e of events) if (ts && !e.ts) e.ts = ts;
  return events;
}

// ── transcript 纯文本 fallback（未知 harness / cursor 短期外部 transcript）：整行为 raw 事件 ──────────
function parseRawLine(raw: string): NormalizedEvent[] {
  if (!raw.trim()) return [];
  return [{ kind: 'raw', title: 'line', text: raw }];
}

export function parserFor(harness: string): (raw: string) => NormalizedEvent[] {
  if (harness === 'claude-code') return parseClaudeLine;
  // origin = 宿主 Claude Code 会话内的派发（subagent / background-shell）——subagent 独立转录
  // 的行结构就是主 claude 格式（多 isSidechain/agentId 信封字段，parser 天然容忍）。
  if (harness === 'origin') return parseClaudeLine;
  if (harness === 'codex') return parseCodexLine;
  // kimi-code：wire.jsonl 是内部 typed 转录（可结构化·见上）。
  if (harness === 'kimi-code') return parseKimiLine;
  // cursor（cursor-agent）：结构化需 SQLite state.vscdb reader（未实现）；短期以外部纯文本
  //   transcript 走 raw fallback（源定位见 agent-probe.ts 的 CURSOR_TRANSCRIPT_PATH / transcript_ref）。
  return parseRawLine;
}

// ── 行切分（按 Buffer 字节偏移·多字节 UTF-8 安全）──────────────────────────────────────────────
//   buf 从 baseOffset 起（baseOffset 必须落在行首）；返回完整行 + 各自全局字节区间。
//   末尾残行（无收尾 \n）留给下一页，不纳入 lines、不计入 consumedEnd。

interface RawLine {
  text: string;
  start: number; // 全局字节起始
  end: number; // 全局字节终止（含 \n 的下一位）
}

function splitLines(buf: Buffer, baseOffset: number): { lines: RawLine[]; consumedEnd: number } {
  const lines: RawLine[] = [];
  let lineStart = 0; // buf 内相对偏移
  let consumed = 0; // buf 内已消费到（含最后 \n 的下一位）
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) {
      const text = buf.toString('utf8', lineStart, i);
      lines.push({ text, start: baseOffset + lineStart, end: baseOffset + i + 1 });
      lineStart = i + 1;
      consumed = i + 1;
    }
  }
  return { lines, consumedEnd: baseOffset + consumed };
}

// 把规范化事件按行偏移赋 id + 施加截断（正文 / detail / base64 超长值）。
function materialize(events: NormalizedEvent[], lineStart: number): StreamEvent[] {
  return events.map((e, idx) => {
    const body = clip(e.text, TEXT_MAX);
    let truncated = body.truncated;
    const out: StreamEvent = {
      id: `${lineStart}.${idx}`,
      kind: e.kind,
      title: clip(e.title, PREVIEW_MAX).text,
      text: body.text,
    };
    if (e.ts) out.ts = e.ts;
    if (e.detail !== undefined) {
      const d = clip(e.detail, DETAIL_MAX);
      out.detail = d.text;
      truncated = truncated || d.truncated;
    }
    if (truncated) out.truncated = true;
    return out;
  });
}

// 从 lines 生成事件·施加事件上限。keepTail=true（tail/backward）超限时丢最旧、保留最新贴近末端的一批；
//   keepTail=false（forward）超限时从头保留、多余行不消费（下一页 forward 续读）。
//   返回 {events, firstKeptStart, lastKeptEnd}。
function collectEvents(
  lines: RawLine[],
  parser: (raw: string) => NormalizedEvent[],
  keepTail: boolean,
): { events: StreamEvent[]; firstKeptStart: number | null; lastKeptEnd: number | null } {
  interface PerLine {
    line: RawLine;
    events: StreamEvent[];
  }
  const perLine: PerLine[] = lines.map((line) => ({
    line,
    events: materialize(parser(line.text), line.start),
  }));

  const kept: PerLine[] = [];
  let count = 0;
  if (keepTail) {
    // 从末尾向前累积到 ≤MAX_EVENTS（保留最新、贴近窗口末端的行）。
    for (let i = perLine.length - 1; i >= 0; i--) {
      const p = perLine[i];
      if (!p) continue;
      if (kept.length > 0 && count + p.events.length > MAX_EVENTS) break;
      kept.unshift(p);
      count += p.events.length;
      if (count >= MAX_EVENTS) break;
    }
  } else {
    // forward：从头保留到 ≤MAX_EVENTS，多余行不消费（下一页 forward 续读）。
    for (const p of perLine) {
      if (kept.length > 0 && count + p.events.length > MAX_EVENTS) break;
      kept.push(p);
      count += p.events.length;
      if (count >= MAX_EVENTS) break;
    }
  }

  const first = kept[0];
  const last = kept[kept.length - 1];
  return {
    events: kept.flatMap((p) => p.events),
    firstKeptStart: first ? first.line.start : null,
    lastKeptEnd: last ? last.line.end : null,
  };
}

// 读文件某字节区间（永不整读；区间长度已由调用方封顶 ≤MAX_SCAN）。
function readRange(fd: number, start: number, end: number): Buffer {
  const length = Math.max(0, end - start);
  if (length === 0) return Buffer.alloc(0);
  const buf = Buffer.alloc(length);
  const read = fs.readSync(fd, buf, 0, length, start);
  return read === length ? buf : buf.subarray(0, read);
}

// 找 buf 内第一个 \n 之后的位置（对齐到下一行首·残行归上一页）。找不到 → buf.length（无完整行）。
function alignForward(buf: Buffer): number {
  const nl = buf.indexOf(0x0a);
  return nl === -1 ? buf.length : nl + 1;
}

// 向低地址方向找 pos 之前最近的 '\n'（在 [max(0,pos-budget), pos) 内·逐 64KiB 块扫描）。
//   超长单行的行首定位：budget 内没有 → null（调用方降级为片段跳页保进度）。
function scanPrevNewline(fd: number, pos: number, budget: number): number | null {
  const floor = Math.max(0, pos - budget);
  let end = pos;
  while (end > floor) {
    const start = Math.max(floor, end - TAIL_BYTES);
    const buf = readRange(fd, start, end);
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i] === 0x0a) return start + i;
    }
    end = start;
  }
  return null;
}

// 向高地址方向找 pos 起第一个 '\n'（在 [pos, min(size,pos+budget)) 内·逐 64KiB 块扫描）。
function scanNextNewline(fd: number, pos: number, size: number, budget: number): number | null {
  const ceil = Math.min(size, pos + budget);
  let start = pos;
  while (start < ceil) {
    const end = Math.min(ceil, start + TAIL_BYTES);
    const buf = readRange(fd, start, end);
    const idx = buf.indexOf(0x0a);
    if (idx !== -1) return start + idx;
    start = end;
  }
  return null;
}

function noSourcePayload(
  req: AgentStreamRequest,
  reason: string,
  nowIso: string,
): AgentStreamPayload {
  return {
    schema: AGENT_STREAM_SCHEMA,
    agent_id: req.agentId,
    mode: 'none',
    source: { kind: 'none', harness: req.harness, reason },
    live: { active: false, as_of: nowIso },
    cursor: { next: 0, prev: 0, at_start: true },
    events: [],
    reset: false,
  };
}

// 结构化转录可定位的 harness（parserFor 有专属 parser 且 agent-probe 有源定位策略的那批）。
//   cursor 系列刻意不在此列：原生 store 是 SQLite state.vscdb（不可 tail），另走专属归因。
const STREAM_LOCATABLE_HARNESSES = new Set(['claude-code', 'origin', 'codex', 'kimi-code']);

// noSourceReason — 定位不到源时的诚实归因。命门：绝不把「这条 agent 记录没绑上源」说成「这个
//   agent 类型不支持」——前者是操作者可修的绑定缺口（用户实测踩过：codex agent 以 task-id 登记、
//   无 transcript_ref，viewer 显示旧文案后被误读成 codex 流式不支持），归因必须区分且给出操作出口。
function noSourceReason(req: AgentStreamRequest): string {
  if (req.transcriptRef) return 'transcript reference does not resolve to a readable file';
  if (req.harness && CURSOR_HARNESSES.has(req.harness)) {
    return (
      'cursor native session store (SQLite state.vscdb) is not tailable yet — ' +
      `expose a plaintext log via CURSOR_TRANSCRIPT_PATH, or bind one with 'ccm agent amend ${req.agentId} --transcript <absolute path>'`
    );
  }
  if (req.handleKind === 'session-id') return 'transcript file not found yet for this session';
  if (req.harness && STREAM_LOCATABLE_HARNESSES.has(req.harness)) {
    const kind = req.handleKind ? `handle kind '${req.handleKind}'` : 'no handle';
    return (
      `agent record has no stream binding (${kind}, no transcript_ref) — ` +
      `dispatch via 'ccm worker dispatch' to bind the session automatically, or run ` +
      `'ccm agent amend ${req.agentId} --handle session-id:<sid>' / '--transcript <absolute path>'`
    );
  }
  return 'no readable stream source for this agent type yet';
}

// buildAgentStream — /agent-stream.json 主入口：定位源 + 按模式增量读取 + 规范化。只读，绝不写。
export function buildAgentStream(req: AgentStreamRequest): AgentStreamPayload {
  const nowMs = req.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const freshnessSec = req.freshnessSec ?? DEFAULT_FRESHNESS_SEC;

  const location = locateTranscriptFile(
    {
      harness: req.harness,
      handleKind: req.handleKind,
      handleValue: req.handleValue,
      transcriptRef: req.transcriptRef,
    },
    { env: req.env },
  );

  if (!location) {
    return noSourcePayload(req, noSourceReason(req), nowIso);
  }

  let size: number;
  let mtimeMs: number;
  let ino: number;
  let fd: number;
  try {
    // 先 open 再 fstat：对同一个打开的文件取 size/mtime/ino（无 stat→open 竞态窗口）。
    fd = fs.openSync(location.path, 'r');
    const st = fs.fstatSync(fd);
    size = st.size;
    mtimeMs = st.mtimeMs;
    ino = st.ino;
  } catch {
    return noSourcePayload(req, 'transcript became unreadable', nowIso);
  }

  try {
    const parser = parserFor(req.harness);
    const mtimeIso = new Date(mtimeMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const live = { active: nowMs - mtimeMs <= freshnessSec * 1000, as_of: nowIso };
    // ino = 文件身份锚：truncate 后再涨回旧 cursor 之上的轮转 server 侧检测不到（size 比较失效），
    //   client 对比相邻页的 ino 变化即识别「同路径换了文件」→ 清窗重 tail。server 保持无状态。
    //   诚实残余风险：Linux（ext4）会立即复用刚释放的 inode——「删除后马上重建」的新文件可能拿到
    //   同号 ino，此时 ino 比对失明；漏检还需同时满足新文件 size ≥ 旧 cursor（否则既有的
    //   cursor>size reset 检测兜住），两条件叠加属罕见窗口，接受不加码（mtime/ctime 加签会引入
    //   自己的精度假阳）。
    const sourceBase = {
      kind: 'transcript' as const,
      harness: req.harness,
      path: location.path,
      size,
      mtime: mtimeIso,
      ino,
    };

    // ── backward：before=<n>，读 [行首对齐, n) ────────────────────────────────────────────────
    if (req.beforeParam != null) {
      const before = clampOffset(req.beforeParam, size);
      const rawStart = Math.max(0, before - TAIL_BYTES);
      const buf = readRange(fd, rawStart, before);
      const alignOffset = rawStart > 0 ? alignForward(buf) : 0;
      let alignedStart = rawStart + alignOffset;
      let { lines } = splitLines(buf.subarray(alignOffset), alignedStart);

      // 常规 64KiB 窗内没有任何完整行 且 还没到文件头：结束于 before 附近的这一行比窗口还长
      //   （真实 transcript 有 >1MiB 的 tool_result 单行——不处理会让 prev 卡死、「load earlier」
      //   永远无进展）。用行边界扫描预算向前找它的行首，把这一整行读入解析。
      if (lines.length === 0 && rawStart > 0) {
        const nl = scanPrevNewline(fd, before - 1, GIANT_LINE_SCAN);
        // 扫描触底文件头仍无 \n（before-1 ≤ 预算 ⟺ floor 已到 0）：偏移 0 就是行首——文件的
        //   **第一行**本身就是巨行，绝不能落进怪物 fallback（那会把首行永久丢掉 + 伪报 at_start）。
        const lineStart = nl !== null ? nl + 1 : before - 1 <= GIANT_LINE_SCAN ? 0 : null;
        if (lineStart !== null) {
          const lineBuf = readRange(fd, lineStart, before);
          alignedStart = lineStart;
          ({ lines } = splitLines(lineBuf, lineStart));
          // lines 可能仍为空（before 落在行中段·无终止 \n）——此时 prev=alignedStart 仍严格前进，
          //   下一页回到行首锚自愈。
        } else {
          // 边界在 4MiB 预算内都找不到（病态怪物行）：空事件页 + prev 硬退一个预算保进度。
          const prev = Math.max(0, before - GIANT_LINE_SCAN);
          return {
            schema: AGENT_STREAM_SCHEMA,
            agent_id: req.agentId,
            mode: 'backward',
            source: sourceBase,
            live,
            cursor: { next: before, prev, at_start: prev === 0 },
            events: [],
            reset: false,
          };
        }
      }

      const { events, firstKeptStart } = collectEvents(lines, parser, true);
      const prev = firstKeptStart ?? alignedStart;
      return {
        schema: AGENT_STREAM_SCHEMA,
        agent_id: req.agentId,
        mode: 'backward',
        source: sourceBase,
        live,
        cursor: { next: before, prev, at_start: prev === 0 },
        events,
        reset: false,
      };
    }

    // ── forward：cursor=<n>（reset if n>size：文件被截断/轮转）────────────────────────────────
    let reset = false;
    let mode: 'tail' | 'forward' = 'tail';
    const cursorRaw = req.cursorParam;
    if (cursorRaw != null && cursorRaw !== 'tail') {
      const n = Number(cursorRaw);
      if (Number.isInteger(n) && n >= 0 && n <= size) {
        mode = 'forward';
        const end = Math.min(size, n + MAX_SCAN);
        const buf = readRange(fd, n, end);
        let { lines } = splitLines(buf, n);

        // 满窗仍无一条完整行：从 n 起的这一行比 256KiB 扫描窗还长（对称于 backward 的超长行处理；
        //   不满窗则是尾部残行还在写——保持 next=n 等待，两种情况必须区分）。
        if (lines.length === 0 && end - n >= MAX_SCAN) {
          const nl = scanNextNewline(fd, n, size, GIANT_LINE_SCAN);
          if (nl !== null) {
            const lineBuf = readRange(fd, n, nl + 1);
            ({ lines } = splitLines(lineBuf, n));
          } else if (size - n >= GIANT_LINE_SCAN) {
            // 4MiB 预算内无终止符（病态怪物行）：raw 头部片段事件（truncated·保真上限）+ 前进。
            const headBuf = readRange(fd, n, n + TEXT_MAX);
            return {
              schema: AGENT_STREAM_SCHEMA,
              agent_id: req.agentId,
              mode,
              source: sourceBase,
              live,
              cursor: { next: n + GIANT_LINE_SCAN, prev: n, at_start: n === 0 },
              events: [
                {
                  id: `${n}.0`,
                  kind: 'raw',
                  title: 'oversized line',
                  text: headBuf.toString('utf8'),
                  truncated: true,
                },
              ],
              reset: false,
            };
          }
          // else：未满 4MiB 且没 \n = 巨行仍在写入中 → lines 留空、next=n 等下一轮。
        }

        const { events, lastKeptEnd } = collectEvents(lines, parser, false);
        const next = lastKeptEnd ?? n;
        return {
          schema: AGENT_STREAM_SCHEMA,
          agent_id: req.agentId,
          mode,
          source: sourceBase,
          live,
          cursor: { next, prev: n, at_start: n === 0 },
          events,
          reset: false,
        };
      }
      // n>size（截断/轮转）或非法 → 重新 tail 并标 reset。
      reset = true;
    }

    // ── tail：只读末尾 ~64KiB，出最新一屏 ─────────────────────────────────────────────────────
    const rawStart = Math.max(0, size - TAIL_BYTES);
    const buf = readRange(fd, rawStart, size);
    const alignOffset = rawStart > 0 ? alignForward(buf) : 0;
    const alignedStart = rawStart + alignOffset;
    const { lines, consumedEnd } = splitLines(buf.subarray(alignOffset), alignedStart);
    const { events, firstKeptStart } = collectEvents(lines, parser, true);
    const prev = firstKeptStart ?? alignedStart;
    return {
      schema: AGENT_STREAM_SCHEMA,
      agent_id: req.agentId,
      mode: 'tail',
      source: sourceBase,
      live,
      cursor: { next: consumedEnd, prev, at_start: prev === 0 },
      events,
      reset,
    };
  } finally {
    fs.closeSync(fd);
  }
}

// cursor/before 已由端点校验为合法非负整数字符串；这里只夹到 [0,size]（防越界读）。
function clampOffset(raw: string, size: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return 0;
  return Math.min(n, size);
}
