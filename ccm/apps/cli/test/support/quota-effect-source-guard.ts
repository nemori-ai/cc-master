import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import type { CounterfeitApiRow } from '../fixtures/quota-effect-hard-deny-v1/counterfeits.js';
import type {
  GuardApiKind,
  GuardImplementationRow,
  GuardSourceKind,
} from './quota-effect-guard-implementation.js';

interface RegistryApiRow {
  id: string;
  effect_class: string;
  kind: GuardApiKind;
  targets: string[];
  source_kinds?: GuardSourceKind[];
}

export interface RegistrySourceRoot {
  id: string;
  kind: 'production' | 'test';
  path: string;
  state: 'required' | 'honest-absent';
  reason?: string;
}

type SourceKind = GuardSourceKind;

interface RegistrySourceDomain {
  kind: SourceKind;
  directory: string;
  file_pattern: string;
}

export interface QuotaEffectHardDenyRegistry {
  schema: string;
  effect_classes: string[];
  api_rows: RegistryApiRow[];
  source_roots: RegistrySourceRoot[];
  source_domains: RegistrySourceDomain[];
}

export interface DirectEffectViolation {
  readonly apiId: string;
  readonly effectClass: string;
  readonly kind: GuardApiKind;
  readonly target: string;
  readonly location: string;
}

export interface DeclaredSourceAudit {
  readonly reachable: readonly string[];
  readonly reachableByKind: Readonly<Record<SourceKind, readonly string[]>>;
  readonly honestAbsent: readonly RegistrySourceRoot[];
}

interface ModuleUse {
  readonly specifier: string;
  readonly node: ts.Node;
}

