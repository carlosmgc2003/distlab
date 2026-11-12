import type { Fmt } from "../format.ts";

/**
 * English source messages for the `timeline` area (ADR-007): timeline.ts, timeline-query.ts,
 * timeline-quick-views.ts, and review-navigation.ts. The English wording is the wording the
 * Playwright suite asserts, except where a count of one was ungrammatical.
 */
const recorded = (n: number, f: Fmt) => f.plural(n, { one: "1 recorded observation", other: `${f.number(n)} recorded observations` });
const clause = (n: number, f: Fmt) => f.plural(n, { one: "1 observation", other: `${f.number(n)} observations` });

export const timeline = {
  /** Wording for one stored record, shared by the detail heading, the Learning row, the Story view, and playback. */
  recordLabels: {
    "network.request.sent": "Request sent",
    "network.request.delivered": "Request delivered",
    "network.request.dropped": "Request dropped",
    "network.request.timedout": "Request timed out",
    "network.response.sent": "Response sent",
    "network.response.received": "Response received",
    "network.response.dropped": "Response dropped",
    "message.published": "Message published",
    "message.delivered": "Message delivered",
    "message.acknowledged": "Message acknowledged",
    "message.ack.stale": "Stale message acknowledgement",
    "message.retry.scheduled": "Message retry scheduled",
    "database.transaction.committed": "Database transaction committed",
    "database.transaction.rolledback": "Database transaction rolled back",
    "external.effect.committed": "External side effect committed",
    "fault.rule.matched": "Fault rule matched",
    "fault.effect.selected": "Fault effect selected",
  },
  faultRecorded: "Fault recorded",
  deliveredAttempt: (attempt: number | string, _f: Fmt) => `Message delivered (attempt ${attempt})`,
  learningGroups: {
    setup: "Initial engine queue setup",
    assertion: "Unchanged assertion evaluations",
  },
  recordedChange: "Recorded change",
  /** The pseudo-component that records engine and clock events. */
  simulation: "Simulation",
  /** Graph highlight text for a selected record that is not a request or message movement. */
  selectedNoMovement: (p: { type: string; source: string; target?: string; time: number | string }, _f: Fmt) =>
    `Selected ${p.type} at ${p.target === undefined ? p.source : `${p.source} to ${p.target}`} at virtual time ${p.time}. No request or message movement.`,
  boundary: {
    none: "No visible observations.",
    /** Nothing selected yet. */
    unselected: (count: number, f: Fmt) => f.plural(count, {
      one: "1 visible observation. Next and Previous select it.",
      other: `${f.number(count)} visible observations. Next selects the first. Previous selects the last.`,
    }),
    position: (p: { index: number; count: number }, f: Fmt) => `Visible observation ${f.number(p.index)} of ${f.number(p.count)}.`,
    cannotMoveBoth: "Previous and Next cannot move.",
    cannotMovePrevious: "Previous cannot move.",
    cannotMoveNext: "Next cannot move.",
  },
  selection: (p: { sequence: number; type: string; time: number | string }, _f: Fmt) =>
    `Selected Observation #${p.sequence}: ${p.type} at virtual time ${p.time}.`,
  /** What a revealed record cleared, named by the field that was cleared. */
  clearedName: {
    fromTime: "virtual time from",
    toTime: "virtual time to",
    type: "type",
    component: "component",
    traceId: "trace",
    eventId: "event",
    entity: "entity",
  },
  clearedQuickView: (inline: string, _f: Fmt) => `${inline} quick view`,
  revealCleared: (names: readonly string[], f: Fmt) => f.plural(names.length, {
    one: `The ${f.list(names)} filter was cleared so this observation is visible.`,
    other: `The ${f.list(names)} filters were cleared so this observation is visible.`,
  }),
  traceAlready: (traceId: string, _f: Fmt) => `The timeline already shows trace ${traceId}.`,
  traceNow: (traceId: string, _f: Fmt) => `The timeline now shows trace ${traceId}.`,
  traceCleared: (names: readonly string[], f: Fmt) => f.plural(names.length, {
    one: `The ${f.list(names)} filter was cleared.`,
    other: `The ${f.list(names)} filters were cleared.`,
  }),
  payload: {
    omitted: "No data field was stored.",
    redacted: "Stored payload is redacted. Hidden fields are not available.",
    stored: "Stored payload",
  },
  terminal: {
    failure: (code: string | null, _f: Fmt) => code ? `Terminal failure ${code}.` : "Terminal failure.",
    historyIncomplete: "Execution history is incomplete.",
    historyComplete: "Execution history is complete.",
    historyNotReported: "Execution history completeness was not reported.",
    lastObservation: (id: string, _f: Fmt) => `Last recorded observation: ${id}.`,
  },

  // --- review navigation: feedback announced in the live region ---
  review: {
    notInHistory: "That observation is not in this history.",
    clearedAll: (total: number, f: Fmt) => f.plural(total, {
      one: "All filters and quick views were cleared. The 1 recorded observation is available again.",
      other: `All filters and quick views were cleared. ${f.number(total)} recorded observations are available again.`,
    }),
  },

  // --- timeline filters ---
  filterHelp: [
    "Filters combine with AND.",
    "Virtual time bounds are inclusive whole simulation times.",
    "Exact matches the full stored value, Prefix matches its start, and Contains matches a substring.",
    "Matching is case-sensitive and uses only this run's visible history.",
    "The suggestion list shows recorded values whose stored value or label contains the typed text.",
    "Choosing a suggestion applies Exact.",
    "A component matches when the source or the target matches.",
    "Entity kind and entity id must match the same stored entity reference.",
  ].join(" "),
  fieldNoun: {
    type: { noun: "Type", inline: "type" },
    component: { noun: "Component", inline: "component" },
    traceId: { noun: "Trace", inline: "trace" },
    eventId: { noun: "Event", inline: "event" },
    entityKind: { noun: "Entity kind", inline: "entity kind" },
    entityId: { noun: "Entity id", inline: "entity id" },
  },
  queryError: {
    notWholeTime: (p: { field: "fromTime" | "toTime"; value: string }, _f: Fmt) =>
      `Virtual time ${p.field === "fromTime" ? "from" : "to"} "${p.value}" is not a whole simulation time. Use a non-negative integer such as 0 or 12.`,
    timeOrder: (p: { from: number; to: number }, _f: Fmt) =>
      `Virtual time from ${p.from} is after virtual time to ${p.to}. Use a from time that is less than or equal to the to time.`,
  },
  chip: {
    timeFrom: (time: number, _f: Fmt) => `Virtual time from ${time} inclusive`,
    timeTo: (time: number, _f: Fmt) => `Virtual time to ${time} inclusive`,
    removeTimeFrom: "Remove virtual time from filter",
    removeTimeTo: "Remove virtual time to filter",
    exact: (p: { noun: string; value: string }, _f: Fmt) => `${p.noun} exactly ${p.value}`,
    prefix: (p: { noun: string; value: string }, _f: Fmt) => `${p.noun} starting with ${p.value}`,
    contains: (p: { noun: string; value: string }, _f: Fmt) => `${p.noun} containing ${p.value}`,
    removeField: (inline: string, _f: Fmt) => `Remove ${inline} filter`,
  },
  explain: {
    intro: "No observations match every active filter. Filters combine with AND.",
    resetDefault: "Remove a filter chip or clear all filters to see observations again.",
    resetQuickView: (inline: string, _f: Fmt) => `Remove the ${inline} quick view chip or clear all filters to see recorded observations again.`,
    timeBoth: (p: { from: number; to: number }, _f: Fmt) => `Virtual time is inclusive from ${p.from} to ${p.to}.`,
    timeFrom: (from: number, _f: Fmt) => `Virtual time is inclusive from ${from} onward.`,
    timeTo: (to: number, _f: Fmt) => `Virtual time is inclusive from the start to ${to}.`,
    excludedExact: (p: { noun: string; value: string; count: number }, f: Fmt) => f.plural(p.count, {
      one: `${p.noun} exactly "${p.value}" matches 1 observation. Another active filter excludes it.`,
      other: `${p.noun} exactly "${p.value}" matches ${f.number(p.count)} observations. Another active filter excludes them.`,
    }),
    excludedPrefix: (p: { noun: string; value: string; count: number }, f: Fmt) => f.plural(p.count, {
      one: `${p.noun} starting with "${p.value}" matches 1 observation. Another active filter excludes it.`,
      other: `${p.noun} starting with "${p.value}" matches ${f.number(p.count)} observations. Another active filter excludes them.`,
    }),
    excludedContains: (p: { noun: string; value: string; count: number }, f: Fmt) => f.plural(p.count, {
      one: `${p.noun} containing "${p.value}" matches 1 observation. Another active filter excludes it.`,
      other: `${p.noun} containing "${p.value}" matches ${f.number(p.count)} observations. Another active filter excludes them.`,
    }),
    notExact: (p: { noun: string; inline: string; value: string; values: readonly string[] }, f: Fmt) =>
      `${p.noun} "${p.value}" is not an exact recorded value. Recorded values containing "${p.value}": ${f.list(p.values)}. Choose one for an exact match, or set ${p.noun} match to Prefix or Contains.`,
    caseSensitive: (p: { inline: string; value: string; values: readonly string[] }, f: Fmt) =>
      `No recorded ${p.inline} contains "${p.value}". Matching is case-sensitive. Recorded values include ${f.list(p.values)}.`,
    noneRecorded: (p: { inline: string; value: string }, _f: Fmt) => `No recorded ${p.inline} matches "${p.value}".`,
    noneExact: (p: { inline: string; value: string; values: readonly string[] }, f: Fmt) =>
      `No recorded ${p.inline} equals "${p.value}". Recorded values containing "${p.value}": ${f.list(p.values)}.`,
    nonePrefix: (p: { inline: string; value: string; values: readonly string[] }, f: Fmt) =>
      `No recorded ${p.inline} starts with "${p.value}". Recorded values containing "${p.value}": ${f.list(p.values)}.`,
    noneContains: (p: { inline: string; value: string; values: readonly string[] }, f: Fmt) =>
      `No recorded ${p.inline} contains "${p.value}". Recorded values containing "${p.value}": ${f.list(p.values)}.`,
  },

  // --- quick views ---
  quickView: {
    help: "Quick views narrow the recorded history; they never change the run.",
    /** `label` names the view; `inline` is the same name inside a sentence; `keeps` and `empty` are whole sentences. */
    views: {
      "key-events": {
        label: "Key events",
        inline: "key events",
        keeps: "It keeps the teaching milestones of the Story view.",
        empty: (total: number, f: Fmt) => `The Key events quick view keeps the teaching milestones of the Story view, and this run recorded ${clause(total, f)} without any of them.`,
      },
      "faults-and-timeouts": {
        label: "Faults & timeouts",
        inline: "faults & timeouts",
        keeps: "It keeps fault rules, fault effects, dropped messages, and timeouts.",
        empty: (total: number, f: Fmt) => `The Faults & timeouts quick view keeps fault rules, fault effects, dropped messages, and timeouts, and this run recorded ${clause(total, f)} without any of them.`,
      },
      "requests-and-responses": {
        label: "Requests & responses",
        inline: "requests & responses",
        keeps: "It keeps recorded network requests and responses, including dropped and timed out ones.",
        empty: (total: number, f: Fmt) => `The Requests & responses quick view keeps recorded network requests and responses, including dropped and timed out ones, and this run recorded ${clause(total, f)} without any of them.`,
      },
      messages: {
        label: "Messages",
        inline: "messages",
        keeps: "It keeps published, delivered, acknowledged, and retried messages.",
        empty: (total: number, f: Fmt) => `The Messages quick view keeps published, delivered, acknowledged, and retried messages, and this run recorded ${clause(total, f)} without any of them.`,
      },
      "state-changes": {
        label: "State changes",
        inline: "state changes",
        keeps: "It keeps committed and rolled back transactions and committed external effects.",
        empty: (total: number, f: Fmt) => `The State changes quick view keeps committed and rolled back transactions and committed external effects, and this run recorded ${clause(total, f)} without any of them.`,
      },
      assertions: {
        label: "Assertions",
        inline: "assertions",
        keeps: "It keeps scenario assertion evaluations and their stored verdicts.",
        empty: (total: number, f: Fmt) => `The Assertions quick view keeps scenario assertion evaluations and their stored verdicts, and this run recorded ${clause(total, f)} without any of them.`,
      },
    },
    emptyRemove: "Remove the quick view chip to see the recorded history again.",
    /** "No quick view is active. Advanced filters show 3 of 267 recorded observations." */
    summaryNone: (p: { shown: number; recorded: number }, f: Fmt) =>
      `No quick view is active. Advanced filters show ${f.number(p.shown)} of ${recorded(p.recorded, f)}.`,
    summaryNothing: (p: { label: string; inline: string; recorded: number }, f: Fmt) =>
      `${p.label} shows 0 of ${recorded(p.recorded, f)}. This run recorded no ${p.inline}.`,
    summaryShown: (p: { label: string; shown: number; recorded: number }, f: Fmt) =>
      `${p.label} shows ${f.number(p.shown)} of ${recorded(p.recorded, f)}.`,
    feedbackCleared: (total: number, f: Fmt) => f.plural(total, {
      one: "Quick view cleared. The 1 recorded observation is available again.",
      other: `Quick view cleared. All ${f.number(total)} recorded observations are available again.`,
    }),
    feedbackApplied: (p: { label: string; shown: number; recorded: number }, f: Fmt) => f.plural(p.recorded, {
      one: `Quick view ${p.label} applied. It shows ${f.number(p.shown)} of 1 recorded observation and changes nothing in the run.`,
      other: `Quick view ${p.label} applied. It shows ${f.number(p.shown)} of ${f.number(p.recorded)} recorded observations and changes nothing in the run.`,
    }),
    chip: (label: string, _f: Fmt) => `Quick view ${label}`,
    removeChip: (label: string, _f: Fmt) => `Remove the ${label} quick view`,
  },
};
