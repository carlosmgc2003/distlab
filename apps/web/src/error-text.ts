import type { ApplicationError } from "@distlab/contracts";
import type { Messages } from "./i18n/catalog.ts";

type ErrorKey = keyof Messages["errors"]["text"];

/**
 * Developer messages the host, the assessment runner, and the worker put in `ApplicationError.message`,
 * by the catalog key that renders them (ADR-007). A code alone is ambiguous: `INVALID_WORKER_COMMAND`,
 * `WORKER_UNAVAILABLE`, and `SIMULATION_FAILED` each carry several different messages. The worker stays
 * unchanged and never imports the catalogs, so `message` remains developer text in the protocol.
 */
const known: Readonly<Record<string, ErrorKey>> = {
  "A simulation control is already in progress.": "controlBusy",
  "Expected a version 1 worker command.": "invalidCommand",
  "The command does not match protocol version 1.": "protocolMismatch",
  "Load a scenario before sending controls.": "noSession",
  "The simulation control could not be applied.": "controlNotApplied",
  "The worker host was closed.": "hostClosed",
  "The simulation worker stopped or could not exchange messages.": "workerStopped",
  "The worker returned an invalid protocol message.": "invalidProtocolMessage",
  "A new scenario replaced the previous session.": "sessionReplaced",
  "The simulation failed at an event boundary.": "failedAtBoundary",
  "The simulation failed before the pause completed.": "failedBeforePause",
  "The scenario could not be loaded.": "scenarioNotLoaded",
  "The scenario document is not valid.": "documentInvalid",
  "The session overlay is not allowed for this lesson or makes the lesson invalid.": "overlayInvalid",
  "The row's overlay was rejected.": "overlayRowRejected",
  "The suite could not continue.": "suiteStopped",
};

/** Errors that name their own reason in `context.reason`, by `<code>/<reason>`. */
const byReason: Readonly<Record<string, ErrorKey>> = {
  "INVALID_WORKER_COMMAND/CONTROL_BUSY": "controlBusy",
};

function reasonOf(context: ApplicationError["context"]): string | undefined {
  if (context === null || typeof context !== "object" || Array.isArray(context)) return undefined;
  const reason = (context as { readonly reason?: unknown }).reason;
  return typeof reason === "string" ? reason : undefined;
}

/**
 * The text a student reads for an application error, in the active language. It renders by code and reason
 * (and, where a code is shared, by the protocol's developer message), and falls back to `error.message` for an
 * error it does not know, so a new worker error still shows something. The English text equals the message.
 */
export function errorText(error: ApplicationError, m: Messages): string {
  const reason = reasonOf(error.context);
  const key = (reason !== undefined ? Object.hasOwn(byReason, `${error.code}/${reason}`) ? byReason[`${error.code}/${reason}`] : undefined : undefined)
    ?? (Object.hasOwn(known, error.message) ? known[error.message] : undefined);
  return key !== undefined ? m.errors.text[key] : error.message;
}
