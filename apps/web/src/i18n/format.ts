/**
 * Locale-aware formatting for message catalogs (ADR-007). Built only on the
 * platform's `Intl`, so the main thread gains no runtime dependency.
 *
 * Presentation only: nothing here reads virtual time, the host clock, or
 * simulation state, and nothing formatted here enters a projection, a worker
 * command, or recorded history.
 */
export type PluralForms = Readonly<Partial<Record<Intl.LDMLPluralRule, string>>> & { readonly other: string };

export interface Fmt {
  /** BCP 47 tag used for `Intl`, for example `en` or `es`. */
  readonly tag: string;
  /** Picks the plural form for `count`. Write every form as a whole phrase: "1 lesson", "{n} lessons". */
  plural(count: number, forms: PluralForms): string;
  /** A number with the locale's digit grouping and decimal mark. */
  number(value: number, options?: Intl.NumberFormatOptions): string;
  /** "A, B, and C" / "A, B y C". `or` gives "A, B, or C" / "A, B o C". */
  list(items: readonly string[], type?: "and" | "or" | "unit"): string;
  /** Text quoted with the locale's quotation marks. */
  quote(text: string): string;
}

export function createFmt(tag: string, quotes: readonly [string, string] = ["“", "”"]): Fmt {
  const plurals = new Intl.PluralRules(tag);
  const numbers = new Map<string, Intl.NumberFormat>();
  const lists = {
    and: new Intl.ListFormat(tag, { type: "conjunction" }),
    or: new Intl.ListFormat(tag, { type: "disjunction" }),
    unit: new Intl.ListFormat(tag, { type: "unit", style: "narrow" }),
  };
  return {
    tag,
    plural: (count, forms) => forms[plurals.select(count)] ?? forms.other,
    number(value, options) {
      const key = JSON.stringify(options ?? {});
      let format = numbers.get(key);
      if (!format) { format = new Intl.NumberFormat(tag, options); numbers.set(key, format); }
      return format.format(value);
    },
    list: (items, type = "and") => lists[type].format(items),
    quote: text => `${quotes[0]}${text}${quotes[1]}`,
  };
}
