import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_FLIGHT_PACE,
  flightAdvance,
  flightDelayMs,
  flightPosition,
  flightSteps,
  flightTransport,
} from "./flight.ts";
import type { FlightPace, FlightPosition, FlightStep, FlightTransport, PlaybackPhase } from "./flight.ts";
import type { MovementEdge } from "./records.ts";
import { selectionStep } from "./timeline.ts";
import type { Observation } from "@distlab/contracts";

/** How often the host timer rechecks while the cursor waits for the run to record more movements. */
const TAIL_POLL_MS = 200;

interface Cursor {
  readonly index: number;
  readonly phase: PlaybackPhase;
}

export interface FlightPlayback {
  readonly steps: readonly FlightStep[];
  readonly cursor: number;
  readonly step: FlightStep | undefined;
  readonly phase: PlaybackPhase;
  readonly pace: FlightPace;
  readonly position: FlightPosition;
  readonly transport: FlightTransport;
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
): FlightPlayback {
  const steps = useMemo(() => flightSteps(observations, edges), [observations, edges]);
  // One record holds the cursor and the phase, so a single transition can never
  // paint a cursor the phase does not belong to.
  const [cursor, setCursor] = useState<Cursor>({ index: -1, phase: "idle" });
  const [pace, setPace] = useState<FlightPace>(DEFAULT_FLIGHT_PACE);

  // A shorter recorded list, a new session, or a new history selection releases the cursor.
  useEffect(() => {
    setCursor(current => (current.index < 0
      ? current
      : { index: Math.min(current.index, steps.length - 1), phase: current.phase }));
    setCursor(current => (current.phase === "playing" && steps.length === 0 ? { ...current, phase: "idle" } : current));
  }, [steps.length]);
  useEffect(() => { setCursor({ index: -1, phase: "idle" }); }, [release]);

  const step = cursor.index >= 0 ? steps[cursor.index] : undefined;
  const play = useCallback(() => {
    setCursor(current => current.phase === "playing" ? current
      : steps.length === 0 ? current
      : { index: current.index >= 0 ? current.index : 0, phase: "playing" });
  }, [steps.length]);
  const pause = useCallback(() => {
    setCursor(current => current.phase === "idle" ? current : { ...current, phase: "paused" });
  }, []);
  const restart = useCallback(() => {
    setCursor(steps.length === 0 ? { index: -1, phase: "idle" } : { index: 0, phase: "playing" });
  }, [steps.length]);
  // Both directions follow the same stated contract as the transport's availability:
  // with nothing selected, Previous reaches the last movement and Next the first.
  const moveTo = useCallback((delta: -1 | 1) => {
    setCursor(current => {
      const target = selectionStep(current.index, steps.length, delta);
      if (target === null) return current;
      return { index: target, phase: current.phase === "playing" ? "paused" : current.phase };
    });
  }, [steps.length]);
  const previous = useCallback(() => moveTo(-1), [moveTo]);
  const next = useCallback(() => moveTo(1), [moveTo]);

  const playing = cursor.phase === "playing";
  useEffect(() => {
    if (!playing) return;
    const advanced = flightAdvance(cursor.index, steps.length, "playing", recording);
    // At the recorded end the cursor waits for the run to publish more movements.
    const timer = window.setTimeout(() => setCursor({ index: advanced.cursor, phase: advanced.phase }),
      advanced.waiting ? TAIL_POLL_MS : flightDelayMs(pace));
    return () => window.clearTimeout(timer);
  }, [cursor, pace, playing, recording, steps.length]);

  return {
    steps,
    cursor: cursor.index,
    step,
    phase: cursor.phase,
    pace,
    position: flightPosition(steps, cursor.index),
    transport: flightTransport(cursor.index, steps.length, cursor.phase, recording),
    play, pause, restart, previous, next, setPace,
  };
}
