/**
 * Pseudo-localization (ADR-007): makes every catalog string visibly different
 * and about a third longer, while keeping `{placeholders}` and `<tags>` intact.
 * A screen in the pseudo-locale that still shows plain English text has a
 * string that bypasses the catalog; a label that overflows will overflow in a
 * longer language too.
 */
const ACCENTS: Readonly<Record<string, string>> = {
  a: "á", e: "é", i: "í", o: "ó", u: "ú", c: "ç", n: "ñ", y: "ý", s: "š", z: "ž",
  A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú", C: "Ç", N: "Ñ", Y: "Ý", S: "Š", Z: "Ž",
};

export function pseudoText(text: string): string {
  if (text.trim() === "") return text;
  let letters = 0;
  const body = text.split(/(\{[A-Za-z0-9_]+\}|<\/?[A-Za-z0-9]+>)/).map((part, index) => {
    if (index % 2 === 1) return part;
    return part.replace(/[A-Za-z]/g, char => { letters += 1; return ACCENTS[char] ?? char; });
  }).join("");
  return `⟦${body}${"·".repeat(Math.ceil(letters * 0.3))}⟧`;
}

export function pseudoCatalog<T>(catalog: T): T {
  const visit = (value: unknown): unknown => {
    if (typeof value === "string") return pseudoText(value);
    if (typeof value === "function") return (...args: unknown[]) => pseudoText((value as (...a: unknown[]) => string)(...args));
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    return value;
  };
  return visit(catalog) as T;
}
