import type { SimulationTime } from "@distlab/contracts";
import type { Messages } from "./i18n/catalog.ts";

/**
 * The playhead (RFC 0002 P1 to P4): one position over the teaching milestones of the current run,
 * or "before the first record". Pure transitions only. The first `Run` or `Step` after a load or a
 * reset asks the worker to execute the whole run, once; from then on every control moves the
 * playhead over milestones already recorded and asks the worker for nothing. Nothing here reads
 * a clock, advances virtual time, or records an observation.
 */

/** Where the playhead stands, in the columns of the RFC P2 control table, plus the wait for the worker. */
export type PlayheadPhase =
  /** Loaded or reset, and the run has not executed: before the first `Run` or `Step`. */
  | "unrun"
  /** The run was asked for and the worker has not finished it. Every control waits. */
  | "executing"
  | "playing"
  | "paused"
  /** On the last milestone, or a run that recorded none. */
  | "ended";

/** What the playhead does once the worker has executed the run it was asked for. */
export type PlayheadIntent =
  /** `Run` with Animation on: play from the first milestone. */
  | "play"
  /** `Run` with Animation off: stand on the last milestone. */
  | "end"
  /** `Step`: stand on the first milestone. */
  | "first";

export interface PlayheadState {
  /** Index into the milestone list, or -1 before the first record. */
  readonly index: number;
  readonly playing: boolean;
  /** Set from the first `Run` or `Step` until the run it asked for has executed. */
  readonly intent: PlayheadIntent | null;
  /** Counts each start of play, so the graph paints a token again from the start of its leg. */
  readonly paint: number;
}

export const INITIAL_PLAYHEAD: PlayheadState = { index: -1, playing: false, intent: null, paint: 0 };

/** What the playhead reads from the session. */
export interface PlayheadContext {
  /** The worker has executed the run: the session is COMPLETED or FAILED. */
  readonly executed: boolean;
  /** The session cannot take a command now: one is outstanding, a lesson is loading, or an assessment owns it. */
  readonly busy: boolean;
  /** Milestones recorded by the run. */
  readonly count: number;
  /** The Animation setting: on, `Run` plays; off, `Run` goes to the end. */
  readonly animation: boolean;
}

export type PlayheadCommand = "toggle" | "step" | "back";

export interface PlayheadOutcome {
  readonly state: PlayheadState;
  /** True when this command asks the worker to execute the run: the first `Run` or `Step` only. */
  readonly execute: boolean;
}

export function playheadPhase(state: PlayheadState, context: PlayheadContext): PlayheadPhase {
  if (!context.executed) return state.intent !== null ? "executing" : "unrun";
  if (state.playing) return "playing";
  if (context.count === 0 || state.index >= context.count - 1) return "ended";
  return "paused";
}

const moved = (state: PlayheadState, index: number): PlayheadState => ({ ...state, index, playing: false });

/**
 * The outcome of one control, or null when the control is unavailable. This is the RFC P2 table:
 * `toggle` is `Run`, which reads `Pause` while playing, so the table's `Pause` row is its playing
 * state. Availability is derived from here and from nothing else.
 */
export function playheadCommand(state: PlayheadState, context: PlayheadContext, command: PlayheadCommand): PlayheadOutcome | null {
  if (context.busy) return null;
  const phase = playheadPhase(state, context);
  const last = context.count - 1;
  const settle = (next: PlayheadState): PlayheadOutcome => ({ state: next, execute: false });
  switch (phase) {
    case "executing":
      return null;
    case "unrun":
      if (command === "back") return null;
      return { state: { ...INITIAL_PLAYHEAD, paint: state.paint, intent: command === "step" ? "first" : context.animation ? "play" : "end" }, execute: true };
    case "playing":
    case "paused":
      if (command === "toggle") {
        if (phase === "playing") return settle({ ...state, playing: false });
        if (!context.animation) return settle(moved(state, last));
        // Continue from the playhead: a playhead before the first record starts on the first milestone.
        return settle({ ...state, index: Math.max(state.index, 0), playing: true, paint: state.paint + 1 });
      }
      if (command === "step") return state.index < last ? settle(moved(state, state.index + 1)) : null;
      return state.index > 0 ? settle(moved(state, state.index - 1)) : null;
    case "ended":
      return command === "back" && state.index > 0 ? settle(moved(state, state.index - 1)) : null;
  }
}

/** Applies the intent of the first `Run` or `Step` once the run has executed and recorded `count` milestones. */
export function playheadExecuted(state: PlayheadState, count: number): PlayheadState {
  if (state.intent === null) return state;
  const rest = { ...state, intent: null };
  if (count === 0) return { ...rest, index: -1, playing: false };
  if (state.intent === "first") return { ...rest, index: 0, playing: false };
  if (state.intent === "end") return { ...rest, index: count - 1, playing: false };
  return { ...rest, index: 0, playing: true, paint: state.paint + 1 };
}

