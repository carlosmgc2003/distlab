import type { CanonicalValue } from "./kernel/canonical.js";

export const RuntimeObservationTypes = {
  Log: "runtime.log",
} as const;

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Controlled log write. Validates and records synchronously; no host I/O. */
export interface RuntimeLogger {
  write(level: LogLevel, message: string, data?: CanonicalValue): void;
}