function assertUnique(label: string, values: readonly string[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${label} contains duplicate row: ${value}`);
    seen.add(value);
  }
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sourceKind(value: unknown, label: string): SourceKind {
  if (value === 'production' || value === 'test') return value;
  throw new Error(`unknown quota source ${label} kind: ${String(value)}`);
}

function canonicalApiRow(row: {
  id: string;
  effectClass: string;
  kind: GuardApiKind;
  targets: readonly string[];
  sourceKinds?: readonly GuardSourceKind[];
}): string {
  return JSON.stringify({
    id: row.id,
    effectClass: row.effectClass,
    kind: row.kind,
    targets: [...row.targets],
    sourceKinds: sorted(row.sourceKinds ?? ['production', 'test']),
  });
}

function assertExact(label: string, actual: readonly string[], expected: readonly string[]): void {
  assertUnique(`${label} actual`, actual);
  assertUnique(`${label} expected`, expected);
  const actualSorted = sorted(actual);
  const expectedSorted = sorted(expected);
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    throw new Error(
      `${label} mismatch: actual=${JSON.stringify(actualSorted)} expected=${JSON.stringify(expectedSorted)}`,
    );
  }
}

export function assertExactEffectRegistry(
  registry: QuotaEffectHardDenyRegistry,
  guards: readonly GuardImplementationRow[],
  counterfeits: readonly CounterfeitApiRow[],
): void {
  if (registry.schema !== 'ccm/quota-effect-hard-deny-registry/v1') {
    throw new Error(`unsupported quota effect registry schema: ${registry.schema}`);
  }
  assertUnique('registry effect_classes', registry.effect_classes);
  assertUnique(
    'registry api_rows',
    registry.api_rows.map((row) => row.id),
  );
  assertUnique(
    'guard implementation rows',
    guards.map((row) => row.id),
  );
  assertUnique(
    'counterfeit api rows',
    counterfeits.map((row) => row.apiId),
  );

  const registryClasses = new Set(registry.effect_classes);
  for (const row of registry.api_rows) {
    if (!registryClasses.has(row.effect_class)) {
      throw new Error(`registry API row ${row.id} has unknown effect class ${row.effect_class}`);
    }
    if (row.targets.length === 0) throw new Error(`registry API row ${row.id} is dead`);
    assertUnique(`registry API row ${row.id} targets`, row.targets);
  }
  for (const effectClass of registry.effect_classes) {
    if (!registry.api_rows.some((row) => row.effect_class === effectClass)) {
      throw new Error(`registry effect class has no API row: ${effectClass}`);
    }
  }

  assertExact(
    'effect classes registry/guard',
    [...new Set(guards.map((row) => row.effectClass))],
    registry.effect_classes,
  );
  assertExact(
    'effect classes registry/counterfeit',
    [...new Set(counterfeits.map((row) => row.effectClass))],
    registry.effect_classes,
  );

  const registryRows = registry.api_rows.map((row) =>
    canonicalApiRow({
      id: row.id,
      effectClass: row.effect_class,
      kind: row.kind,
      targets: row.targets,
      sourceKinds: row.source_kinds,
    }),
  );
  const guardRows = guards.map(canonicalApiRow);
  assertExact('API registry/guard implementation', guardRows, registryRows);

  assertExact(
    'API registry/counterfeit',
    counterfeits.map((row) => row.apiId),
    registry.api_rows.map((row) => row.id),
  );
  for (const row of counterfeits) {
    const expected = registry.api_rows.find((candidate) => candidate.id === row.apiId);
    if (!expected || expected.effect_class !== row.effectClass) {
      throw new Error(`counterfeit API row has mismatched effect class: ${row.apiId}`);
    }
    assertExact(
      `counterfeit API row ${row.apiId} source kinds`,
      row.sourceKinds ?? ['production', 'test'],
      expected.source_kinds ?? ['production', 'test'],
    );
    if (row.probes.length === 0) throw new Error(`counterfeit API row is dead: ${row.apiId}`);
    assertUnique(
      `counterfeit probes for ${row.apiId}`,
      row.probes.map((probe) => probe.id),
    );
  }
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function expressionPath(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, string>,
  resolving = new Set<string>(),
): string | null {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) {
    if (resolving.has(current.text)) return current.text;
    const alias = aliases.get(current.text);
    if (!alias) return current.text;
    resolving.add(current.text);
    return alias;
  }
  if (ts.isPropertyAccessExpression(current)) {
    const base = expressionPath(current.expression, aliases, resolving);
    return base ? `${base}.${current.name.text}` : null;
  }
  if (ts.isElementAccessExpression(current) && current.argumentExpression) {
    const argument = unwrapExpression(current.argumentExpression);
    if (!ts.isStringLiteralLike(argument)) return null;
    const base = expressionPath(current.expression, aliases, resolving);
    return base ? `${base}.${argument.text}` : null;
  }
  return null;
}

function collectAliases(sourceFile: ts.SourceFile): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>();
  const declarations: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) declarations.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  for (let pass = 0; pass <= declarations.length; pass += 1) {
    let changed = false;
    for (const declaration of declarations) {
      if (!declaration.initializer) continue;
      const base = expressionPath(declaration.initializer, aliases);
      if (!base) continue;
      if (ts.isIdentifier(declaration.name)) {
        if (aliases.get(declaration.name.text) !== base) {
          aliases.set(declaration.name.text, base);
          changed = true;
        }
        continue;
      }
      if (!ts.isObjectBindingPattern(declaration.name)) continue;
      for (const element of declaration.name.elements) {
        if (!ts.isIdentifier(element.name)) continue;
        const property = element.propertyName
          ? ts.isIdentifier(element.propertyName) || ts.isStringLiteralLike(element.propertyName)
            ? element.propertyName.text
            : null
          : element.name.text;
        if (!property) continue;
        const value = `${base}.${property}`;
        if (aliases.get(element.name.text) !== value) {
          aliases.set(element.name.text, value);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return aliases;
}

function importClauseIsTypeOnly(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name) return false;
  if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return false;
  return (
    clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every((e) => e.isTypeOnly)
  );
}

function collectModuleUses(sourceFile: ts.SourceFile): ModuleUse[] {
  const uses: ModuleUse[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      !importClauseIsTypeOnly(node)
    ) {
      uses.push({ specifier: node.moduleSpecifier.text, node });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      !node.isTypeOnly
    ) {
      uses.push({ specifier: node.moduleSpecifier.text, node });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !(node as ts.ImportEqualsDeclaration & { isTypeOnly?: boolean }).isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      uses.push({ specifier: node.moduleReference.expression.text, node });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const argument = node.arguments[0];
      if (!argument || !ts.isStringLiteralLike(argument)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        throw new Error(`${sourceFile.fileName}:${line}: dynamic module specifier is not literal`);
      }
      uses.push({ specifier: argument.text, node });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return uses;
}

function sourceFileFor(source: string, location: string): ts.SourceFile {
  const kind = location.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(location, source, ts.ScriptTarget.Latest, true, kind);
  const diagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (diagnostics && diagnostics.length > 0) {
    const message = ts.flattenDiagnosticMessageText(
      diagnostics[0]?.messageText ?? 'parse error',
      '\n',
    );
    throw new Error(`${location}: AST parse failed: ${message}`);
  }
  return sourceFile;
}

export function findDirectEffectViolations(
  source: string,
  location: string,
  guards: readonly GuardImplementationRow[],
  sourceKind?: GuardSourceKind,
): DirectEffectViolation[] {
  const sourceFile = sourceFileFor(source, location);
  const aliases = collectAliases(sourceFile);
  const violations: DirectEffectViolation[] = [];
  const seen = new Set<string>();
  const record = (row: GuardImplementationRow, target: string, node: ts.Node): void => {
    const key = `${row.id}:${node.pos}:${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    violations.push({
      apiId: row.id,
      effectClass: row.effectClass,
      kind: row.kind,
      target,
      location: `${location}:${line}`,
    });
  };

  for (const use of collectModuleUses(sourceFile)) {
    for (const row of guards) {
      if (sourceKind && row.sourceKinds && !row.sourceKinds.includes(sourceKind)) continue;
      if (row.kind === 'module' && row.targets.includes(use.specifier)) {
        record(row, use.specifier, use.node);
      }
    }
  }

  const visit = (node: ts.Node): void => {
    let kind: GuardApiKind | null = null;
    let expression: ts.Expression | null = null;
    if (ts.isCallExpression(node)) {
      if (
        node.expression.kind !== ts.SyntaxKind.ImportKeyword &&
        !(ts.isIdentifier(node.expression) && node.expression.text === 'require')
      ) {
        kind = 'call';
        expression = node.expression;
      }
    } else if (ts.isNewExpression(node)) {
      kind = 'construct';
      expression = node.expression;
    }
    if (kind && expression) {
      const target = expressionPath(expression, aliases);
      if (target) {
        for (const row of guards) {
          if (sourceKind && row.sourceKinds && !row.sourceKinds.includes(sourceKind)) continue;
          if (row.kind === kind && row.targets.includes(target)) record(row, target, node);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

function inside(root: string, candidate: string): boolean {
  const offset = relative(root, candidate);
  return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset));
}

function resolveRelativeModule(importer: string, specifier: string): string {
  const unresolved = resolve(dirname(importer), specifier);
  const candidates = [unresolved];
  const extension = extname(unresolved);
  if (['.js', '.mjs', '.cjs'].includes(extension)) {
    const stem = unresolved.slice(0, -extension.length);
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`);
  } else if (!extension) {
    candidates.push(
      `${unresolved}.ts`,
      `${unresolved}.tsx`,
      `${unresolved}.mts`,
      `${unresolved}.cts`,
      join(unresolved, 'index.ts'),
      join(unresolved, 'index.tsx'),
    );
  }
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return resolve(candidate);
  }
  throw new Error(`${importer}: reachable relative module is missing: ${specifier}`);
}

export function auditModuleGraph(
  repoRoot: string,
  rootPaths: readonly string[],
  guards: readonly GuardImplementationRow[],
  sourceKind?: GuardSourceKind,
): readonly string[] {
  const absoluteRepoRoot = resolve(repoRoot);
  const queue = rootPaths.map((path) => resolve(path));
  const visited = new Set<string>();
  while (queue.length > 0) {
    const path = queue.shift() as string;
    if (visited.has(path)) continue;
    if (!inside(absoluteRepoRoot, path)) throw new Error(`quota source escapes repo root: ${path}`);
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new Error(`required quota source root is missing: ${path}`);
    }
    visited.add(path);
    const source = readFileSync(path, 'utf8');
    const violations = findDirectEffectViolations(source, path, guards, sourceKind);
    if (violations.length > 0) {
      const violation = violations[0] as DirectEffectViolation;
      throw new Error(
        `${violation.location}: direct ${violation.effectClass} escape (${violation.apiId}:${violation.target})`,
      );
    }
    const sourceFile = sourceFileFor(source, path);
    for (const use of collectModuleUses(sourceFile)) {
      if (!use.specifier.startsWith('.')) continue;
      queue.push(resolveRelativeModule(path, use.specifier));
    }
  }
  return sorted(visited);
}

function discoverDomainFiles(repoRoot: string, domain: RegistrySourceDomain): string[] {
  const directory = resolve(repoRoot, domain.directory);
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error(`quota source domain directory is missing: ${directory}`);
  }
  let pattern: RegExp;
  try {
    pattern = new RegExp(domain.file_pattern);
  } catch (error) {
    throw new Error(`invalid quota source domain pattern ${domain.file_pattern}: ${String(error)}`);
  }
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isFile() && pattern.test(entry.name)) found.push(resolve(path));
  }
  return found;
}

function domainOwnsPath(repoRoot: string, domain: RegistrySourceDomain, path: string): boolean {
  const directory = resolve(repoRoot, domain.directory);
  if (dirname(path) !== directory) return false;
  let pattern: RegExp;
  try {
    pattern = new RegExp(domain.file_pattern);
  } catch (error) {
    throw new Error(`invalid quota source domain pattern ${domain.file_pattern}: ${String(error)}`);
  }
  return pattern.test(basename(path));
}

export function auditDeclaredQuotaSources(
  repoRoot: string,
  registry: QuotaEffectHardDenyRegistry,
  guards: readonly GuardImplementationRow[],
): DeclaredSourceAudit {
  for (const root of registry.source_roots) sourceKind(root.kind, 'root');
  for (const domain of registry.source_domains) sourceKind(domain.kind, 'domain');
  assertUnique(
    'quota source root ids',
    registry.source_roots.map((root) => root.id),
  );
  assertUnique(
    'quota source root paths',
    registry.source_roots.map((root) => root.path),
  );
  assertUnique(
    'quota source domains',
    registry.source_domains.map(
      (domain) => `${domain.kind}:${domain.directory}:${domain.file_pattern}`,
    ),
  );

  const required: Record<SourceKind, string[]> = {
    production: [],
    test: [],
  };
  const honestAbsent: RegistrySourceRoot[] = [];
  for (const root of registry.source_roots) {
    const path = resolve(repoRoot, root.path);
    if (!inside(resolve(repoRoot), path)) {
      throw new Error(`quota source root escapes repo root: ${path}`);
    }
    const owningKinds = new Set(
      registry.source_domains
        .filter((domain) => domainOwnsPath(repoRoot, domain, path))
        .map((domain) => domain.kind),
    );
    if (!owningKinds.has(root.kind)) {
      throw new Error(
        `quota source root kind mismatch: ${root.id} declares ${root.kind} but path belongs to ${sorted(owningKinds).join(',') || 'no'} source domain`,
      );
    }
    if (owningKinds.size !== 1) {
      throw new Error(
        `quota source root belongs to overlapping production/test domains: ${root.id}`,
      );
    }
    if (root.state === 'required') {
      if (!existsSync(path) || !statSync(path).isFile()) {
        throw new Error(`required quota source root is missing: ${path}`);
      }
      required[root.kind].push(path);
    } else if (root.state === 'honest-absent') {
      if (!root.reason || root.reason.trim() === '') {
        throw new Error(`honest-absent quota source root needs a reason: ${root.id}`);
      }
      if (existsSync(path)) {
        throw new Error(`honest-absent quota source root unexpectedly exists: ${path}`);
      }
      honestAbsent.push(root);
    } else {
      throw new Error(`unknown quota source root state: ${String(root.state)}`);
    }
  }

  const reachableByKind: Record<SourceKind, readonly string[]> = {
    production: auditModuleGraph(repoRoot, required.production, guards, 'production'),
    test: auditModuleGraph(repoRoot, required.test, guards, 'test'),
  };
  const reachableSets: Record<SourceKind, ReadonlySet<string>> = {
    production: new Set(reachableByKind.production),
    test: new Set(reachableByKind.test),
  };
  const discoveredByKind: Record<SourceKind, string[]> = {
    production: [],
    test: [],
  };
  for (const domain of registry.source_domains) {
    discoveredByKind[domain.kind].push(...discoverDomainFiles(repoRoot, domain));
  }
  assertUnique('discovered production quota source domain files', discoveredByKind.production);
  assertUnique('discovered test quota source domain files', discoveredByKind.test);
  const productionDomain = new Set(discoveredByKind.production);
  for (const path of discoveredByKind.test) {
    if (productionDomain.has(path)) {
      throw new Error(`quota source file belongs to both production and test domains: ${path}`);
    }
  }

  for (const kind of ['production', 'test'] as const) {
    const opposite: SourceKind = kind === 'production' ? 'test' : 'production';
    for (const path of discoveredByKind[kind]) {
      if (!reachableSets[kind].has(path)) {
        if (reachableSets[opposite].has(path)) {
          throw new Error(
            `${kind} quota source domain file ${path} is reachable only from ${opposite} roots`,
          );
        }
        throw new Error(
          `${kind} quota source domain file is unreachable from ${kind} roots: ${path}`,
        );
      }
      if (reachableSets[opposite].has(path)) {
        throw new Error(`${opposite} quota source closure reaches ${kind} domain file: ${path}`);
      }
    }
  }
  const reachable = sorted(new Set([...reachableByKind.production, ...reachableByKind.test]));
  return { reachable, reachableByKind, honestAbsent };
}
