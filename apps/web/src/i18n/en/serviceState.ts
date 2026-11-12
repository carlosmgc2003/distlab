import type { Fmt } from "../format.ts";

/** English source messages for the `serviceState` area (ADR-007). */
export const serviceState = {
  title: (time: number | string, _f: Fmt) => `Service state at t=${time}`,
  close: "Close",
};
