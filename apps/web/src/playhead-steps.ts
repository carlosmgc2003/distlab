import type { Observation, SimulationTime } from "@distlab/contracts";
import { flightFacts, flightSteps, patternOf } from "./flight.ts";
import type { FlightFact, FlightStep } from "./flight.ts";
import type { MovementEdge, RecordKind } from "./records.ts";
import { SHAPES, storyMilestones } from "./story-timeline.ts";
import { recordLabel } from "./timeline.ts";
import { kvSentence } from "./kv-wording.ts";
import type { Messages } from "./i18n/catalog.ts";
import type { ComponentNames } from "./component-display.ts";
import { displayName } from "./component-display.ts";

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
  /** What a key-value record did, from stored fields (RFC 0003 K4). Absent for any other record. */
  readonly sentence?: string;
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

/**
 * One milestone that travels no link. Reads stored fields only. `observations` is the history the
 * record belongs to, read only to name the writer of a key-value record.
 */
export function recordStep(observation: Observation, kind: RecordKind, m: Messages, observations: readonly Observation[] = [], names?: ComponentNames): RecordStep {
  const component = observation.source === SIMULATION_SOURCE ? undefined : observation.source;
  const sentence = kvSentence(observation, observations, m, names);
  return {
    observationId: observation.id,
    sequence: observation.sequence,
    time: observation.time,
    recordKind: kind,
    ...(component !== undefined ? { component } : {}),
    nodeIds: component !== undefined ? [component] : [],
    headline: recordLabel(observation, m),
    ...(sentence !== undefined ? { sentence } : {}),
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
    movements.get(milestone.observation.id) ?? recordStep(milestone.observation, milestone.kind, m, observations, names));
}


/** What the graph and the narration say about a milestone that travels no link. */
export interface RecordStepText {
  /** The teaching category's non-color marker, as the Story view draws it. */
  readonly glyph: string;
  /** Where it is recorded: its component, or the simulation. */
  readonly route: string;
  /** One sentence for the live region: stored label, component, and virtual time. */
  readonly announcement: string;
  readonly transit: string;
}

/** Text for a milestone that travels no link, in `m`'s language. Names components by display name (#103). */
export function recordStepText(step: RecordStep, m: Messages, names?: ComponentNames): RecordStepText {
  const copy = m.playback.narration;
  const component = step.component !== undefined ? displayName(names, step.component) : undefined;
  return {
    glyph: SHAPES[step.recordKind],
    route: component !== undefined ? copy.recordAt(component) : copy.recordBySimulation,
    announcement: [copy.recordAnnouncement({ label: step.headline, ...(component !== undefined ? { component } : {}), time: step.time }),
      ...(step.sentence !== undefined ? [step.sentence] : [])].join(" "),
    transit: copy.recordTransit,
  };
}
