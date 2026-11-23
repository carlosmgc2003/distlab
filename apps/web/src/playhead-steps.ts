import type { Observation, SimulationTime } from "@distlab/contracts";
import { flightFacts, flightSteps, patternOf } from "./flight.ts";
import type { FlightFact, FlightStep } from "./flight.ts";
import type { MovementEdge, RecordKind } from "./records.ts";
import { storyMilestones } from "./story-timeline.ts";
import { recordLabel } from "./timeline.ts";
import type { Messages } from "./i18n/catalog.ts";
import type { ComponentNames } from "./component-display.ts";

/**
 * Presentation-only reading of a run's teaching milestones as playhead steps
 * (RFC 0002 P4): one step per milestone, whether it travels a link or not. The
 * milestone set and its order are the Story view's (`storyMilestones`). A
 * milestone that travels a link is the `FlightStep` that `flightSteps` produces
 * for it, unchanged. Every value is copied from a stored observation field;
 * nothing is inferred, and no simulation state is read, allocated, or changed.
 */

/** The stored source of a record that no component owns (`Observation.source` in the contracts). */
const SIMULATION_SOURCE = "simulation";

/** A teaching milestone that travels no link: painted on its component, narrated like a movement. */
export interface RecordStep {
  readonly observationId: string;
  readonly sequence: number;
  readonly time: SimulationTime;
  /** Teaching category, from the milestone table. */
  readonly recordKind: RecordKind;
  /**
   * The component the record is recorded at: its stored source. Absent for a record the
   * simulation itself writes, such as a check result, which names no component.
   */
  readonly component?: string;
  /** The component as a one-element list, or empty: the shape `flightBackground` reads. */
  readonly nodeIds: readonly string[];
  /** Stored plain-language label for the record type, as a movement's `headline`. */
  readonly headline: string;
  readonly facts: readonly FlightFact[];
  /** A question about the pattern this record belongs to. Never an outcome claim. */
  readonly pattern: string;
}

/** One playhead step: a recorded movement, or a milestone that travels no link. */
export type PlayheadStep = FlightStep | RecordStep;

/** True when the step travels a link: it is the `FlightStep` of a recorded movement. */
export function travelsLink(step: PlayheadStep): step is FlightStep {
  return "leg" in step;
}

/** One milestone that travels no link. Reads stored fields only. */
export function recordStep(observation: Observation, kind: RecordKind, m: Messages): RecordStep {
  const component = observation.source === SIMULATION_SOURCE ? undefined : observation.source;
  return {
    observationId: observation.id,
    sequence: observation.sequence,
    time: observation.time,
    recordKind: kind,
    ...(component !== undefined ? { component } : {}),
    nodeIds: component !== undefined ? [component] : [],
    headline: recordLabel(observation, m),
    facts: flightFacts(observation, m),
    pattern: patternOf(observation.type, m),
  };
}

/**
 * Every teaching milestone of the run as a playhead step, in canonical order. A check is a step
 * for its first result and for each change of its result, as in the Story view. Nothing is
 * merged, reordered, or read ahead of a step.
 */
export function playheadSteps(
  observations: readonly Observation[],
  edges: readonly MovementEdge[],
  m: Messages,
  names?: ComponentNames,
): readonly PlayheadStep[] {
  const movements = new Map(flightSteps(observations, edges, m, names).map(step => [step.observationId, step]));
  return storyMilestones(observations, m).map(milestone =>
    movements.get(milestone.observation.id) ?? recordStep(milestone.observation, milestone.kind, m));
}

