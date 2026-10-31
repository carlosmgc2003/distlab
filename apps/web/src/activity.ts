import type { Observation, SimulationTime } from "@distlab/contracts";
import { orderObservations, storedScalar, storedText } from "./records.ts";

/**
 * Component activity at the playback cursor, read only from stored records at
 * or before the cursor. Nothing here is inferred from records that were not
 * written, and a redacted or omitted payload contributes nothing: without its
 * stored request, delivery, or transaction id a record cannot open or close
 * anything.
 *
 * - processing: a request delivered to the component with no response sent yet,
 *   an open transaction, or a MessageBus delivery not yet acknowledged.
 * - waiting: the component sent a request and has recorded neither a response
 *   nor a timeout for it. A dropped request or response does not end the wait:
 *   the caller has not recorded anything, which is the point of the timeout lessons.
 * - idle: neither of the above.
 */
export type ActivityState = "idle" | "processing" | "waiting";

export interface ActivityWait {
  readonly target: string;
  /** Stored deadline of the request, when one is recorded. */
  readonly deadline?: SimulationTime;
}

export interface ActivityWork {
  readonly kind: "request" | "transaction" | "delivery";
}

export interface ComponentActivity {
  readonly componentId: string;
  readonly state: ActivityState;
  readonly waits: readonly ActivityWait[];
  readonly work: readonly ActivityWork[];
  /** Set when the record at the cursor is this component's request timeout. */
  readonly timedOut?: { readonly target: string; readonly time: SimulationTime };
  /** Short badge text: the state word plus the earliest stored deadline. */
  readonly label: string;
  /** One sentence for assistive technology and the narration. */
  readonly description: string;
}

const STATE_WORDS = { idle: "Idle", processing: "Processing", waiting: "Waiting" } as const satisfies Record<ActivityState, string>;

/** Text and shape cue for each state, so colour never carries the meaning alone. */
export const ACTIVITY_SYMBOLS = { idle: "○", processing: "⚙", waiting: "⏳" } as const satisfies Record<ActivityState, string>;

interface Open<T> { readonly owner: string; readonly value: T }

/**
 * Activity of every component a record touches, at the record named by
 * `cursorId`. With no cursor, or a cursor id this history does not hold, the
 * result is empty and every component reads as idle.
 */
export function activityAt(observations: readonly Observation[], cursorId: string | null | undefined): ReadonlyMap<string, ComponentActivity> {
  const result = new Map<string, ComponentActivity>();
  if (cursorId === null || cursorId === undefined) return result;
  const ordered = orderObservations(observations);
  const end = ordered.findIndex(item => item.id === cursorId);
  if (end < 0) return result;

  const waits = new Map<string, Open<ActivityWait>>();
  const requests = new Map<string, Open<ActivityWork>>();
  const transactions = new Map<string, Open<ActivityWork>>();
  const deliveries = new Map<string, Open<ActivityWork>>();
  const seen = new Set<string>();
  let timedOut: { readonly owner: string; readonly target: string; readonly time: SimulationTime } | undefined;

  for (let index = 0; index <= end; index += 1) {
    const record = ordered[index]!;
    const requestId = storedText(record, "requestId");
    switch (record.type) {
      case "network.request.sent": {
        if (requestId === undefined || record.target === undefined) break;
        const deadline = storedScalar(record, "deadline");
        const stored = deadline !== undefined && Number.isFinite(Number(deadline)) ? Number(deadline) as SimulationTime : undefined;
        waits.set(requestId, { owner: record.source, value: { target: record.target, ...(stored !== undefined ? { deadline: stored } : {}) } });
        seen.add(record.source);
        break;
      }
      case "network.response.received":
      case "network.request.timedout":
        if (requestId !== undefined) waits.delete(requestId);
        break;
      case "network.request.delivered":
        if (requestId === undefined || record.target === undefined) break;
        requests.set(requestId, { owner: record.target, value: { kind: "request" } });
        seen.add(record.target);
        break;
      case "network.response.sent":
        if (requestId !== undefined) requests.delete(requestId);
        break;
      case "database.transaction.begun": {
        const transactionId = storedText(record, "transactionId");
        if (transactionId === undefined) break;
        transactions.set(transactionId, { owner: record.source, value: { kind: "transaction" } });
        seen.add(record.source);
        break;
      }
      case "database.transaction.committed":
      case "database.transaction.rolledback": {
        const transactionId = storedText(record, "transactionId");
        if (transactionId !== undefined) transactions.delete(transactionId);
        break;
      }
      case "message.delivered": {
        const deliveryId = storedText(record, "deliveryId");
        if (deliveryId === undefined) break;
        const consumer = storedText(record, "consumer") ?? record.source;
        deliveries.set(deliveryId, { owner: consumer, value: { kind: "delivery" } });
        seen.add(consumer);
        break;
      }
      case "message.acknowledged":
      case "message.ack.stale":
      case "message.nacked": {
        const deliveryId = storedText(record, "deliveryId");
        if (deliveryId !== undefined) deliveries.delete(deliveryId);
        break;
      }
    }
    if (index === end && record.type === "network.request.timedout" && record.target !== undefined) {
      timedOut = { owner: record.source, target: record.target, time: record.time };
      seen.add(record.source);
    }
  }

  const owned = <T>(open: ReadonlyMap<string, Open<T>>, owner: string): T[] =>
    [...open.values()].filter(item => item.owner === owner).map(item => item.value);
  for (const componentId of [...seen].sort()) {
    const componentWaits = owned(waits, componentId);
    const work = [...owned(requests, componentId), ...owned(transactions, componentId), ...owned(deliveries, componentId)];
    const state: ActivityState = componentWaits.length > 0 ? "waiting" : work.length > 0 ? "processing" : "idle";
    const cue = timedOut?.owner === componentId ? { target: timedOut.target, time: timedOut.time } : undefined;
    result.set(componentId, describe(componentId, state, componentWaits, work, cue));
  }
  return result;
}

