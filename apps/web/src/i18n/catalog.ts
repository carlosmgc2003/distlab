/**
 * Message catalogs (ADR-007). `en/` is the source catalog; every other locale
 * is typed as `typeof en`, so a missing key or a changed parameter is a type
 * error. A message is either a string or a function of its parameters and the
 * locale's `Fmt`. `messages(locale)` binds the formatter once, so callers write
 * `m.lessonChooser.count({ shown, total })`.
 *
 * Text is presentation: it is produced on the main thread from codes, ids and
 * stored fields, and never enters projections, worker commands, or history.
 * The worker never imports this module (tests/boundaries.test.ts).
 */
import { createFmt } from "./format.ts";
import type { Fmt } from "./format.ts";
import { en } from "./en/index.ts";
import { es } from "./es/index.ts";
import { localeInfo } from "./locales.ts";
import type { Locale } from "./locales.ts";
import { pseudoCatalog } from "./pseudo.ts";

export type Catalog = typeof en;

type BoundValue<V> =
  V extends string ? string
  : V extends readonly string[] ? readonly string[]
  : V extends (params: infer P, fmt: Fmt) => infer R ? (params: P) => R
  : V extends object ? Bound<V>
  : V;
export type Bound<T> = { readonly [K in keyof T]: BoundValue<T[K]> };

/** The bound catalog for one locale, plus its formatter for joins and numbers. */
export type Messages = Bound<Catalog> & { readonly locale: Locale; readonly fmt: Fmt };

const catalogs: Readonly<Record<Locale, () => Catalog>> = {
  en: () => en,
  es: () => es,
  "en-XA": () => pseudoCatalog(en),
};

function bind<T>(catalog: T, fmt: Fmt): Bound<T> {
  const visit = (value: unknown): unknown => {
    if (typeof value === "function") return (params: unknown) => (value as (p: unknown, f: Fmt) => unknown)(params, fmt);
    if (Array.isArray(value) || value === null || typeof value !== "object") return value;
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)])));
  };
  return visit(catalog) as Bound<T>;
}

const bound = new Map<Locale, Messages>();

/** The bound messages for `locale`. Memoized: the same object for the same locale. */
export function messages(locale: Locale): Messages {
  let result = bound.get(locale);
  if (!result) {
    const info = localeInfo(locale);
    const fmt = createFmt(info.tag, info.quotes);
    result = Object.freeze({ ...bind(catalogs[locale](), fmt), locale, fmt }) as Messages;
    bound.set(locale, result);
  }
  return result;
}

/** Looks up a message by a runtime code, for code-keyed tables such as diagnostics and errors. */
export function byCode<T>(table: Readonly<Record<string, T>>, code: string): T | undefined {
  return Object.hasOwn(table, code) ? table[code] : undefined;
}
