import type { Fmt } from "../format.ts";

/** English source messages for the `common` area (ADR-007): words shared by several screens. */
export const common = {
  brand: "DistLab",
  language: "Language",
  languageHelp: "Interface language. Recorded history, component IDs, and scenario data stay as recorded.",
  virtualTime: (time: number | string, _f: Fmt) => `virtual time ${time}`,
};
