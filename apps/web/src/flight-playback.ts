import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_FLIGHT_PACE, flightDelayMs, flightInTransit } from "./flight.ts";
import type { FlightPace, FlightStep } from "./flight.ts";
import {
  INITIAL_PLAYHEAD,
  playheadCommand,
  playheadControls,
  playheadExecuted,
  playheadKeyAction,
  playheadPosition,
  playheadRevealsOutcome,
  playheadSeek,
  playheadSpan,
  playheadSummary,
  playheadTick,
} from "./playhead.ts";
import type { PlayheadCommand, PlayheadContext, PlayheadControls, PlayheadPosition, PlayheadSpan, PlayheadState, PlayheadSummary } from "./playhead.ts";
import { playheadSteps } from "./playhead-steps.ts";
import type { PlayheadStep } from "./playhead-steps.ts";
import { activityAt, activityChanges } from "./activity.ts";
import type { ComponentActivity } from "./activity.ts";
import type { MovementEdge } from "./records.ts";
import type { Observation } from "@distlab/contracts";
import { useMessages } from "./i18n/react.tsx";
import type { ComponentNames } from "./component-display.ts";

/**
 * The playback settings: UI state owned by the shell, so it survives lesson loads. Neither
 * setting changes the run; they decide how `Run` shows it.
 */
export interface PlaybackSettings {
  /** On: `Run` plays the milestones at `pace`. Off: `Run` shows the end at once. */
  readonly animation: boolean;
  readonly pace: FlightPace;
  readonly setAnimation: (animation: boolean) => void;
  readonly setPace: (pace: FlightPace) => void;
}

export function usePlaybackSettings(): PlaybackSettings {
  const [animation, setAnimation] = useState(true);
  const [pace, setPace] = useState<FlightPace>(DEFAULT_FLIGHT_PACE);
  return { animation, pace, setAnimation, setPace };
}

export interface Playhead {
  /** Every teaching milestone of the run, in canonical order (`playhead-steps.ts`). */
  readonly steps: readonly PlayheadStep[];
  /** Index of the milestone under the playhead, or -1 before the first record. */
  readonly index: number;
  readonly step: PlayheadStep | undefined;
  readonly controls: PlayheadControls;
  readonly settings: PlaybackSettings;
  /** Changes on every start of play, so a token painted again starts from the start of its leg. */
  readonly paint: number;
  readonly position: PlayheadPosition;
  /** The top bar's short statement: milestone and the virtual time of its record. */
  readonly summary: PlayheadSummary;
  /** Component activity read from records at or before the playhead; empty before the first record. */
  readonly activity: ReadonlyMap<string, ComponentActivity>;
  /** Activity that differs from the previous milestone, one sentence per component. */
  readonly activityChanges: readonly string[];
  /** Hops that left before the playhead's milestone and have no arrival or drop recorded at or before it. */
  readonly inTransit: readonly FlightStep[];
  /** The records the playhead stands on (`playheadSpan`); Recorded history marks later ones as not reached. */
  readonly span: PlayheadSpan;
  /**
   * The lesson's outcome is revealed (RFC 0002 P5, decision 4): the playhead has reached the end of
   * the run once, or Animation was off when the run executed. It stays revealed until a load or a reset.
   */
  readonly revealed: boolean;
  /** `Run`, or `Pause` while playing. */
  readonly toggle: () => void;
  readonly forward: () => void;
  readonly back: () => void;
  /** Recorded history moves the playhead to a milestone index (-1: before the first record). */
  readonly seek: (index: number) => void;
}

/**
 * The one position over the current run (RFC 0002 P1 to P4).
 *
 * The first `Run` or `Step` after a load or a reset calls `execute` once: the worker executes the
 * whole run at engine speed. From then on every control, and the host timer that plays, moves the
 * playhead over milestones already recorded. The timer never advances virtual time, records an
 * observation, or sends a worker command, so watching a run cannot change it.
 */
