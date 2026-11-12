import type { Observation, SimulationTime } from "@distlab/contracts";
import { orderObservations, storedScalar, storedText } from "./records.ts";
import type { Messages } from "./i18n/catalog.ts";
import { displayName } from "./component-display.ts";
import type { ComponentNames } from "./component-display.ts";

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
}

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
    result.set(componentId, derive(componentId, state, componentWaits, work, cue));
  }
  return result;
}

/** The activity of one component, or idle when no record at the cursor gives it any. */
export function activityOf(activity: ReadonlyMap<string, ComponentActivity>, componentId: string): ComponentActivity {
  return activity.get(componentId) ?? derive(componentId, "idle", [], [], undefined);
}

/**
 * One sentence per component whose activity differs between two cursor
 * positions, in component order, for the live region. Change is decided on
 * the structured summary, never on rendered text, so it does not depend on the
 * language.
 */
export function activityChanges(
  before: ReadonlyMap<string, ComponentActivity>,
  after: ReadonlyMap<string, ComponentActivity>,
  m: Messages,
  /** Display names for the sentences (#103); IDs stay in `componentId` and `target`. */
  names?: ComponentNames,
): readonly string[] {
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changes: string[] = [];
  for (const id of ids) {
    const previous = activityOf(before, id);
    const next = activityOf(after, id);
    // A timeout at the cursor is announced even when the state stays the same.
    if (summaryKey(previous) !== summaryKey(next) || next.timedOut !== undefined) changes.push(activityDescription(next, m, names));
  }
  return changes;
}

/** What the badge and the sentence say, as data: the state, the distinct targets, the earliest deadline, and the work counts. */
interface ActivitySummary {
  readonly state: ActivityState;
  readonly targets: readonly string[];
  readonly earliest?: SimulationTime;
  readonly requests: number;
  readonly transactions: number;
  readonly deliveries: number;
  readonly timedOut?: ComponentActivity["timedOut"];
}

function summarize(activity: ComponentActivity): ActivitySummary {
  const deadlines = activity.waits.flatMap(wait => wait.deadline !== undefined ? [wait.deadline] : []);
  const count = (kind: ActivityWork["kind"]) => activity.work.filter(item => item.kind === kind).length;
  return {
    state: activity.state,
    targets: [...new Set(activity.waits.map(wait => wait.target))],
    ...(deadlines.length > 0 ? { earliest: Math.min(...deadlines) as SimulationTime } : {}),
    requests: count("request"),
    transactions: count("transaction"),
    deliveries: count("delivery"),
    ...(activity.timedOut !== undefined ? { timedOut: activity.timedOut } : {}),
  };
}

function summaryKey(activity: ComponentActivity): string {
  return JSON.stringify(summarize(activity));
}

function derive(
  componentId: string,
  state: ActivityState,
  waits: readonly ActivityWait[],
  work: readonly ActivityWork[],
  timedOut: ComponentActivity["timedOut"],
): ComponentActivity {
  return { componentId, state, waits, work, ...(timedOut !== undefined ? { timedOut } : {}) };
}

/** Short badge text: the state word, plus the earliest stored deadline while waiting. */
export function activityLabel(activity: ComponentActivity, m: Messages): string {
  const { earliest } = summarize(activity);
  return activity.state === "waiting" && earliest !== undefined
    ? m.architecture.activity.waitingUntil(earliest)
    : m.architecture.activity.state[activity.state];
}

/** One sentence for assistive technology and the narration. */
export function activityDescription(activity: ComponentActivity, m: Messages, names?: ComponentNames): string {
  const summary = summarize(activity);
  // Sentences name components by display name (#103).
  const id = displayName(names, activity.componentId);
  const copy = m.architecture.activity;
  const targets = m.fmt.list(summary.targets.map(target => displayName(names, target)));
  const work = workText(summary, m);
  const waiting = summary.targets.length > 0;
  const processing = work !== "";
  const main = waiting && processing ? copy.waitingAndProcessing({ id, targets, work, ...(summary.earliest !== undefined ? { deadline: summary.earliest } : {}) })
    : waiting ? copy.waiting({ id, targets, ...(summary.earliest !== undefined ? { deadline: summary.earliest } : {}) })
    : processing ? copy.processing({ id, work })
    : copy.idle(id);
  return summary.timedOut !== undefined ? `${main} ${copy.timedOut({ target: displayName(names, summary.timedOut.target), time: summary.timedOut.time })}` : main;
}

/** The open work as a noun phrase: whole phrases per count, joined as a list. */
function workText(summary: ActivitySummary, m: Messages): string {
  const phrases: string[] = [];
  if (summary.requests > 0) phrases.push(m.architecture.activity.work.requests(summary.requests));
  if (summary.transactions > 0) phrases.push(m.architecture.activity.work.transactions(summary.transactions));
  if (summary.deliveries > 0) phrases.push(m.architecture.activity.work.deliveries(summary.deliveries));
  return m.fmt.list(phrases);
}
