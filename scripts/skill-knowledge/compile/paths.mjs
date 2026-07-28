import path from 'node:path';
import { HARDENING_CONTRACT } from '../contracts.mjs';

const HOSTS = HARDENING_CONTRACT.C9.hosts;

/**
 * Map an authored canonical Markdown path to the host dist skill path.
 * plugin/src/skills/<skill>/canonical/<rel> → plugin/dist/<host>/skills/<skill>/<rel>
 */
export function canonicalBindingToDistPath(host, bindingPath) {
  const normalized = String(bindingPath).split(path.sep).join('/');
  const match = normalized.match(
    /^plugin\/src\/skills\/([^/]+)\/canonical\/(.+)$/,
  );
  if (!match) return null;
  return `plugin/dist/${host}/skills/${match[1]}/${match[2]}`;
}

/**
 * Map an authored entry surface source_file to its projected host path.
 */
export function entrySurfaceToDistPath(host, sourceFile) {
  const normalized = String(sourceFile).split(path.sep).join('/');

  const commandMatch = normalized.match(
    /^plugin\/src\/commands\/([^/]+)\/adapters\/([^/]+)\/body\.md$/,
  );
  if (commandMatch) {
    const [, command, adapterHost] = commandMatch;
    if (adapterHost !== host) return null;
    return `plugin/dist/${host}/commands/${command}.md`;
  }

  const skillMatch = normalized.match(
    /^plugin\/src\/skills\/([^/]+)\/canonical\/SKILL\.md$/,
  );
  if (skillMatch) {
    return `plugin/dist/${host}/skills/${skillMatch[1]}/SKILL.md`;
  }

  return null;
}

export function moduleRouterDistPath(host, moduleId) {
  const slug = moduleId.replace(/^module:/, '');
  return `plugin/dist/${host}/knowledge/modules/${slug}.md`;
}

export function atlasDistPath(host) {
  return `plugin/dist/${host}/knowledge/atlas.md`;
}

export function moduleAnchorId(moduleId) {
  return `ccm-k-module-${moduleId.replace(/^module:/, '').replaceAll('.', '-')}`;
}

export function skillAnchorId(skillId) {
  return `ccm-k-skill-${skillId.replace(/^skill:/, '').replaceAll('.', '-')}`;
}

export function posixRelative(fromFile, toFile) {
  const fromDir = path.posix.dirname(fromFile.split(path.sep).join('/'));
  let relative = path.posix.relative(fromDir, toFile.split(path.sep).join('/'));
  if (!relative.startsWith('.') && !relative.startsWith('/')) {
    relative = `./${relative}`;
  }
  return relative;
}

export function assertKnownCompileHost(host) {
  return HOSTS.includes(host);
}

export { HOSTS as PRODUCT_HOSTS };