export function usePlayhead(input: {
  readonly observations: readonly Observation[];
  readonly edges: readonly MovementEdge[];
  /** The worker has executed the run: the session is COMPLETED or FAILED. */
  readonly executed: boolean;
  /** A command is outstanding, a lesson is loading, or an assessment owns the session. */
  readonly busy: boolean;
  /** Asks the worker to execute the run. Called by the first `Run` or `Step` only. */
  readonly execute: () => Promise<unknown>;
  /** Changes with the loaded session or a reset: the playhead returns to the start. */
  readonly sessionKey: string;
  readonly settings: PlaybackSettings;
  /** The session's component display names, for the narration and activity lines (#103). */
  readonly names?: ComponentNames;
}): Playhead {
  const { observations, edges, executed, busy, execute, sessionKey, settings, names } = input;
  const m = useMessages();
  // Text is produced here at render time, so a language switch recomputes it and nothing stale survives.
  const steps = useMemo(() => playheadSteps(observations, edges, m, names), [observations, edges, m, names]);
  const [state, setState] = useState<PlayheadState>(INITIAL_PLAYHEAD);
  const [revealed, setRevealed] = useState(false);
  const count = steps.length;
  const context: PlayheadContext = { executed, busy, count, animation: settings.animation };

  // A new session or a reset returns the playhead to the start and withholds the outcome again.
  useEffect(() => {
    setState(current => ({ ...INITIAL_PLAYHEAD, paint: current.paint }));
    setRevealed(false);
  }, [sessionKey]);
  const wasExecuted = useRef(executed);
  useEffect(() => {
    const before = wasExecuted.current;
    wasExecuted.current = executed;
    if (before && !executed) {
      setState(current => ({ ...INITIAL_PLAYHEAD, paint: current.paint }));
      setRevealed(false);
    }
    // The run the first Run or Step asked for has executed: apply what it asked for.
    else if (executed) setState(current => playheadExecuted(current, count));
  }, [executed, count]);
  // Turning Animation off stops play; it never moves the playhead by itself.
  useEffect(() => { if (!settings.animation) setState(current => current.playing ? { ...current, playing: false } : current); }, [settings.animation]);

  const latest = useRef({ state, context });
  latest.current = { state, context };
  const command = useCallback((name: PlayheadCommand) => {
    const outcome = playheadCommand(latest.current.state, latest.current.context, name);
    if (outcome === null) return;
    setState(outcome.state);
    // A refused run leaves nothing to wait for: the playhead returns to before the first Run.
    if (outcome.execute) void execute().catch(() => setState(current => ({ ...current, intent: null })));
  }, [execute]);
  const seek = useCallback((index: number) => {
    const next = playheadSeek(latest.current.state, latest.current.context, index);
    if (next !== null) setState(next);
  }, []);
  const toggle = useCallback(() => command("toggle"), [command]);
  const forward = useCallback(() => command("step"), [command]);
  const back = useCallback(() => command("back"), [command]);

  const playing = state.playing && executed;
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => setState(current => playheadTick(current, count)), flightDelayMs(settings.pace));
    return () => window.clearTimeout(timer);
  }, [playing, state.index, count, settings.pace]);

  const index = state.index < count ? state.index : count - 1;
  const step = index >= 0 ? steps[index] : undefined;
  const previousId = index > 0 ? steps[index - 1]?.observationId : undefined;
  const activity = useMemo(() => activityAt(observations, step?.observationId), [observations, step?.observationId]);
  const changes = useMemo(
    () => step === undefined ? [] : activityChanges(activityAt(observations, previousId), activity, m, names),
    [observations, previousId, activity, step, m, names],
  );
  const inTransit = useMemo(() => flightInTransit(steps, index), [steps, index]);
  // Latched: once the playhead has reached the end, moving it back never withholds the outcome again.
  const reveals = playheadRevealsOutcome(index, context);
  useEffect(() => { if (reveals) setRevealed(true); }, [reveals]);
  const span = useMemo(() => playheadSpan(steps, index), [steps, index]);

  return {
    steps,
    index,
    step,
    controls: playheadControls(state, context, m),
    settings,
    paint: state.paint,
    position: playheadPosition(steps, index, executed, m),
    summary: playheadSummary(steps, index, executed, m),
    activity,
    activityChanges: changes,
    inTransit,
    span,
    revealed: revealed || reveals,
    toggle, forward, back, seek,
  };
}

/** Controls that use the arrow keys themselves. Inside one, an arrow keeps its own meaning. */
const ARROW_OWNERS = "input, select, textarea, [contenteditable], [role='tablist'], [role='radiogroup'], [role='listbox'], [role='menu'], [role='slider'], dialog, [role='dialog'], [popover], .graph-legend";
/**
 * Everything Space already activates or scrolls, so Space runs or pauses only from neutral ground.
 * `[tabindex='0']` covers the component nodes and the focusable scroll regions, such as the inspector.
 */
const SPACE_OWNERS = `${ARROW_OWNERS}, button, a[href], summary, [role='button'], [tabindex='0']`;

/**
 * The control group from the keyboard: Left is `Back`, Right is `Step`, Space is `Run` or `Pause`.
 *
 * A key moves the playhead as its button does, and nothing more: before the run has executed, the
 * keys are not taken, so a stray arrow on the graph never starts a run. A key that a focused
 * control already uses is left to that control, and nothing is handled while a modal dialog is
 * open or while `active` is false (the graph is not on screen).
 */
export function usePlayheadKeys(playhead: Playhead, active: boolean): void {
  const { toggle, forward, back } = playhead;
  const recorded = playhead.controls.phase !== "unrun" && playhead.controls.phase !== "executing";
  useEffect(() => {
    if (!active || !recorded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector("dialog[open]")) return;
      const target = event.target instanceof Element ? event.target : null;
      const action = playheadKeyAction({
        key: event.key,
        modified: event.altKey || event.ctrlKey || event.metaKey || event.shiftKey,
        repeat: event.repeat,
        arrowsClaimed: target?.closest(ARROW_OWNERS) != null,
        spaceClaimed: target?.closest(SPACE_OWNERS) != null,
      });
      if (action === null) return;
      // Space would scroll the page, and an arrow would scroll a panel sideways.
      event.preventDefault();
      if (action === "back") back();
      else if (action === "step") forward();
      else toggle();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, recorded, toggle, forward, back]);
}
