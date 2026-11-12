/**
 * Finds user-visible English that bypasses the message catalogs (ADR-007).
 *
 *   node --experimental-strip-types tests/i18n-scan.ts [files…]   # list findings
 *
 * Three kinds of finding, all outside `src/i18n/`:
 * - `jsx-text`: JSX text with a letter in it.
 * - `jsx-attr`: a literal accessible name or tooltip (`aria-label`, `title`, `placeholder`, `alt`, `label`, …).
 * - `literal`: a string or template literal with two words, or one capitalized word, that is not an
 *   identifier, a CSS class list, a selector, a key name, or a developer error.
 * The scan is syntactic: it reports candidates, and `tests/i18n.test.ts` keeps their count from growing.
 */
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export interface Finding { readonly file: string; readonly line: number; readonly kind: "jsx-text" | "jsx-attr" | "literal"; readonly text: string }

export const appRoot = fileURLToPath(new URL("../", import.meta.url));
const src = resolve(appRoot, "src");

const TEXT_ATTRIBUTES = new Set(["aria-label", "aria-description", "aria-roledescription", "aria-valuetext", "title", "placeholder", "alt", "label", "summary", "help", "heading", "description", "emptyText"]);
const CODE_ATTRIBUTES = new Set(["className", "id", "role", "type", "name", "htmlFor", "key", "href", "src", "accept", "autoComplete", "inputMode", "lang", "dir", "value", "defaultValue", "pattern", "d", "fill", "stroke", "viewBox", "transform", "style"]);
const KEY_NAMES = new Set(["Enter", "Escape", "Space", "Tab", "Home", "End", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Backspace", "Delete", "Files"]);
const DEVELOPER_CALLS = /^(?:applicationError|console\.\w+|assert\w*|new (?:Type|Range|Syntax)?Error|(?:Type|Range)?Error|querySelector(?:All)?|closest|matches|getElementById|setAttribute|getAttribute|removeAttribute|addEventListener|removeEventListener|getPropertyValue|setProperty|structuredClone|postMessage)$/;

export function files(directory = src): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return path === resolve(src, "i18n") ? [] : files(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function looksLikeProse(text: string): boolean {
  const trimmed = text.trim();
  if (!/[A-Za-z]/.test(trimmed)) return false;
  if (KEY_NAMES.has(trimmed)) return false;
  // Identifier-shaped: codes, ids, dotted observation types, CSS class lists, selectors, paths, MIME types, URLs.
  if (/^[a-z0-9_.:/@#\[\]="'*>+~()^$|, -]*$/.test(trimmed) && !/[a-z]{2,} [a-z]{2,} [a-z]{2,}/.test(trimmed)) return false;
  if (/^[A-Z0-9_]+$/.test(trimmed)) return false;
  // Colon, slash, dot, or at separated tokens with no spaces are ids: `publication:orders:OrderCreated`, `retry-unsafe@1`.
  if (!/\s/.test(trimmed) && /[:/.@]/.test(trimmed) && !/[.:…]$/.test(trimmed)) return false;
  if (/^[a-z][A-Za-z0-9]*$/.test(trimmed)) return false;
  if (/^(?:https?:|\.{0,2}\/|data:|#|\[)/.test(trimmed)) return false;
  return /[A-Za-z]{2,}[\s,.;:!?'’–—-]+[A-Za-z]{2,}/.test(trimmed) || /^[A-Z][a-z]+[.:…]?$/.test(trimmed);
}

function calleeName(node: ts.Node): string | undefined {
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
    const callee = node.expression;
    const name = ts.isPropertyAccessExpression(callee) ? (ts.isIdentifier(callee.expression) && callee.expression.text === "console" ? `console.${callee.name.text}` : callee.name.text) : ts.isIdentifier(callee) ? callee.text : undefined;
    return name === undefined ? undefined : ts.isNewExpression(node) ? `new ${name}` : name;
  }
  return undefined;
}

function ignoredPosition(node: ts.Node): boolean {
  for (let current: ts.Node = node, parent = node.parent; parent; current = parent, parent = parent.parent) {
    if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isLiteralTypeNode(parent) || ts.isTypeNode(parent) && !ts.isTypeLiteralNode(parent)) return true;
    if (ts.isPropertyAssignment(parent) && parent.name === current) return true;
    if (ts.isElementAccessExpression(parent) && parent.argumentExpression === current) return true;
    if (ts.isCaseClause(parent) && parent.expression === current) return true;
    if (ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(parent.operatorToken.kind)) return true;
    if (ts.isJsxAttribute(parent)) return CODE_ATTRIBUTES.has(parent.name.getText()) || TEXT_ATTRIBUTES.has(parent.name.getText());
    const callee = calleeName(parent);
    if (callee && DEVELOPER_CALLS.test(callee)) return true;
    if (ts.isThrowStatement(parent)) return true;
    if (ts.isStatement(parent) || ts.isFunctionLike(parent)) return false;
  }
  return false;
}

export function scan(file: string): Finding[] {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const name = relative(appRoot, file);
  const found: Finding[] = [];
  const add = (node: ts.Node, kind: Finding["kind"], value: string) =>
    found.push({ file: name, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, kind, text: value.trim().replace(/\s+/g, " ").slice(0, 100) });
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      if (/[A-Za-z]/.test(node.text)) add(node, "jsx-text", node.text);
    } else if (ts.isJsxAttribute(node) && TEXT_ATTRIBUTES.has(node.name.getText()) && node.initializer) {
      const init = node.initializer;
      const literal = ts.isStringLiteral(init) ? init : ts.isJsxExpression(init) && init.expression && (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression) || ts.isTemplateExpression(init.expression)) ? init.expression : undefined;
      const value = literal ? (ts.isTemplateExpression(literal) ? literal.getText(source) : (literal as ts.StringLiteral).text) : undefined;
      if (value !== undefined && /[A-Za-z]{2,}/.test(value.replace(/\$\{[^}]*\}/g, ""))) add(node, "jsx-attr", value);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (looksLikeProse(node.text) && !ignoredPosition(node)) add(node, "literal", node.text);
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map(span => span.literal.text)].join(" … ");
      if (looksLikeProse(parts.replace(/…/g, " ")) && !ignoredPosition(node)) add(node, "literal", node.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const targets = process.argv.slice(2).map(item => resolve(item));
  const findings = (targets.length ? targets : files()).flatMap(scan);
  for (const item of findings) console.log(`${item.file}:${item.line}\t${item.kind}\t${item.text}`);
  const byFile = new Map<string, number>();
  for (const item of findings) byFile.set(item.file, (byFile.get(item.file) ?? 0) + 1);
  console.log(`\n${findings.length} findings in ${byFile.size} files`);
  for (const [file, count] of [...byFile].sort((a, b) => b[1] - a[1])) console.log(`${String(count).padStart(5)}  ${file}`);
}
