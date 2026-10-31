/**
 * Compile-time lock that spec public names are exported. This file is
 * typechecked, not executed.
 */
import type {
  BusMessage,
  ComponentId,
  LessonOverlayPolicy,
  NetworkRequest,
  Observation,
  ScenarioDefinition,
  ScheduledEvent,
  ServiceDefinition,
  SessionIdentity,
  SessionOverlay,
  Simulation,
  SimulationTime,
  VirtualClock,
} from "../src/index.ts";

type Vocabulary = {
  SimulationTime: SimulationTime;
  ComponentId: ComponentId;
  ScheduledEvent: ScheduledEvent;
  Observation: Observation;
  Simulation: Simulation;
  VirtualClock: VirtualClock;
  BusMessage: BusMessage;
  NetworkRequest: NetworkRequest;
  ServiceDefinition: ServiceDefinition;
  ScenarioDefinition: ScenarioDefinition;
  SessionOverlay: SessionOverlay;
  SessionIdentity: SessionIdentity;
  LessonOverlayPolicy: LessonOverlayPolicy;
};

declare const vocabulary: Vocabulary;
void vocabulary;
