import type { Fmt } from "../format.ts";

/** English source messages for the `designEditor` area (ADR-007): design-edits.ts and ArchitectureSection.tsx. */
export const designEditor = {
  title: "Architecture",
  /** What the Architecture section is for. It is in the Experiment drawer's hint (#147). */
  help: "Design edits change the lesson's architecture: the model that fills a slot, a peer it calls, the resources a service owns, and the destinations it subscribes to. Only the edits this lesson allows are offered, and Apply and restart is what checks that a design is valid.",
  count: (p: { count: number; max: number }, f: Fmt) => `${f.number(p.count)} of ${f.number(p.max)} design edits`,
  problems: "Design problems",
  /** Control labels. Component IDs, option keys, models, and destinations stay as written. */
  controls: {
    slot: (p: { component: string }, _f: Fmt) => `Model for ${p.component}`,
    packagedEmpty: "Empty slot (packaged)",
    packagedModel: (p: { model: string; version: string }, _f: Fmt) => `${p.model} ${p.version} (packaged)`,
    option: (p: { component: string; key: string }, _f: Fmt) => `${p.component}: ${p.key}`,
    binding: (p: { component: string; peer: string }, _f: Fmt) => `${p.component} calls ${p.peer} on`,
    ownsDatabase: (p: { owner: string }, _f: Fmt) => `${p.owner} owns a database`,
    ownsStore: (p: { owner: string }, _f: Fmt) => `${p.owner} owns a key-value store`,
    subscription: (p: { consumer: string; destination: string }, _f: Fmt) => `${p.consumer} subscribes to ${p.destination}`,
  },
  /** The Run identity form of the applied edits (App.tsx): the count, then each filled slot. */
  summary: {
    edits: (count: number, f: Fmt) => f.plural(count, { one: "1 design edit", other: `${f.number(count)} design edits` }),
    slot: (p: { component: string; model: string; version: string }, _f: Fmt) => `${p.component}: ${p.model} ${p.version}`,
  },
  /** Worker diagnostics under /architecture, by code. The code stays visible after the text. */
  diagnostics: {
    STORAGE: "This model needs storage that the component does not own.",
    SUBSCRIPTION: "The model's consumers and the component's subscriptions do not match.",
    PEER: "A peer of this component does not resolve to a component it may call.",
    INTERFACE: "The called component does not offer an endpoint this component calls.",
    LINK: "No link carries this call.",
    PUBLISH: "This model publishes to a destination that does not exist.",
    OWNERSHIP: "Only services own resources.",
    DUPLICATE: "Two edits change the same element.",
    OVERLAY_NOT_ALLOWED: "This lesson does not allow this edit.",
    PARAMETER_VALUE: "This value is outside the allowed range.",
  },
  limit: (max: number, f: Fmt) => f.plural(max, { one: "This lesson allows at most 1 design edit.", other: `This lesson allows at most ${f.number(max)} design edits.` }),
  diagnosticUnknown: "This edit is not valid.",
};
