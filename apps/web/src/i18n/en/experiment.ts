import type { Fmt } from "../format.ts";

/** English source messages for the `experiment` area (ADR-007). */
export const experiment = {
  title: "Change the experiment",
  about: "About the experiment",
  locked: "Changes are unavailable while the simulation runs or a command is in progress.",
  pending: "These changes are not applied yet. Applying them replaces the session and starts again from the lesson’s start time, with the same seed. Reset keeps replaying the applied experiment.",
  apply: "Apply and restart",
  discard: "Discard changes",
  close: "Close",
};
