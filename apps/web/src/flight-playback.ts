import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_FLIGHT_PACE,
  flightAdvance,
  flightDelayMs,
  flightInTransit,
  flightPosition,
  flightSteps,
  flightTransport,
  replayKeyAction,
  transportStep,
} from "./flight.ts";
import type { FlightPace, FlightPosition, FlightStep, FlightTransport, PlaybackPhase } from "./flight.ts";
import { activityAt, activityChanges } from "./activity.ts";
import type { ComponentActivity } from "./activity.ts";
import type { MovementEdge } from "./records.ts";
import type { Observation } from "@distlab/contracts";
import { useMessages } from "./i18n/react.tsx";
import type { ComponentNames } from "./component-display.ts";

/** How often the host timer rechecks while the cursor waits for the run to record more movements. */
const TAIL_POLL_MS = 200;

interface Cursor {
  readonly index: number;
  readonly phase: PlaybackPhase;
  /** Counts restarts, so Restart paints the same movement again when there is only one (#192). */
  readonly paint: number;
}

export interface FlightPlayback {
  readonly steps: readonly FlightStep[];
  readonly cursor: number;
  readonly step: FlightStep | undefined;
  readonly phase: PlaybackPhase;
  readonly pace: FlightPace;
  /** Changes on every Restart, so a token painted again starts from the start of its leg. */
  readonly paint: number;
  readonly position: FlightPosition;
  readonly transport: FlightTransport;
  /** Component activity read from records at or before the cursor; empty with no cursor. */
  readonly activity: ReadonlyMap<string, ComponentActivity>;
  /** Activity that differs from the previous movement, one sentence per component. */
  readonly activityChanges: readonly string[];
  /** Hops that left before the cursor's movement and have no arrival or drop recorded at or before it. */
  readonly inTransit: readonly FlightStep[];
  readonly play: () => void;
  readonly pause: () => void;
  readonly restart: () => void;
  readonly previous: () => void;
  readonly next: () => void;
  readonly setPace: (pace: FlightPace) => void;
}

/**
 * Replays recorded movements on the architecture graph at a chosen pace.
 *
 * The host timer only moves a browser cursor over records the worker already
 * published. It never advances virtual time, allocates an observation, or sends
 * a worker command, so playback cannot change the run.
 */
