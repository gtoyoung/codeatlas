import ts from 'typescript';
import { posix } from 'node:path';

const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function normalize(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function evidence(path, source, node) {
  const start = source.getLineAndCharacterOfPosition(node.getStart(source));
  const end = source.getLineAndCharacterOfPosition(node.getEnd());
  return {
    path,
    startLine: start.line,
    startCharacter: start.character,
    endLine: end.line,
    endCharacter: end.character,
    encoding: 'utf16',
  };
}

function routeFor(path) {
  const normalized = normalize(path);
  let parts;
  if (/^(?:src\/)?app\/.+\/(?:page|route)\.[cm]?[jt]sx?$/.test(normalized)) {
    parts = normalized.replace(/^src\//, '').split('/').slice(1, -1);
    parts = parts.filter((part) => !/^\(.+\)$/.test(part) && !part.startsWith('@'));
  } else if (/^(?:src\/)?app\/(?:page|route)\.[cm]?[jt]sx?$/.test(normalized)) {
    parts = [];
  } else if (/^(?:src\/)?pages\/.+\.[cm]?[jt]sx?$/.test(normalized)) {
    parts = normalized.replace(/^src\//, '').replace(/\.[^.]+$/, '').split('/').slice(1);
    if (parts[0]?.startsWith('_')) return null;
    if (parts.at(-1) === 'index') parts.pop();
  } else {
    return null;
  }
  return `/${parts.join('/')}`.replace(/\/+/g, '/') || '/';
}

function resolveImport(fromPath, specifier, paths) {
  if (!specifier.startsWith('.')) return null;
  const base = normalize(posix.normalize(posix.join(posix.dirname(fromPath), specifier)));
  const candidates = [base];
  for (const extension of sourceExtensions) {
    candidates.push(`${base}${extension}`, `${base}/index${extension}`);
  }
  return candidates.find((candidate) => paths.has(candidate)) ?? null;
}

export function analyzeSources({ snapshotId, files }) {
  const sourceFiles = files.filter((file) => (
    typeof file.content === 'string'
    && sourceExtensions.includes(posix.extname(normalize(file.path)).toLowerCase())
  ));
  const paths = new Set(sourceFiles.map((file) => normalize(file.path)));
  const nodes = [];
  const edges = [];
  const issues = files
    .filter((file) => !sourceFiles.includes(file))
    .map((file) => ({
      path: normalize(file.path),
      reason: typeof file.content === 'string' ? 'unsupported_file_type' : (file.reason ?? 'non_text_file'),
    }));
  const routeNodes = new Map();

  for (const file of sourceFiles) {
    const path = normalize(file.path);
    nodes.push({ id: `${snapshotId}:file:${path}`, kind: 'file', label: path, path });
    const route = routeFor(path);
    if (route) {
      const routeId = `${snapshotId}:route:${route}`;
      if (!routeNodes.has(route)) {
        routeNodes.set(route, routeId);
        nodes.push({ id: routeId, kind: 'route', label: route, path });
      }
      edges.push({
        id: `${snapshotId}:declares-route:${path}`,
        source: `${snapshotId}:file:${path}`,
        target: routeId,
        kind: 'declares_route',
        evidence: { path, startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0, encoding: 'utf16' },
      });
    }
  }

  for (const file of sourceFiles) {
    const path = normalize(file.path);
    const source = ts.createSourceFile(path, file.content, ts.ScriptTarget.Latest, true);
    const diagnostics = source.parseDiagnostics ?? [];
    if (diagnostics.length > 0) {
      issues.push({ path, reason: 'parse_diagnostic', count: diagnostics.length });
    }
    const fileId = `${snapshotId}:file:${path}`;
    const fileHasUseServer = source.statements.some((statement) => (
      ts.isExpressionStatement(statement)
      && ts.isStringLiteral(statement.expression)
      && statement.expression.text === 'use server'
    ));

    function visit(node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const targetPath = resolveImport(path, node.moduleSpecifier.text, paths);
        if (targetPath) {
          edges.push({
            id: `${snapshotId}:imports:${path}:${node.getStart(source)}`,
            source: fileId,
            target: `${snapshotId}:file:${targetPath}`,
            kind: 'imports',
            evidence: evidence(path, source, node.moduleSpecifier),
          });
        } else if (node.moduleSpecifier.text.startsWith('.')) {
          issues.push({ path, reason: 'unresolved_import', value: node.moduleSpecifier.text });
        }
      }

      if (
        fileHasUseServer
        && ts.isFunctionDeclaration(node)
        && node.name
        && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        const functionId = `${snapshotId}:server-function:${path}:${node.name.text}`;
        nodes.push({ id: functionId, kind: 'server_function', label: node.name.text, path });
        edges.push({
          id: `${snapshotId}:declares-server:${path}:${node.name.text}`,
          source: fileId,
          target: functionId,
          kind: 'declares_server_function',
          evidence: evidence(path, source, node.name),
        });
      }

      if (
        ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === 'fetch'
        && node.arguments.length > 0
        && ts.isStringLiteralLike(node.arguments[0])
      ) {
        const url = node.arguments[0].text;
        const target = routeNodes.get(url);
        if (target) {
          edges.push({
            id: `${snapshotId}:route-candidate:${path}:${node.getStart(source)}`,
            source: fileId,
            target,
            kind: 'route_candidate',
            evidence: evidence(path, source, node.arguments[0]),
          });
        } else {
          issues.push({ path, reason: 'unresolved_route_candidate', value: url });
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(source);
  }

  return {
    snapshotId,
    nodes,
    edges,
    coverage: {
      totalFiles: files.length,
      indexedFiles: sourceFiles.length - new Set(issues.filter((issue) => issue.reason === 'parse_diagnostic').map((issue) => issue.path)).size,
      partialFiles: new Set(issues.filter((issue) => paths.has(issue.path)).map((issue) => issue.path)).size,
      excludedFiles: files.length - sourceFiles.length,
      failedFiles: 0,
      issues,
    },
  };
}
