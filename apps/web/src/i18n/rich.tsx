import { Fragment } from "react";
import type { ReactNode } from "react";
import { parseRich } from "./rich-parse.ts";
import type { RichNode } from "./rich-parse.ts";

export { plainText } from "./rich-parse.ts";

/**
 * Renders a catalog message that has inline markup (ADR-007). The message is a
 * plain string with `<tag>…</tag>` spans and `{name}` placeholders:
 *
 *   "Seed: <code>{seed}</code>. Reset replays the same run."
 *
 * `tags` maps each tag name to a renderer, `values` maps each placeholder to a
 * node. Values are inserted as nodes and never parsed, so text from a scenario
 * file cannot add markup. An unknown tag renders its children; an unknown
 * placeholder renders as written, so a mistake is visible instead of silent.
 */
export function Rich({ text, tags = {}, values = {} }: {
  readonly text: string;
  readonly tags?: Readonly<Record<string, (children: ReactNode) => ReactNode>>;
  readonly values?: Readonly<Record<string, ReactNode>>;
}): ReactNode {
  const render = (nodes: readonly RichNode[]): ReactNode[] => nodes.map((node, index) => {
    if (typeof node === "string") return node;
    if ("placeholder" in node) return Object.hasOwn(values, node.placeholder) ? <Fragment key={index}>{values[node.placeholder]}</Fragment> : `{${node.placeholder}}`;
    const children = <>{render(node.children)}</>;
    return <Fragment key={index}>{Object.hasOwn(tags, node.tag) ? tags[node.tag]!(children) : children}</Fragment>;
  });
  return <>{render(parseRich(text))}</>;
}
