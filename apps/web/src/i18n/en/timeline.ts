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

  // --- TimelineView.tsx: text only the component renders ---
  view: {
    heading: "Recorded history",
    viewSwitch: "Timeline view",
    /** The view tabs. The Story tab has two presentations. */
    viewChoices: {
      "story-diagram": "Story diagram",
      "story-table": "Story table",
      learning: "Learning",
      raw: "Raw",
    },
    orderHint: {
      label: "Row order",
      body: "Next observation selects a recorded observation; it does not execute an event. Rows follow observation sequence, including observations at equal virtual times.",
    },
    show: "Show",
    allCategories: "All categories",
    component: "Component",
    allComponents: "All components",
    moreFilters: "More filters…",
    shown: (p: { shown: number; total: number }, f: Fmt) => `${f.number(p.shown)} of ${f.number(p.total)} shown`,
    chipGroup: "Active filters and reset",
    chipList: "Active filters",
    remove: "Remove",
    clearAll: "Clear all filters",
    /** The Raw and Story count line: `shown` of `total` visible, in recorded order. */
    count: (p: { shown: number; total: number }, f: Fmt) => f.plural(p.total, {
      one: `${f.number(p.shown)} of 1 observation in virtual-time order.`,
      other: `${f.number(p.shown)} of ${f.number(p.total)} observations in virtual-time order.`,
    }),
    countLearning: (p: { shown: number; total: number; items: number; hidden: number }, f: Fmt) =>
      `${f.plural(p.total, {
        one: `${f.number(p.shown)} of 1 observation in virtual-time order.`,
        other: `${f.number(p.shown)} of ${f.number(p.total)} observations in virtual-time order.`,
      })} Learning view shows ${f.plural(p.items, { one: "1 item", other: `${f.number(p.items)} items` })}; ${f.plural(p.hidden, {
        one: "1 record",
        other: `${f.number(p.hidden)} records`,
      })} summarized in expandable groups. Select a row to inspect its details.`,
    learningHeadings: {
      summary: "Summary",
      timeSequence: "Virtual time · sequence",
      destination: "Component / destination",
    },
    rowsLabel: {
      story: "Story milestone strip and table",
      learning: "Learning timeline observations",
      raw: "Raw timeline observations",
    },
    noObservations: "No observations have been recorded for this run.",

    // Story view
    readingStory: "Reading the story",
    storyHint: (summary: string, _f: Fmt) => `${summary} Columns follow recorded sequence, not elapsed duration. Select a milestone for details.`,
    storyNoMilestones: "None of the visible records is a teaching milestone. Use Learning or Raw to read them.",
    legendLabel: "Milestone categories, shapes, and counts",
    diagramLabel: "Story diagram",
    corner: "Component",
    milestoneLabel: (p: { label: string; component: string; time: number | string; sequence: number | string }, _f: Fmt) =>
      `${p.label}, ${p.component}, virtual time ${p.time}, sequence ${p.sequence}`,
    tableCaption: (reduction: string, _f: Fmt) => `${reduction} Each row selects the same recorded observation as the strip.`,
    tableHeads: {
      milestone: "Milestone",
      category: "Category",
      time: "Virtual time",
      sequence: "Sequence",
      destination: "Component / destination",
    },
    timeUnchanged: (time: number | string, _f: Fmt) => `t=${time} (unchanged)`,

    // Learning rows
    rowTitle: (p: { summary: string; type: string }, _f: Fmt) => `${p.summary} — ${p.type}`,
    groupHide: (p: { count: number; summary: string; firstSequence: number; lastSequence: number; firstTime: number | string; lastTime: number | string }, f: Fmt) =>
      `${f.plural(p.count, { one: "Hide 1 record", other: `Hide ${f.number(p.count)} records` })}: ${p.summary} (#${p.firstSequence}–#${p.lastSequence}, t=${p.firstTime}–${p.lastTime})`,
    groupShow: (p: { count: number; summary: string; firstSequence: number; lastSequence: number; firstTime: number | string; lastTime: number | string }, f: Fmt) =>
      `${f.plural(p.count, { one: "Show 1 record", other: `Show ${f.number(p.count)} records` })}: ${p.summary} (#${p.firstSequence}–#${p.lastSequence}, t=${p.firstTime}–${p.lastTime})`,
    openRaw: "Open raw observation",

    // More filters dialog
    moreTitle: "More filters",
    matchingHint: "How matching works",
    filtersCombine: "Filters combine. Choose another field to narrow further; remove any condition using its chip below.",
    filtersForm: "Timeline filters",
    timeFrom: "Virtual time from",
    timeTo: "Virtual time to",
    filterBy: "Filter by",
    apply: "Apply",
    clear: "Clear",
    cancel: "Cancel",
    matchMode: { exact: "Exact", prefix: "Prefix", contains: "Contains" },
    matchLabel: (noun: string, _f: Fmt) => `${noun} match`,
    choicesLabel: (noun: string, _f: Fmt) => `${noun} choices`,
    noValues: (value: string, _f: Fmt) => `No recorded values contain "${value}".`,
    moreValues: (hidden: number, f: Fmt) => `${f.number(hidden)} more. Keep typing to narrow this list.`,

    // Observation detail
    detailHeading: "Observation detail",
    detailEmpty: "Select an observation to see its detail.",
    hiddenByFilters: "This observation is hidden by the current filters.",
    detailHeader: (p: { sequence: number; heading: string; time: number | string }, _f: Fmt) => `Observation #${p.sequence} · ${p.heading} · t=${p.time}`,
    fieldsSummary: "Record fields & filter shortcuts",
    fields: {
      sequence: "Sequence",
      time: "Virtual time",
      source: "Source",
      target: "Target",
      payload: "Payload",
    },
    useSource: "Use source as component filter",
    useTarget: "Use target as component filter",
    /** What a copy button copies, named inside "Copy …", "Copied …" and "… to copy". */
    copyWhat: {
      source: "source id",
      target: "target id",
      observation: "observation id",
      trace: "trace id",
      event: "event id",
    },
    copy: (what: string, _f: Fmt) => `Copy ${what}`,
    copied: (what: string, _f: Fmt) => `Copied ${what}`,
    manualCopy: (what: string, _f: Fmt) => `${what} to copy`,
    effectHeading: "Effect and evidence",
    noEvidence: "No before or after values were stored.",
    before: "Before",
    after: "After",
    beforeMissing: "Before was not stored.",
    afterMissing: "After was not stored.",
    relatedSummary: "Related evidence",
    causation: "Causation",
    selectCause: (p: { type: string; time: number | string }, _f: Fmt) => `Select causing observation ${p.type} at virtual time ${p.time}`,
    selectEffect: (p: { type: string; time: number | string }, _f: Fmt) => `Select effect ${p.type} at virtual time ${p.time}`,
    causeMissing: (id: string, _f: Fmt) => `Causation ${id} is not in this history.`,
    noCausation: "No causation reference was stored.",
    moreEffects: (count: number, f: Fmt) => f.plural(count, {
      one: "1 more effect. Show this trace to read them in order.",
      other: `${f.number(count)} more effects. Show this trace to read them in order.`,
    }),
    noEffects: "No later observation points at this record.",
    trace: "Trace",
    showTrace: "Show this trace",
    noTrace: "This observation has no trace.",
    filterFromObservation: "Filter from this observation",
    useEvent: "Use this event",
    useEntity: (p: { kind: string; id: string }, _f: Fmt) => `Use entity ${p.kind} ${p.id}`,
    technicalSummary: "Technical record",
    technical: {
      observation: "Observation",
      type: "Type",
      trace: "Trace",
      span: "Span",
      parentSpan: "Parent span",
      causation: "Causation",
      event: "Event",
      entities: "Entities",
    },
    storedData: "Stored data",
    unspanned: "Observations without a span",
    typeAt: (p: { type: string; time: number | string }, _f: Fmt) => `${p.type} at virtual time ${p.time}`,
    moreUnspanned: (count: number, f: Fmt) => f.plural(count, {
      one: "1 more observation has no span.",
      other: `${f.number(count)} more observations have no span.`,
    }),
    spanLine: (p: { spanId: string; count: number }, f: Fmt) =>
      `Span ${p.spanId}. ${f.plural(p.count, { one: "1 observation", other: `${f.number(p.count)} observations` })}.`,
    spanLineParent: (p: { spanId: string; parentSpanId: string; count: number }, f: Fmt) =>
      `Span ${p.spanId}, parent ${p.parentSpanId}. ${f.plural(p.count, { one: "1 observation", other: `${f.number(p.count)} observations` })}.`,
    moreInSpan: (count: number, f: Fmt) => f.plural(count, {
      one: "1 more observation in this span. Show this trace to read them in order.",
      other: `${f.number(count)} more observations in this span. Show this trace to read them in order.`,
    }),
    nestedSpans: (count: number, f: Fmt) => f.plural(count, {
      one: "1 nested span. Use the trace filter to inspect their observations in order.",
      other: `${f.number(count)} nested spans. Use the trace filter to inspect their observations in order.`,
    }),
    moreSpans: (count: number, f: Fmt) => f.plural(count, {
      one: "1 more span. Use the trace filter to inspect their observations in order.",
      other: `${f.number(count)} more spans. Use the trace filter to inspect their observations in order.`,
    }),

    // Check evidence
    checkUnavailable: {
      redacted: "The check's stored payload is redacted, so its evidence is not shown.",
      omitted: "The check's stored payload is omitted, so its evidence is not shown.",
    },
    checkFallback: "Check",
    checkNoResult: "The check stored no result at this boundary.",
    checkPassed: (time: number | string, _f: Fmt) => `The check passed at t=${time}.`,
    checkFailed: (time: number | string, _f: Fmt) => `The check did not pass at t=${time}.`,
    checkNoEvidence: "This check stored no evidence.",
    checkEmpty: "The stored evidence is empty: no rows matched.",
    storedEvidence: "Stored evidence",
  },
};
