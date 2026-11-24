import type { Fmt } from "../format.ts";

/** English source messages for the `simulationControls` area (ADR-007). */
export const simulationControls = {
  executionLabel: "Simulation execution",
  run: "Run",
  /** The Run control after a pause: it plays on from the playhead. */
  continue: "Continue",
  pause: "Pause",
  back: "Back",
  step: "Step",
  reset: "Reset",
  help: "The first Run or Step executes the whole run once. After that, Run plays the recorded milestones on the graph, Pause stops the playhead, Step and Back move one milestone, and nothing runs again. Reset starts the loaded scenario again. Once the run has executed, Left arrow is Back, Right arrow is Step, and Space is Run or Pause.",
  committedState: "Committed simulation state",
  statusLabel: "Simulation status",
  /** Display text for the simulation status codes. An unknown code is shown as it is. */
  status: { READY: "READY", PAUSED: "PAUSED", RUNNING: "RUNNING", COMPLETED: "COMPLETED", FAILED: "FAILED" } as Readonly<Record<string, string>>,
  statusUnavailable: "Simulation unavailable.",
  statusAssessmentRunning: "Assessment running.",
  statusChoose: "Choose a scenario to begin.",
  pendingReset: "Resetting scenario…",
  pendingRun: "Run in progress…",
  pendingLoading: "Loading…",
  pendingAssessment: "Assessment running…",
  virtualTime: "Virtual time",
  processedEvents: "Processed events",
  pendingEvents: "Pending events",
  errorDetails: "Error details",
};