export function useFlightPlayback(
  observations: readonly Observation[],
  edges: readonly MovementEdge[],
  recording: boolean,
  /** Changes when Recorded history takes over the graph highlight. */
  release: string | undefined,
  /** The session's component display names, for the narration and activity lines (#103). */
  names?: ComponentNames,
): FlightPlayback {
  const m = useMessages();
  // Text is produced here at render time, so a language switch recomputes it and nothing stale survives.
  const steps = useMemo(() => flightSteps(observations, edges, m, names), [observations, edges, m, names]);
  // One record holds the cursor and the phase, so a single transition can never
  // paint a cursor the phase does not belong to.
  const [cursor, setCursor] = useState<Cursor>({ index: -1, phase: "idle", paint: 0 });
  const [pace, setPace] = useState<FlightPace>(DEFAULT_FLIGHT_PACE);

  // A shorter recorded list, a new session, or a new history selection releases the cursor.
  useEffect(() => {
    setCursor(current => (current.index < 0
      ? current
      : { ...current, index: Math.min(current.index, steps.length - 1) }));
    setCursor(current => (current.phase === "playing" && steps.length === 0 ? { ...current, phase: "idle" } : current));
  }, [steps.length]);
  useEffect(() => { setCursor(current => ({ index: -1, phase: "idle", paint: current.paint })); }, [release]);

  const step = cursor.index >= 0 ? steps[cursor.index] : undefined;
  const previousId = cursor.index > 0 ? steps[cursor.index - 1]?.observationId : undefined;
  const activity = useMemo(() => activityAt(observations, step?.observationId), [observations, step?.observationId]);
  const changes = useMemo(
    () => step === undefined ? [] : activityChanges(activityAt(observations, previousId), activity, m, names),
    [observations, previousId, activity, step, m, names],
  );
  const inTransit = useMemo(() => flightInTransit(steps, cursor.index), [steps, cursor.index]);
  const play = useCallback(() => {
    setCursor(current => current.phase === "playing" ? current
      : steps.length === 0 ? current
      : { ...current, index: current.index >= 0 ? current.index : 0, phase: "playing" });
  }, [steps.length]);
  const pause = useCallback(() => {
    setCursor(current => current.phase === "idle" ? current : { ...current, phase: "paused" });
  }, []);
  const restart = useCallback(() => {
    setCursor(current => steps.length === 0 ? { index: -1, phase: "idle", paint: current.paint }
      : { index: 0, phase: "playing", paint: current.paint + 1 });
  }, [steps.length]);
  // Both directions follow the same stated contract as the transport's availability:
  // with nothing selected, Next selects the first movement and Previous is unavailable (#191).
  const moveTo = useCallback((delta: -1 | 1) => {
    setCursor(current => {
      const target = transportStep(current.index, steps.length, delta);
      if (target === null) return current;
      return { ...current, index: target, phase: current.phase === "playing" ? "paused" : current.phase };
    });
  }, [steps.length]);
  const previous = useCallback(() => moveTo(-1), [moveTo]);
  const next = useCallback(() => moveTo(1), [moveTo]);

  const playing = cursor.phase === "playing";
  useEffect(() => {
    if (!playing) return;
    const advanced = flightAdvance(cursor.index, steps.length, "playing", recording);
    // At the recorded end the cursor waits for the run to publish more movements.
    const timer = window.setTimeout(() => setCursor({ ...cursor, index: advanced.cursor, phase: advanced.phase }),
      advanced.waiting ? TAIL_POLL_MS : flightDelayMs(pace));
    return () => window.clearTimeout(timer);
  }, [cursor, pace, playing, recording, steps.length]);

  return {
    steps,
    cursor: cursor.index,
    step,
    phase: cursor.phase,
    pace,
    paint: cursor.paint,
    position: flightPosition(steps, cursor.index, m),
    transport: flightTransport(cursor.index, steps.length, cursor.phase, recording, m),
    activity,
    activityChanges: changes,
    inTransit,
    play, pause, restart, previous, next, setPace,
  };
}

/** Controls that use the arrow keys themselves. Inside one, an arrow keeps its own meaning. */
const ARROW_OWNERS = "input, select, textarea, [contenteditable], [role='tablist'], [role='radiogroup'], [role='listbox'], [role='menu'], [role='slider'], dialog, [role='dialog'], [popover], .graph-legend";
/**
 * Everything Space already activates or scrolls, so Space plays or pauses only from neutral ground.
 * `[tabindex='0']` covers the component nodes and the focusable scroll regions, such as the inspector.
 */
const SPACE_OWNERS = `${ARROW_OWNERS}, button, a[href], summary, [role='button'], [tabindex='0']`;

/**
 * Replay from the keyboard: Left and Right step one recorded movement, Space plays or pauses.
 *
 * Like the toolbar, a key only moves the browser cursor over recorded movements. A key that a
 * focused control already uses is left to that control, and nothing is handled while a modal
 * dialog is open or while `active` is false (the graph is not on screen).
 */
export function useReplayKeys(playback: FlightPlayback, active: boolean): void {
  const { play, pause, restart, previous, next, phase } = playback;
  const toggle = playback.transport.control.action;
  const available = playback.steps.length > 0;
  useEffect(() => {
    if (!active || !available) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector("dialog[open]")) return;
      const target = event.target instanceof Element ? event.target : null;
      const action = replayKeyAction({
        key: event.key,
        modified: event.altKey || event.ctrlKey || event.metaKey || event.shiftKey,
        repeat: event.repeat,
        arrowsClaimed: target?.closest(ARROW_OWNERS) != null,
        spaceClaimed: target?.closest(SPACE_OWNERS) != null,
      });
      if (action === null) return;
      // Space would scroll the page, and an arrow would scroll a panel sideways.
      event.preventDefault();
      if (action === "previous") previous();
      else if (action === "next") next();
      else if (phase === "playing") pause();
      else if (toggle === "restart") restart();
      else if (toggle === "play") play();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, available, play, pause, restart, previous, next, phase, toggle]);
}
