import type { CanonicalValue, ClockController, ComponentId, ControlledOperation, Duration, EventId, ObservationSink, ScheduleMetadata, ScheduledHandle, Scheduler, SimulationTime, TaskId, VirtualClock } from "@distlab/contracts/kernel";
import { ClockObservationTypes, duration, ErrorCodes, simulationTime, throwSimulationError } from "@distlab/contracts/kernel";
import { canonicalCopy } from "./canonical.js";

/** Core-owned bridge: creates/registers a wake operation only inside a controlled task. */
export interface SleepPort {
  active(): boolean;
  scheduleWake(dueTime: SimulationTime): { operation: ControlledOperation; handle: ScheduledHandle; taskId: TaskId };
}
export interface ClockOptions {
  scheduler: Pick<Scheduler, "schedule">;
  observations: ObservationSink;
  startTime?: SimulationTime;
  sleep?: SleepPort;
}
const fail = (code: string): never => throwSimulationError(code);

export function addDuration(now: SimulationTime, delay: Duration): SimulationTime {
  simulationTime(now); duration(delay);
  const sum = now + delay;
  if (!Number.isSafeInteger(sum)) fail(ErrorCodes.TIME_OVERFLOW);
  return simulationTime(sum);
}

export class DeterministicVirtualClock implements VirtualClock, ClockController {
  readonly #options: ClockOptions;
  #time: SimulationTime;
  #generation = 0;
  constructor(options: ClockOptions) {
    this.#options = options;
    this.#time = simulationTime(options.startTime ?? 0);
  }
  now(): SimulationTime { return this.#time; }
  advanceTo(time: SimulationTime, causingEventId?: EventId): void {
    simulationTime(time);
    if (time < this.#time) fail(ErrorCodes.CLOCK_REWIND);
    const from = this.#time;
    this.#time = time;
    if (time !== from) this.#options.observations.record({ type: ClockObservationTypes.Advanced,
      source: "simulation", ...(causingEventId === undefined ? {} : { eventId: causingEventId }),
      data: { from, to: time, ...(causingEventId === undefined ? {} : { causingEventId }) } });
  }
  reset(startTime?: SimulationTime): void {
    this.#time = simulationTime(startTime ?? this.#options.startTime ?? 0);
    this.#generation++;
  }
  schedule<T extends CanonicalValue>(delay: Duration, type: string, payload: T, metadata?: ScheduleMetadata): ScheduledHandle {
    const dueTime = addDuration(this.#time, delay);
    const copiedMetadata = metadata === undefined ? {} : canonicalCopy(metadata) as ScheduleMetadata;
    const handle = this.#options.scheduler.schedule({ time: dueTime, type, payload, ...copiedMetadata });
    const generation = this.#generation;
    return Object.freeze({ eventId: handle.eventId, dueTime: handle.dueTime, cancel: () => {
      if (generation !== this.#generation) fail(ErrorCodes.STALE_CAPABILITY);
      return handle.cancel();
    } });
  }
  sleep(delay: Duration): ControlledOperation {
    const dueTime = addDuration(this.#time, delay);
    const port = this.#options.sleep;
    if (!port || !port.active()) fail(ErrorCodes.NO_ACTIVE_TASK);
    const { operation, handle } = port!.scheduleWake(dueTime);
    this.#options.observations.record({ type: ClockObservationTypes.SleepScheduled, source: "simulation",
      eventId: handle.eventId, data: { wakeEventId: handle.eventId, duration: delay, dueTime } });
    return operation;
  }
  /** Called by the core when a wake event resolves its task. */
  resumeSleep(eventId: EventId, taskId: TaskId): void {
    this.#options.observations.record({ type: ClockObservationTypes.SleepResumed, source: "simulation",
      eventId, data: { wakeEventId: eventId, taskId, time: this.#time } });
  }
  /** Return an owner-bound capability; the core retains the controller. */
  forOwner(owner: ComponentId, allowedTypes: ReadonlySet<string>): VirtualClock {
    const generation = this.#generation;
    const check = () => { if (generation !== this.#generation) fail(ErrorCodes.STALE_CAPABILITY); };
    return Object.freeze({
      now: () => { check(); return this.now(); },
      sleep: (delay: Duration) => { check(); return this.sleep(delay); },
      schedule: <T extends CanonicalValue>(delay: Duration, type: string, payload: T, metadata?: ScheduleMetadata) => {
        check();
        const copy = metadata === undefined ? {} : canonicalCopy(metadata) as ScheduleMetadata;
        if (!allowedTypes.has(type) || (copy.source !== undefined && copy.source !== owner) ||
            (copy.target !== undefined && copy.target !== owner)) fail(ErrorCodes.INVALID_EVENT_TYPE);
        return this.schedule(delay, type, payload, { ...copy, source: owner, target: owner });
      },
    });
  }
}
