import type { Fmt } from "../format.ts";

/** English source messages for the `simulationControls` area (ADR-007). */
export const simulationControls = {
  executionLabel: "Simulation execution",
  run: "Run",
  pause: "Pause",
  step: "Step",
  reset: "Reset",
  help: "These four controls change the simulation. Step advances one scheduled event. Pause takes effect at an event boundary. Reset starts the loaded scenario again. Replay, in the Architecture tab, is a separate group of controls that leaves the simulation unchanged.",
  committedState: "Committed simulation state",
  statusLabel: "Simulation status",
  /** Display text for the simulation status codes. An unknown code is shown as it is. */
  status: { READY: "READY", PAUSED: "PAUSED", RUNNING: "RUNNING", COMPLETED: "COMPLETED", FAILED: "FAILED" } as Readonly<Record<string, string>>,
  statusUnavailable: "Simulation unavailable.",
  statusAssessmentRunning: "Assessment running.",
  statusChoose: "Choose a scenario to begin.",
  pendingPause: "Pause requested; waiting for an event boundary…",
  pendingReset: "Resetting scenario…",
  pendingStep: "Stepping one event…",
  pendingRun: "Run in progress…",
  pendingLoading: "Loading…",
  pendingAssessment: "Assessment running…",
  virtualTime: "Virtual time",
  processedEvents: "Processed events",
  pendingEvents: "Pending events",
  errorDetails: "Error details",
};