/** One beat of play: the next milestone, and the end of play on the last one. */
export function playheadTick(state: PlayheadState, count: number): PlayheadState {
  if (!state.playing) return state;
  const index = Math.min(state.index + 1, count - 1);
  return { ...state, index, playing: index < count - 1 };
}

export interface PlayheadToggle {
  /** True while playing: the control pauses. */
  readonly pauses: boolean;
  readonly label: string;
  readonly available: boolean;
}

export interface PlayheadControls {
  readonly phase: PlayheadPhase;
  readonly toggle: PlayheadToggle;
  readonly step: boolean;
  readonly back: boolean;
}

/** The control group's state: what each control reads and whether it acts. */
export function playheadControls(state: PlayheadState, context: PlayheadContext, m: Messages): PlayheadControls {
  const phase = playheadPhase(state, context);
  const copy = m.simulationControls;
  const label = phase === "playing" ? copy.pause : phase === "paused" && state.index >= 0 ? copy.continue : copy.run;
  return {
    phase,
    toggle: { pauses: phase === "playing", label, available: playheadCommand(state, context, "toggle") !== null },
    step: playheadCommand(state, context, "step") !== null,
    back: playheadCommand(state, context, "back") !== null,
  };
}

export interface PlayheadPosition {
  readonly text: string;
  /**
   * Set when virtual time advanced since the previous milestone. It names the two recorded times
   * only: the playhead never paints the interval as a duration.
   */
  readonly jump?: string;
}

/** The top bar's short statement of the playhead: its milestone and the virtual time of its record. */
export interface PlayheadSummary {
  /** "7 of 19"; "0 of 19" before the first record; "—" before the run has executed. */
  readonly milestone: string;
  /** The virtual time of the record under the playhead, or "—" when it stands on none. */
  readonly time: string;
}

const NONE = "—";

/**
 * The top bar states the playhead, and only the playhead (RFC 0002 P2, decision 3): no second
 * virtual time, and no engine counter. Before the run has executed it states nothing.
 */
export function playheadSummary(
  steps: readonly { readonly time: SimulationTime }[],
  index: number,
  executed: boolean,
  m: Messages,
): PlayheadSummary {
  if (!executed) return { milestone: NONE, time: NONE };
  const at = Math.min(index, steps.length - 1);
  const step = at >= 0 ? steps[at] : undefined;
  return {
    milestone: m.simulationControls.milestoneOf({ index: step === undefined ? 0 : at + 1, total: steps.length }),
    time: step === undefined ? NONE : String(step.time),
  };
}

/**
 * The playhead stated once: milestone number, milestone count, and the virtual time and sequence
 * of its record. Before the run has executed it says so, whatever the loaded session recorded.
 */
export function playheadPosition(
  steps: readonly { readonly time: SimulationTime; readonly sequence: number }[],
  index: number,
  executed: boolean,
  m: Messages,
): PlayheadPosition {
  const copy = m.playback.position;
  const total = steps.length;
  if (!executed) return { text: copy.unrun };
  if (total === 0) return { text: copy.none };
  if (index < 0) return { text: copy.start(total) };
  const at = Math.min(index, total - 1);
  const step = steps[at]!;
  const previous = at > 0 ? steps[at - 1] : undefined;
  const jump = previous !== undefined && step.time > previous.time ? copy.jump({ from: previous.time, to: step.time }) : undefined;
  return {
    text: copy.current({ index: at + 1, total, time: step.time, sequence: step.sequence }),
    ...(jump !== undefined ? { jump } : {}),
  };
}

export type PlayheadKeyAction = "back" | "step" | "toggle";

/** The keys the control group answers to, as `KeyboardEvent.key` values. Key names are not translated. */
export const PLAYHEAD_KEYS = { back: "ArrowLeft", step: "ArrowRight", toggle: " " } as const satisfies Record<PlayheadKeyAction, string>;

export interface PlayheadKeyPress {
  readonly key: string;
  /** True when Alt, Control, Meta, or Shift is held: those chords belong to the browser. */
  readonly modified: boolean;
  /** True for an auto-repeated key. Holding Space must not flip play and pause over and over. */
  readonly repeat: boolean;
  /** True when focus is in a control that uses the arrow keys itself: a field, a select, a tab list, a dialog. */
  readonly arrowsClaimed: boolean;
  /** True when focus is on anything Space already activates: a button, a link, a component node. */
  readonly spaceClaimed: boolean;
}

/**
 * The control a key press asks for, or null when the key is not the control group's to take.
 * Left is `Back`, Right is `Step`, and Space is `Run` or `Pause`. A key a focused control
 * already uses keeps its own meaning, so no existing gesture changes.
 */
export function playheadKeyAction(press: PlayheadKeyPress): PlayheadKeyAction | null {
  if (press.modified) return null;
  if (press.key === PLAYHEAD_KEYS.back) return press.arrowsClaimed ? null : "back";
  if (press.key === PLAYHEAD_KEYS.step) return press.arrowsClaimed ? null : "step";
  if (press.key === PLAYHEAD_KEYS.toggle) return press.spaceClaimed || press.repeat ? null : "toggle";
  return null;
}
