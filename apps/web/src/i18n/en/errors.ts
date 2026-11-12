/** English source messages for the `errors` area (ADR-007): how an `ApplicationError` reads on screen. See error-text.ts. */
export const errors = {
  /** By catalog key. The worker keeps English developer text in `message`; the screen renders these by error code and reason. */
  text: {
    controlBusy: "A simulation control is already in progress.",
    invalidCommand: "Expected a version 1 worker command.",
    protocolMismatch: "The command does not match protocol version 1.",
    noSession: "Load a scenario before sending controls.",
    controlNotApplied: "The simulation control could not be applied.",
    hostClosed: "The worker host was closed.",
    workerStopped: "The simulation worker stopped or could not exchange messages.",
    invalidProtocolMessage: "The worker returned an invalid protocol message.",
    sessionReplaced: "A new scenario replaced the previous session.",
    failedAtBoundary: "The simulation failed at an event boundary.",
    failedBeforePause: "The simulation failed before the pause completed.",
    scenarioNotLoaded: "The scenario could not be loaded.",
    documentInvalid: "The scenario document is not valid.",
    overlayInvalid: "The session overlay is not allowed for this lesson or makes the lesson invalid.",
    overlayRowRejected: "The row's overlay was rejected.",
    suiteStopped: "The suite could not continue.",
  },
};
