/**
 * Parser for catalog messages with inline markup (ADR-007): `<tag>…</tag>`
 * spans and `{name}` placeholders. Pure and DOM-free, so it is unit-tested in
 * Node; `rich.tsx` renders the tree.
 */
export type RichNode = string | { readonly placeholder: string } | { readonly tag: string; readonly children: readonly RichNode[] };

const TOKEN = /<(\/?)([A-Za-z][A-Za-z0-9]*)>|\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function parseRich(text: string): RichNode[] {
  const root: { tag: string | null; children: RichNode[] } = { tag: null, children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1]!;
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index > last) top().children.push(text.slice(last, match.index));
    last = match.index + match[0].length;
    const [whole, closing, tag, placeholder] = match;
    if (placeholder !== undefined) top().children.push({ placeholder });
    else if (!closing) stack.push({ tag: tag!, children: [] });
    else if (stack.length > 1 && top().tag === tag) {
      const node = stack.pop()!;
      top().children.push({ tag: node.tag!, children: node.children });
    } else top().children.push(whole);
  }
  if (last < text.length) top().children.push(text.slice(last));
  // An unclosed tag keeps its text visible rather than dropping it.
  while (stack.length > 1) {
    const node = stack.pop()!;
    top().children.push(`<${node.tag}>`, ...node.children);
  }
  return root.children;
}

/** The message as plain text, for an accessible name or a title: tags removed, placeholders filled. */
export function plainText(text: string, values: Readonly<Record<string, string | number>> = {}): string {
  const flat = (nodes: readonly RichNode[]): string => nodes.map(node => typeof node === "string" ? node
    : "placeholder" in node ? (Object.hasOwn(values, node.placeholder) ? String(values[node.placeholder]) : `{${node.placeholder}}`)
      : flat(node.children)).join("");
  return flat(parseRich(text));
}
