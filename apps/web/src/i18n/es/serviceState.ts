import type { serviceState as source } from "../en/serviceState.ts";
import type { Fmt } from "../format.ts";

/** Spanish messages for the `serviceState` area. Typed by the English source, so keys and parameters must match. */
export const serviceState: typeof source = {
  title: (time: number | string, _f: Fmt) => `Estado de los servicios en t=${time}`,
  close: "Cerrar",
};
