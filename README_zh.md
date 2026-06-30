# cc-master

> For English, see [README.md](README.md)。

**给它一个大目标，和一份预算。然后去忙你自己的。**

它会像一个不睡觉、还特别会算账的项目负责人，替你把活一路干到验收通过——顺手把你的预算也管了。你只管出主意、在真正的大事上拍个板；剩下的拆解、调度、盯进度、控成本、查验收，它全包了。等你回来，活干完了，而且没花冤枉钱。

> **你不用再当那个什么都得盯着的人。**

![它替你记着的那份活计划，一眼看全](docs/images/view-graph-dark-zh.png)

```
/cc-master:as-master-orchestrator 把我的想法做成能用的东西
```

一句话，它就开工了。然后你可以走开。

---

## 这说的是不是你

- **🚀 你有想法，但不是工程师。** 你说得清要什么，可一个要好几天、千头万绪的东西，你没法盯着它一路做完——你缺的是一个**靠谱的项目负责人**。它就是。
- **🔧 你是工程师，但不想当"管事的"。** 你想专心解技术难题，不想去拆活、排工、算账、盯一堆任务还得不停做判断。**它把"管理"接走，你留在你擅长、也喜欢的地方。**
- **🧭 你在带团队。** 你想把自己变成十个自己。**它替你扛下所有琐碎调度，你只管定方向、拍大事。**

三种人，缺的是同一样东西：**一个能替你把事情管到底、还会算账的脑子。**

---

## 它到底替你做了什么

把一个大活交给普通的 AI，你会很快发现：它聊着聊着就**忘了自己在干嘛**；一次只能干一件、你得在旁边一步步喂；闷头一扎进去，可能**把你这个月的额度一口烧光**；要么三句一问烦死你，要么自作主张跑偏，最后还跟你说"差不多做完了"——其实没有。

cc-master 把这些全接管了，像个真正会算账的项目负责人那样：

- **🧩 拆活 + 一队人一起上。** 把大目标拆成有先后的小步，能同时干的就调一队 AI 并行开工。而且它不瞎拆——会算出**哪条链决定整个项目啥时候完**（临界路径），盯着那条使劲。
- **🔮 开工前就告诉你啥时候完。** 它跑几千次模拟，给你一个**概率**："五成把握周三完、九成把握周五完"，还点出哪个环节最可能拖后腿。这本来是项目经理拿 Excel 算半天的活，现在一条命令、几十毫秒。
- **💰 像个 CFO 一样管你的预算。** 它清楚每一步大概烧多少、还能撑多久、按什么节奏花最划算；快超支了它减速、甚至把"要不要继续烧钱"这种决定推回给你拍板——**不会让你一觉醒来发现额度透支、活还没干完。**
- **⚡ 它几乎不会"停机"。** 别的 AI 一撞到用量上限，就甩你一句"过几小时再来"。它不会——额度用紧时，它自己悄悄切到另一个满额账号、接着干，**你全程无感，活一刻没停。**
- **🧠 它不会忘。** 别的 AI 聊久了会"断片"；它哪怕上下文被压缩几十次、跨了好几个会话，每次醒来都记得自己是谁、做到哪了、还剩什么，**从断点接着干，不回到原点。**
- **🙋 只在真正重要的事上问你。** 小决定它自己拿主意；只有"这事得你拍板"的，它才停下来、把来龙去脉讲清楚、等你一句话。
- **🏁 它不会假装做完。** 完工前它自己回头对着你最初的目标逐条自检：每件事真做完了吗？该问你的都问了吗？后台有没有悄悄挂掉的？**没做完，它不会糊弄你说做完了。**

你做的，只有开头那一个主意、和中途那几次拍板。

---

## 看它干一次，从头到尾

> 你扔下一句：**"把我的 app 翻译成 6 种语言。"** 然后去睡觉。

- **它先想清楚顺序**：得先把要翻的词抽出来、搭好框架，6 种语言才能各翻各的。于是它先干打底的活，再把 6 种语言**同时**派出去。
- **打底的活用好一点的 AI（贵但稳），翻译的活用便宜的 AI**——省钱又不耽误质量，该精打细算的地方它都算过。
- 翻到一半，**冒出一个只有你能定的问题**："产品里的专有名词，翻译还是保留英文？" 它**立刻记下来等你**，同时手上别的语言一刻没停。
- 干着干着**额度快到上限**了，它放慢节奏、或者换个满额账号接着干，**没让你撞墙、也没让你超支**。
- **第二天早上你回来**：6 种语言全好了，每一处它都自己核对过，你那个专有名词的决定也落实进去了。

从头到尾，你只说了一句话、拍了一个板。

---

## 什么时候**别**用它

一个改一两行、十分钟搞定的小活——直接干就好，别请这个"项目负责人"，那是杀鸡用牛刀、反而更慢。**它是为那种"大到你一个人盯不过来、要好几天、要同时推很多条线"的目标准备的。** 活越大、越乱、越久，它越值。

---

## 它其实是个什么（给好奇的人）

