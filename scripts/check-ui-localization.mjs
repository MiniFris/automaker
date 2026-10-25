/** Local, read-only by default. --write regenerates the English key inventory. */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keys = new Set();
const untranslated = [];
const codeTags = /^(?:code|pre|script|style|Markdown|ReactMarkdown|AnsiOutput|TerminalOutput)$/;
function inCode(n) {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isJsxElement(p) && codeTags.test(p.openingElement.tagName.getText())) return true;
  }
  return false;
}
function scan(dir, metadata = false) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!['electron', 'locales'].includes(ent.name)) scan(file, metadata);
      continue;
    }
    if (!/\.tsx?$/.test(file) || /(?:routeTree\.gen|\.d\.ts$)/.test(file)) continue;
    if (metadata && !/(?:-models|model-display)\.ts$/.test(file)) continue;
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    function visit(n) {
      if (
        ts.isCallExpression(n) &&
        n.expression.getText(source) === 'translate' &&
        n.arguments[0] &&
        ts.isStringLiteral(n.arguments[0])
      )
        keys.add(n.arguments[0].text);
      if (
        metadata &&
        ts.isPropertyAssignment(n) &&
        /^(?:label|description)$/.test(n.name.getText(source)) &&
        ts.isStringLiteral(n.initializer)
      )
        keys.add(n.initializer.text);
      if (
        ts.isVariableDeclaration(n) &&
        n.name.getText(source) === 'descriptions' &&
        n.initializer
      ) {
        function values(x) {
          if (ts.isStringLiteral(x)) keys.add(x.text);
          else ts.forEachChild(x, values);
        }
        values(n.initializer);
      }
      if (
        !metadata &&
        ts.isVariableDeclaration(n) &&
        /(?:LABEL|TITLE|SUBTITLE)$/.test(n.name.getText(source)) &&
        n.initializer &&
        ts.isStringLiteral(n.initializer)
      )
        keys.add(n.initializer.text);
      if (!metadata && ts.isJsxText(n) && !inCode(n) && /[A-Za-z]/.test(n.text)) {
        const text = n.text.replace(/\s+/g, ' ').trim();
        // Proper names and technical syntax are deliberately not UI copy.
        if (
          !/^(?:[\w./:@-]+|https?:\/\/\S+)$/.test(text) &&
          !/^(?:Visual Studio Code|Node\.js|\.?\.?)$/.test(text)
        ) {
          const { line } = source.getLineAndCharacterOfPosition(n.getStart(source));
          untranslated.push(`${path.relative(root, file)}:${line + 1}: ${text}`);
        }
      }
      ts.forEachChild(n, visit);
    }
    visit(source);
  }
}
scan(path.join(root, 'apps/ui/src'));
scan(path.join(root, 'libs/types/src'), true);
// This server response contains curated interface copy, not model output or user data.
// Include every supported platform's messages so new diagnostics cannot silently miss translation.
const dockerDiagnostics = ts.createSourceFile(
  'docker-diagnostics.ts',
  fs.readFileSync(
    path.join(root, 'apps/server/src/services/execution-environment/docker-diagnostics.ts'),
    'utf8'
  ),
  ts.ScriptTarget.Latest,
  true
);
function collectDiagnosticText(node) {
  if (ts.isStringLiteral(node) && /\s/.test(node.text)) keys.add(node.text);
  ts.forEachChild(node, collectDiagnosticText);
}
function visitDiagnostic(node) {
  if (
    (ts.isVariableDeclaration(node) &&
      ['messages', 'remediation'].includes(node.name.getText(dockerDiagnostics))) ||
    (ts.isCallExpression(node) &&
      node.expression.getText(dockerDiagnostics) === 'remediation.push') ||
    (ts.isPropertyAssignment(node) && node.name.getText(dockerDiagnostics) === 'documentation')
  )
    collectDiagnosticText(node);
  else ts.forEachChild(node, visitDiagnostic);
}
visitDiagnostic(dockerDiagnostics);
const sorted = [...keys].sort();
if (process.argv.includes('--keys')) {
  await new Promise((resolve) =>
    process.stdout.write(JSON.stringify(sorted, null, 2) + '\n', resolve)
  );
  process.exit(0);
}
if (process.argv.includes('--audit')) {
  console.log(untranslated.join('\n'));
  console.log(`${untranslated.length} unmarked JSX text fragments`);
  process.exit(untranslated.length ? 1 : 0);
}
const localeDir = path.join(root, 'apps/ui/src/locales');
if (process.argv.includes('--write')) {
  fs.writeFileSync(
    path.join(localeDir, 'en.json'),
    JSON.stringify(Object.fromEntries(sorted.map((key) => [key, key])), null, 2) + '\n'
  );
}
const en = JSON.parse(fs.readFileSync(path.join(localeDir, 'en.json'), 'utf8'));
const ru = {
  ...JSON.parse(fs.readFileSync(path.join(localeDir, 'ru.json'), 'utf8')),
  ...JSON.parse(fs.readFileSync(path.join(localeDir, 'ru-reviewed.json'), 'utf8')),
};
const placeholders = (text) =>
  [...text.matchAll(/\{\w+\}/g)]
    .map((m) => m[0])
    .sort()
    .join(',');
const errors = [];
for (const key of sorted) {
  if (!Object.hasOwn(en, key)) errors.push(`English inventory missing: ${JSON.stringify(key)}`);
  if (!Object.hasOwn(ru, key) || !ru[key]?.trim())
    errors.push(`Russian translation missing: ${JSON.stringify(key)}`);
  else if (placeholders(key) !== placeholders(ru[key]))
    errors.push(`Interpolation mismatch: ${JSON.stringify(key)}`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `Localization OK: ${sorted.length} English keys, complete Russian catalog, matching placeholders.`
  );
