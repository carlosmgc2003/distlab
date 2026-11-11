import type { PackagedScenario } from "./scenarios.ts";

/**
 * The topics the Lesson chooser and the empty workspace classify packaged lessons by. This is
 * presentation copy over the catalog, like the lesson titles in `scenarios.ts`: it adds no catalog
 * metadata and never reaches the worker. Topics follow the usual order of a distributed-systems
 * course, from what one request can and cannot tell its caller to concurrent writers.
 */
export const lessonTopics = [
  { id: "partial-failure", title: "Partial failure and idempotency",
    summary: "A request can fail, succeed without a reply, or take effect twice. Timeouts, indeterminate outcomes, retries, and idempotency keys." },
  { id: "fault-tolerance", title: "Fault tolerance and overload",
    summary: "A slow or unreachable dependency spreads to its callers. Bounded retries, dead-letter queues, and circuit breakers." },
  { id: "transactions", title: "Distributed transactions and messaging",
    summary: "Several services commit independently. Sagas and compensation, dual writes, the transactional outbox, and idempotent consumers." },
  { id: "consistency", title: "Replication and consistency",
    summary: "A copy of data lags behind its source. Read models, eventual consistency, caches, staleness, and invalidation." },
  { id: "concurrency", title: "Concurrency control",
    summary: "Two writers race on shared state. Check-then-act anomalies, transactions, and optimistic concurrency." },
  { id: "time-coordination", title: "Time, ordering, and coordination",
    summary: "Clocks disagree and processes stall. Clock skew, last-writer-wins, Lamport timestamps, leases, and fencing tokens." },
] as const;

export type LessonTopicId = (typeof lessonTopics)[number]["id"];

interface LessonClassification {
  readonly topic: LessonTopicId;
  /** Course vocabulary the lesson exercises, shown on its card and matched by search. */
  readonly concepts: readonly string[];
}

/** Every packaged lesson has exactly one topic; the type fails to check when a lesson is missing. */
const classification = {
  "normal": { topic: "partial-failure", concepts: ["request/response", "commit before reply"] },
  "response-lost": { topic: "partial-failure", concepts: ["timeout", "indeterminate outcome"] },
  "retry-unsafe": { topic: "partial-failure", concepts: ["retry", "duplicate effect"] },
  "retry-idempotent": { topic: "partial-failure", concepts: ["retry", "idempotency key"] },
  "notifications-unbounded": { topic: "fault-tolerance", concepts: ["unbounded retry", "synchronous coupling"] },
  "notifications-dlq": { topic: "fault-tolerance", concepts: ["bounded retry", "dead-letter queue"] },
  "cascade-unprotected": { topic: "fault-tolerance", concepts: ["cascading failure", "timeout"] },
  "cascade-breaker": { topic: "fault-tolerance", concepts: ["circuit breaker", "fail fast"] },
  "saga-uncompensated": { topic: "transactions", concepts: ["saga", "partial commit"] },
  "saga-compensated": { topic: "transactions", concepts: ["saga", "compensating action"] },
  "dual-write": { topic: "transactions", concepts: ["dual write", "crash"] },
  "outbox-unsafe-consumer": { topic: "transactions", concepts: ["transactional outbox", "at-least-once delivery"] },
  "outbox-idempotent": { topic: "transactions", concepts: ["transactional outbox", "idempotent consumer", "inbox"] },
  "outbox-notifications-gap": { topic: "transactions", concepts: ["transactional outbox", "design exercise"] },
  "cqrs-delayed": { topic: "consistency", concepts: ["CQRS", "read model", "eventual consistency"] },
  "cache-stale-price": { topic: "consistency", concepts: ["cache", "stale read", "TTL"] },
  "cache-invalidated": { topic: "consistency", concepts: ["cache", "invalidation"] },
  "inventory-oversell": { topic: "concurrency", concepts: ["race condition", "check-then-act"] },
  "inventory-optimistic": { topic: "concurrency", concepts: ["optimistic concurrency", "version check"] },
  "lease-unfenced": { topic: "time-coordination", concepts: ["lease", "set-if-absent with TTL", "process pause", "stale writer"] },
  "lease-fenced": { topic: "time-coordination", concepts: ["lease", "fencing token"] },
  "clock-last-write-wins": { topic: "time-coordination", concepts: ["clock skew", "last-writer-wins", "multi-leader replication"] },
  "clock-lamport": { topic: "time-coordination", concepts: ["Lamport clock", "causality", "happens-before"] },
} as const satisfies Record<PackagedScenario["id"], LessonClassification>;

/** The topic and concepts of a packaged lesson, or `undefined` for an id outside the catalog. */
export function lessonClassification(id: string): LessonClassification | undefined {
  return (classification as Record<string, LessonClassification>)[id];
}

export interface TopicSection<T> {
  readonly topic: (typeof lessonTopics)[number];
  /** Lesson groups (a failing lesson beside its fix) in this topic, in catalog order. */
  readonly groups: readonly (readonly T[])[];
}

/** `"all"` shows every topic. */
export type TopicFilter = LessonTopicId | "all";

const normalize = (text: string) => text.toLocaleLowerCase().replace(/\s+/g, " ").trim();

interface SearchableLesson { readonly id: string; readonly title: string; readonly description: string }

/**
 * True when every word of the query occurs in the lesson's title, its displayed label (which can
 * differ from the title), description, topic, or concepts. Case and spacing are ignored.
 */
export function lessonMatches(lesson: SearchableLesson, query: string, label = ""): boolean {
  const words = normalize(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const entry = lessonClassification(lesson.id);
  const topic = lessonTopics.find(item => item.id === entry?.topic);
  const haystack = normalize([lesson.title, label, lesson.description, topic?.title ?? "", ...(entry?.concepts ?? [])].join(" "));
  return words.every(word => haystack.includes(word));
}

/**
 * Sorts lesson groups into topic sections and applies the chooser's filters. A group is the unit
 * of teaching, so it is shown whole when any of its lessons matches the query. A group's topic is
 * its first lesson's; a group with no classified lesson is left out. Empty sections are omitted.
 */
export function topicSections<T extends SearchableLesson>(groups: readonly (readonly T[])[], filter: TopicFilter = "all",
  query = "", labelOf: (lesson: T) => string = () => ""): readonly TopicSection<T>[] {
  return lessonTopics
    .filter(topic => filter === "all" || topic.id === filter)
    .map(topic => ({
      topic,
      groups: groups.filter(group => lessonClassification(group[0]?.id ?? "")?.topic === topic.id
        && group.some(lesson => lessonMatches(lesson, query, labelOf(lesson)))),
    }))
    .filter(section => section.groups.length > 0);
}

/** The concepts of a group, each once, in lesson order. */
export function groupConcepts(group: readonly { readonly id: string }[]): readonly string[] {
  return [...new Set(group.flatMap(lesson => lessonClassification(lesson.id)?.concepts ?? []))];
}