/** The activity of one component, or idle when no record at the cursor gives it any. */
export function activityOf(activity: ReadonlyMap<string, ComponentActivity>, componentId: string): ComponentActivity {
  return activity.get(componentId) ?? describe(componentId, "idle", [], [], undefined);
}

/**
 * One sentence per component whose activity differs between two cursor
 * positions, in component order, for the live region.
 */
export function activityChanges(
  before: ReadonlyMap<string, ComponentActivity>,
  after: ReadonlyMap<string, ComponentActivity>,
): readonly string[] {
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changes: string[] = [];
  for (const id of ids) {
    const previous = activityOf(before, id);
    const next = activityOf(after, id);
    // A timeout at the cursor is announced even when the state word stays the same.
    if (previous.description !== next.description || next.timedOut !== undefined) changes.push(next.description);
  }
  return changes;
}

function describe(
  componentId: string,
  state: ActivityState,
  waits: readonly ActivityWait[],
  work: readonly ActivityWork[],
  timedOut: ComponentActivity["timedOut"],
): ComponentActivity {
  const deadlines = waits.flatMap(wait => wait.deadline !== undefined ? [wait.deadline] : []);
  const earliest = deadlines.length > 0 ? Math.min(...deadlines) : undefined;
  const label = `${STATE_WORDS[state]}${state === "waiting" && earliest !== undefined ? ` · deadline t=${earliest}` : ""}`;
  const parts: string[] = [];
  if (waits.length > 0) {
    const targets = [...new Set(waits.map(wait => wait.target))].join(", ");
    parts.push(`waiting on ${targets}${earliest !== undefined ? ` with a recorded deadline at virtual time ${earliest}` : " with no recorded deadline"}`);
  }
  if (work.length > 0) parts.push(`processing ${workText(work)}`);
  const timeout = timedOut !== undefined ? ` Its request to ${timedOut.target} timed out at virtual time ${timedOut.time}.` : "";
  const description = parts.length > 0
    ? `${componentId} is ${parts.join(" and ")}.${timeout}`
    : `${componentId} is idle.${timeout}`;
  return { componentId, state, waits, work, ...(timedOut !== undefined ? { timedOut } : {}), label, description };
}

function workText(work: readonly ActivityWork[]): string {
  const count = (kind: ActivityWork["kind"]) => work.filter(item => item.kind === kind).length;
  const phrases: string[] = [];
  const requests = count("request");
  const transactions = count("transaction");
  const deliveries = count("delivery");
  if (requests > 0) phrases.push(requests === 1 ? "a delivered request" : `${requests} delivered requests`);
  if (transactions > 0) phrases.push(transactions === 1 ? "an open transaction" : `${transactions} open transactions`);
  if (deliveries > 0) phrases.push(deliveries === 1 ? "an unacknowledged message delivery" : `${deliveries} unacknowledged message deliveries`);
  return phrases.join(", ");
}
