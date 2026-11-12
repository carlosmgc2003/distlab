import type { Fmt } from "../format.ts";

/**
 * English source messages for the `story` area (ADR-007): story-timeline.ts. Milestone wording
 * is shared with the `timeline` area (`timeline.recordLabels`); only what differs lives here.
 */
const observations = (n: number, f: Fmt) => f.plural(n, { one: "1 recorded observation", other: `${f.number(n)} recorded observations` });
const milestones = (n: number, f: Fmt) => f.plural(n, { one: "1 teaching milestone", other: `${f.number(n)} teaching milestones` });

export const story = {
  /** Milestone types the Story view words differently from the record detail. */
  labelOverrides: {
    "database.transaction.committed": "Transaction committed",
    "database.transaction.rolledback": "Transaction rolled back",
    "database.transaction.rejected": "Transaction rejected",
  },
  kinds: {
    request: "Request",
    response: "Response",
    message: "Message",
    retry: "Retry",
    commit: "Transaction commit",
    rollback: "Transaction rollback",
    external: "External effect",
    fault: "Fault",
    drop: "Dropped message",
    timeout: "Timeout",
    failure: "Rejection or failure",
    kv: "Key-value change",
    log: "Business log",
    check: "Check result",
  },
  /** The category of a selected record that is not a teaching milestone (a Story table row). */
  otherRecord: "Other record",
  /** "22 teaching milestones from 266 recorded observations." */
  reduction: (p: { milestones: number; recorded: number }, f: Fmt) => `${milestones(p.milestones, f)} from ${observations(p.recorded, f)}.`,
  summaryEmpty: (reduction: string, _f: Fmt) => `No teaching milestones are in the current results. ${reduction}`,
  summary: (p: { reduction: string; lanes: readonly string[]; first: number | string; last: number | string }, f: Fmt) =>
    `${p.reduction} The strip reads left to right in recorded observation sequence across ${f.plural(p.lanes.length, {
      one: "1 component lane",
      other: `${f.number(p.lanes.length)} component lanes`,
    })}: ${f.list(p.lanes)}. The first milestone is recorded at virtual time ${p.first} and the last at virtual time ${p.last}.`,
  detailEmpty: "The Story strip and its table are empty.",
  detail: (p: { columns: number; lanes: number; boundaries: number; kinds: readonly string[] }, f: Fmt) =>
    `${f.plural(p.columns, { one: "1 column", other: `${f.number(p.columns)} columns` })} and ${f.plural(p.lanes, { one: "1 component lane", other: `${f.number(p.lanes)} component lanes` })}. `
    + f.plural(p.boundaries, {
      one: "1 recorded virtual-time boundary is marked, and no elapsed duration between milestones is stored. ",
      other: `${f.number(p.boundaries)} recorded virtual-time boundaries are marked, and no elapsed duration between milestones is stored. `,
    })
    + "Each milestone is one recorded observation; order is its recorded sequence. "
    + `Stored milestone categories and their shapes: ${f.list(p.kinds)}. `
    + "The table repeats the same milestones in the same order and selects the same observations.",
  /** The Story view's line in the live region: the reduction, then what the filters hide. */
  count: (p: { reduction: string; filtered: number; total: number; tableExtra: boolean }, f: Fmt) => {
    const filters = p.filtered === p.total ? "" : `Filters show ${f.number(p.filtered)} of ${f.plural(p.total, { one: "1 observation", other: `${f.number(p.total)} observations` })}. `;
    const extra = p.tableExtra ? "The Story table also lists the selected record, which is not a teaching milestone." : "";
    return `${p.reduction} ${filters}${extra}`;
  },
};