cc-master 是 [Claude Code](https://code.claude.com/docs/en/workflows) 的一个插件，背后是三样东西搭起来的：一层薄薄的**指挥逻辑**（教 AI 怎么当总指挥）、一个能做**运筹学估算和配速**的引擎、和一套把多个账号配额**当储备池调度**的资源管理。

我们对"做到了什么"和"还在做什么"分得很清楚——大部分能力今天就能用；更聪明的预算管理、让一支 AI"舰队"协同作战，还在路上。**全部机制、以及每一项到底是已落地还是设计中，都诚实写在 [产品功能手册](design_docs/feature-manual.md) 里**，不在 README 里夸大。

---

## 上手

两步——先装 `ccm` 引擎，再装插件。两者都来自**同一个 cc-master GitHub release**，请装版本配套的（引擎和插件按同一个 tag 一起构建、一起发布）。

### 1. 装 `ccm` 引擎（必需）

cc-master 经一个独立的引擎 `ccm` 操作它的 board。它是**硬前置**——PATH 里没有 `ccm`，插件就不会开工：它在起点就检测到并提醒你先装 `ccm`（[ADR-021](adrs/ADR-021-ccm-install-presence-hard-precheck.md)）。`ccm` 以 per-OS 原生二进制的形式，随每个 release 附带。

**a. 先弄清你的操作系统和架构：**

```bash
uname -s   # Darwin = macOS,  Linux = Linux
uname -m   # arm64 / aarch64 = arm64,  x86_64 = x64
```

据此挑对应的二进制：**`ccm-darwin-arm64`**（Apple Silicon Mac）·**`ccm-darwin-x64`**（Intel Mac）·**`ccm-linux-x64`**·**`ccm-linux-arm64`**（ARM Linux）。每个 release 四个全发。

**b. 下载它、重命名为 `ccm`、加可执行权限、放进 PATH。** 打开你想用的那个 release 的 **Assets**，下载与你机器匹配的 `ccm-<os>-<arch>`，然后：

```bash
mkdir -p ~/.local/bin
mv ~/Downloads/ccm-darwin-arm64 ~/.local/bin/ccm   # 换成你自己下载的那个文件；重命名为纯 `ccm`
chmod +x ~/.local/bin/ccm                          # 加可执行权限
ccm --version                                       # 验证能跑
```

确保 `~/.local/bin` 在你的 PATH 里。如果 `ccm --version` 报 "command not found"，把下面这行加进 `~/.zshrc` 或 `~/.bashrc`，再重开终端：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### 2. 装 cc-master 插件

从**同一个 release tag**下载 `cc-master-plugin-<tag>.zip`，解压，然后让 Claude Code 指向解压出的目录：

```bash
unzip ~/Downloads/cc-master-plugin-<tag>.zip -d ~/cc-master   # 例：<tag> = v0.10.0
claude --plugin-dir ~/cc-master
```

`claude --plugin-dir /abs/path/to/cc-master` 在任何项目里都能用，所以你可以一边在别的项目里干活、一边跑 cc-master。（想从源码跑？改成 `git clone` 本仓再 `claude --plugin-dir .`——但你仍需第 1 步里一个版本配套的 `ccm` 二进制在 PATH 上。）

**把 Claude config 挪走了？** 如果你用 `CLAUDE_CONFIG_DIR` 把 Claude Code 的配置目录指到了 `~/.claude` 以外，`ccm` 会自动跟随——它的 board home 和号池都落在你配置的目录下，不用额外传参。

然后给它一个目标：

```
/cc-master:as-master-orchestrator <你的目标>     # 交给它——它就开工
```

---

## 日常使用

你真正会敲的就这几条命令。`/cc-master:…` 这些在 **Claude Code 会话里**敲；`ccm …` 在你的**终端**里敲。

- **`/cc-master:as-master-orchestrator <目标>`** — 把一个大目标交给它，它拆好计划、开工。每场编排都从这条开始。
- **`/cc-master:status`** — 一眼看现状：总进度、哪些卡住了、有没有**等你拍板**的决定。
- **`/cc-master:view`** — 在浏览器里把它的实时活计划打开成一张只读图；自己刷新，绝不动手上的活。
- **`/cc-master:discuss <决定>`** — 当 `status` 标出一个等你拍板的决定，开个新会话把它聊透；你的答复会回流进计划。
- **`/cc-master:stop`** — 收尾并归档 board。可逆——以后还能把这场编排接着捡起来。
- **`/cc-master:handoff-to-new-session`** — 在当前会话结束前，把这场编排干净地交接给一个新会话；新会话用 `/cc-master:as-master-orchestrator --resume` 接手。
- **`ccm account add|list|switch <email>`** — 建一个备用账号池并调度它，好让它在某个账号额度用紧时切到一个满额的。这几条你直接在终端里敲；你的 token 全程 token-blind，绝不进 AI 的 context。

> 日常就这一组。完整命令面（每个 `ccm` namespace 和 flag）在 [命令目录](skills/using-ccm/references/command-catalog.md)；哪些已落地、哪些还在路上，在 [产品功能手册](design_docs/feature-manual.md)。

---

## 想更深入

- **它能做的每一件事 + 诚实状态** → [产品功能手册](design_docs/feature-manual.md)
- **贡献者 / 架构第一站** → [`AGENTS.md`](AGENTS.md)
- **完整设计** → [`design_docs/spec.md`](design_docs/spec.md)

---

## 致谢 · 许可证

站在先行者的肩膀上：[Claude Code](https://code.claude.com/docs/en/workflows)（Anthropic）、[claude-code-workflow-creator](https://github.com/ray-amjad/claude-code-workflow-creator)、[superpowers](https://github.com/obra/superpowers)、[claude-code-workflow-orchestration](https://github.com/barkain/claude-code-workflow-orchestration)。

[MIT](LICENSE) © 2026 cc-master contributors
