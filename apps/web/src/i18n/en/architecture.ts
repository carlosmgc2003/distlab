import type { Fmt } from "../format.ts";

/** English source messages for the `architecture` area (ADR-007): architecture-view.ts and activity.ts. */
export const architecture = {
  invalid: "Architecture contains duplicate components or connections to missing components.",
  category: {
    client: "Client",
    service: "Internal service",
    external: "External service",
    infrastructure: "Infrastructure",
  },
  symbol: {
    client: "Client",
    service: "Internal service",
    external: "External service",
    topic: "Message bus topic",
    queue: "Message bus queue",
    kvstore: "Shared key-value store",
  },
  /** The resource kinds, named as the kernel names them. */
  resourceKind: { database: "Database", kvstore: "KeyValueStore" },
  ownershipLink: (p: { owner: string; resource: string }, _f: Fmt) => `Data link from ${p.owner} to ${p.resource}`,
  databaseOwnedBy: (owner: string, _f: Fmt) => `Database owned by ${owner}`,
  storeOwnedBy: (owner: string, _f: Fmt) => `KeyValueStore owned by ${owner}`,
  /** The table names are identifiers, so they stay a plain comma-separated list. */
  databaseResource: (p: { owner: string; tables: readonly string[] }, _f: Fmt) => `Database owned by ${p.owner}: ${p.tables.join(", ")}`,
  storeResource: (owner: string, _f: Fmt) => `KeyValueStore owned by ${owner}`,
  /** A MessageBus destination, by its stored kind. */
  destinationResource: {
    topic: (id: string, _f: Fmt) => `MessageBus topic: ${id}`,
    queue: (id: string, _f: Fmt) => `MessageBus queue: ${id}`,
  },
  /** A destination whose kind this build does not know: the raw kind is shown. */
  destinationResourceOther: (p: { kind: string; id: string }, _f: Fmt) => `MessageBus ${p.kind}: ${p.id}`,
  link: {
    request: "Request",
    requestNamed: (label: string, _f: Fmt) => `Request · ${label}`,
    subscription: "Subscription",
    publication: "Publication",
    aria: (p: { source: string; target: string; label: string }, _f: Fmt) => `${p.source} to ${p.target}: ${p.label}`,
    publicationAria: "Orders to MessageBus OrderCreated: publication",
  },
  nodeAria: (p: { title: string; symbol: string }, _f: Fmt) => `${p.title}, ${p.symbol}`,
  nodeAriaEmptySlot: (p: { title: string; symbol: string }, _f: Fmt) => `${p.title}, ${p.symbol}, empty slot`,
  /** Component activity at the playback cursor (activity.ts). */
  activity: {
    state: { idle: "Idle", processing: "Processing", waiting: "Waiting" },
    waitingUntil: (deadline: number, _f: Fmt) => `Waiting · deadline t=${deadline}`,
    idle: (id: string, _f: Fmt) => `${id} is idle.`,
    waiting: (p: { id: string; targets: string; deadline?: number }, _f: Fmt) => p.deadline !== undefined
      ? `${p.id} is waiting on ${p.targets} with a recorded deadline at virtual time ${p.deadline}.`
      : `${p.id} is waiting on ${p.targets} with no recorded deadline.`,
    processing: (p: { id: string; work: string }, _f: Fmt) => `${p.id} is processing ${p.work}.`,
    waitingAndProcessing: (p: { id: string; targets: string; work: string; deadline?: number }, _f: Fmt) => p.deadline !== undefined
      ? `${p.id} is waiting on ${p.targets} with a recorded deadline at virtual time ${p.deadline} and processing ${p.work}.`
      : `${p.id} is waiting on ${p.targets} with no recorded deadline and processing ${p.work}.`,
    timedOut: (p: { target: string; time: number }, _f: Fmt) => `Its request to ${p.target} timed out at virtual time ${p.time}.`,
    work: {
      requests: (n: number, f: Fmt) => f.plural(n, { one: "a delivered request", other: `${f.number(n)} delivered requests` }),
      transactions: (n: number, f: Fmt) => f.plural(n, { one: "an open transaction", other: `${f.number(n)} open transactions` }),
      deliveries: (n: number, f: Fmt) => f.plural(n, { one: "an unacknowledged message delivery", other: `${f.number(n)} unacknowledged message deliveries` }),
    },
  },
  /** The graph canvas, its controls, and its help (ArchitectureView.tsx). */
  view: {
    empty: "No architecture components to display.",
    heading: "Architecture",
    graph: "Architecture graph",
    movementRegion: "Request and message movement",
    noMovement: "No request or message movement is highlighted.",
    skipToInspector: "Skip to component inspector",
    connections: (n: number, f: Fmt) => `Connections (${f.number(n)})`,
    controlsHelpLabel: "Graph controls",
    controlsHelp: "Select a component to inspect it. Tab to a component, then press Enter or Space. Drag the canvas or use the arrow buttons to pan; use the zoom and fit buttons to change the view.",
    paceHelpLabel: "Playback speed",
    paceHelp: "Playback speed changes how fast the browser paints recorded movements. It does not change virtual time, the recorded history, or the run. Every movement you see was already recorded before it was painted. To read at your own pace, use Previous movement and Next movement, or the Left and Right arrow keys; Space plays or pauses.",
    /** The keys are named as the physical keys are labelled. */
    nodeKeyboardHint: "Press Enter or Space to inspect this component. Press Escape to clear selection.",
    controlPanel: "Control Panel",
    zoomIn: "Zoom In",
    zoomOut: "Zoom Out",
    fitView: "Fit View",
    pan: { group: "Pan view", left: "Pan left", up: "Pan up", down: "Pan down", right: "Pan right" },
    role: {
      sending: (glyph: string, _f: Fmt) => `${glyph} sends`,
      receiving: (glyph: string, _f: Fmt) => `${glyph} receives`,
    },
    timedOut: (time: number, _f: Fmt) => `timed out t=${time}`,
    fault: {
      badge: (n: number, f: Fmt) => f.plural(n, { one: "Student fault", other: `${f.number(n)} student faults` }),
      /** Read after the badge by assistive technology. */
      detail: (faults: readonly string[], f: Fmt) => `: ${f.list(faults)}`,
      link: (p: { label: string; faults: readonly string[] }, f: Fmt) =>
        `${p.label}. ${f.plural(p.faults.length, { one: "Student fault", other: "Student faults" })}: ${f.list(p.faults)}`,
    },
  },
  /** The collapsible legend (ArchitectureView.tsx). The `sr` tag marks text read only by assistive technology. */
  legend: {
    region: "Architecture legend",
    heading: "Legend",
    show: "Show<sr> legend</sr>",
    hide: "Hide<sr> legend</sr>",
    nodes: "Nodes",
    databaseShape: "Cylinder",
    database: "Database (owned)",
    storeShape: "Layered box with key",
    store: "KV store (owned)",
    relationships: "Relationships",
    requestShape: "Solid line with filled arrowhead",
    request: "Request",
    subscriptionShape: "Purple dashed line with open arrowhead",
    subscription: "MessageBus subscription",
    publicationShape: "Purple dotted line with small filled arrowhead",
    publication: "MessageBus publication",
    ownershipShape: "Short thin amber line without arrowhead",
    ownership: "Ownership (data)",
    movements: "Recorded movements",
    activity: "Component activity",
    processing: "{state}<sr>: handling a delivered request, an open transaction, or a message delivery</sr>",
    waiting: "{state}<sr>: sent a request with no response or timeout recorded yet</sr>",
  },
  /** The component inspector (ComponentInspector.tsx). */
  inspector: {
    heading: "Component inspector",
    select: "Select a component to inspect its metadata.",
    metadata: "Static architecture metadata",
    componentId: "Component ID",
    category: "Category",
    model: "Model",
    version: "Version",
    notDeclared: "Not declared",
    configuration: "Configuration",
    configurationNone: "Not declared in packaged metadata.",
    resources: "Resource ownership",
    resourcesNone: "No database or store declared for this component.",
    owner: "Owner",
    tables: "Tables",
    initialKeys: "Initial keys",
    noneDeclared: "None declared",
  },
};
