import type { Fmt } from "../format.ts";

type Move = { source: string; target?: string; time: number };

/** English source messages for the `records` area (ADR-007): records.ts. */
export const records = {
  attemptSuffix: (attempt: number | string, _f: Fmt) => ` (attempt ${attempt})`,
  /** What a record label adds from stored fields (records.ts `storedQualifier`). The stored value is never translated. */
  qualifier: {
    detail: (text: string, _f: Fmt) => `: ${text}`,
    code: (text: string, _f: Fmt) => ` (${text})`,
    checkId: (id: string, _f: Fmt) => `: ${id}`,
    checkPassed: (id: string, _f: Fmt) => `: ${id} passed`,
    checkNotPassed: (id: string, _f: Fmt) => `: ${id} did not pass`,
    verdictPassed: ": passed",
    verdictNotPassed: ": did not pass",
  },
  noStoredFields: "No stored fields.",
  none: "None.",
  /** One sentence per stored movement type, keyed by the observation type code. */
  movement: {
    "network.request.sent": (p: Move) => p.target !== undefined
      ? `Request sent from ${p.source} to ${p.target} at virtual time ${p.time}.`
      : `Request sent at ${p.source} at virtual time ${p.time}.`,
    "network.request.delivered": (p: Move) => p.target !== undefined
      ? `Request delivered from ${p.source} to ${p.target} at virtual time ${p.time}.`
      : `Request delivered at ${p.source} at virtual time ${p.time}.`,
    "network.request.dropped": (p: Move) => p.target !== undefined
      ? `Request dropped from ${p.source} to ${p.target} at virtual time ${p.time}.`
      : `Request dropped at ${p.source} at virtual time ${p.time}.`,
    "network.request.timedout": (p: Move) => p.target !== undefined
      ? `Request timed out from ${p.source} to ${p.target} at virtual time ${p.time}.`
      : `Request timed out at ${p.source} at virtual time ${p.time}.`,
    "network.response.sent": (p: Move) => p.target !== undefined
      ? `Response sent from ${p.source} to ${p.target} at virtual time ${p.time}.`
      : `Response sent at ${p.source} at virtual time ${p.time}.`,
    "network.response.dropped": (p: Move) => p.target !== undefined
      ? `Response dropped from ${p.source} to ${p.target} at virtual time ${p.time}.`
      : `Response dropped at ${p.source} at virtual time ${p.time}.`,
    "network.response.received": (p: Move) => p.target !== undefined
      ? `Response received from ${p.source} to ${p.target} at virtual time ${p.time}.`
      : `Response received at ${p.source} at virtual time ${p.time}.`,
    "message.published": (p: Move) => p.target !== undefined
      ? `Message published from ${p.source} to ${p.target} at virtual time ${p.time}.`
      : `Message published at ${p.source} at virtual time ${p.time}.`,
    "message.delivered": (p: Move) => p.target !== undefined
      ? `Message delivered from ${p.source} to ${p.target} at virtual time ${p.time}.`
      : `Message delivered at ${p.source} at virtual time ${p.time}.`,
    "message.acknowledged": (p: Move) => p.target !== undefined
      ? `Message acknowledged by ${p.source} on ${p.target} at virtual time ${p.time}.`
      : `Message acknowledged at ${p.source} at virtual time ${p.time}.`,
  },
  /** A movement whose stored type has no sentence of its own: the raw type is shown. */
  movementUnknown: (p: Move & { type: string }, _f: Fmt) => p.target !== undefined
    ? `Movement ${p.type} from ${p.source} to ${p.target} at virtual time ${p.time}.`
    : `Movement ${p.type} at ${p.source} at virtual time ${p.time}.`,
};
