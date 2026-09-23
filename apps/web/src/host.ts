import type { ApplicationError, CanonicalValue, RuntimeProjectionSet, WorkerCommand, WorkerEvent } from "@distlab/contracts";
import { applicationError, detached, isWorkerCommand, isWorkerEvent } from "./protocol.ts";

export interface WorkerPort {
  postMessage(message: WorkerCommand): void;
  terminate(): void;
  addEventListener(type: "message" | "error" | "messageerror", listener: EventListener): void;
  removeEventListener(type: "message" | "error" | "messageerror", listener: EventListener): void;
}

export interface HostSnapshot {
  readonly projection: RuntimeProjectionSet | null;
  readonly error: ApplicationError | null;
  readonly loading: boolean;
}

type Pending = { type: WorkerCommand["type"]; resolve: (event: WorkerEvent) => void; reject: (error: ApplicationError) => void };

/** Owns transport lifetime only. A run fingerprint is deliberately not a session ID. */
export class SimulationHost {
  readonly #createWorker: () => WorkerPort;
  readonly #listeners = new Set<() => void>();
  readonly #pending = new Map<string, Pending>();
  #worker: WorkerPort | undefined;
  #detach: (() => void) | undefined;
  #generation = 0;
  #sequence = 0;
  #snapshot: HostSnapshot = Object.freeze({ projection: null, error: null, loading: false });

  constructor(createWorker: () => WorkerPort) { this.#createWorker = createWorker; }
  getSnapshot = (): HostSnapshot => this.#snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  };

  load(scenario: CanonicalValue): Promise<WorkerEvent> {
    this.#release(applicationError("SESSION_REPLACED", "A new scenario replaced the previous session."));
    this.#update({ projection: null, error: null, loading: true });
    const generation = this.#generation;
    try {
      const worker = this.#createWorker();
      this.#worker = worker;
      const message: EventListener = event => {
        if (generation === this.#generation) this.#receive((event as MessageEvent<unknown>).data);
      };
      const failure: EventListener = () => {
        if (generation === this.#generation) this.#unavailable();
      };
      worker.addEventListener("message", message);
      worker.addEventListener("error", failure);
      worker.addEventListener("messageerror", failure);
      this.#detach = () => {
        worker.removeEventListener("message", message);
        worker.removeEventListener("error", failure);
        worker.removeEventListener("messageerror", failure);
      };
    } catch { return Promise.reject(this.#unavailable()); }
    return this.#send({ version: 1, requestId: this.#id(), type: "load", scenario });
  }

  run(maxEvents?: number): Promise<WorkerEvent> {
    return this.#send({ version: 1, requestId: this.#id(), type: "run", ...(maxEvents === undefined ? {} : { maxEvents }) });
  }
  pause(): Promise<WorkerEvent> { return this.#send({ version: 1, requestId: this.#id(), type: "pause" }); }
  step(): Promise<WorkerEvent> { return this.#send({ version: 1, requestId: this.#id(), type: "step" }); }
  reset(): Promise<WorkerEvent> { return this.#send({ version: 1, requestId: this.#id(), type: "reset" }); }
  dispose(): void {
    this.#release(applicationError("WORKER_UNAVAILABLE", "The worker host was closed."));
    this.#update({ projection: null, error: null, loading: false });
  }

  #id(): string { return `host:${this.#generation}:${++this.#sequence}`; }
  #send(command: WorkerCommand): Promise<WorkerEvent> {
    const loading = command.type === "load";
    if (!isWorkerCommand(command)) {
      const error = applicationError("INVALID_WORKER_COMMAND", "The command does not match protocol version 1.");
      if (loading) this.#release(error);
      this.#update({ ...this.#snapshot, error, loading: false });
      return Promise.reject(error);
    }
    if (!this.#worker || (command.type !== "load" && !this.#snapshot.projection)) {
      return Promise.reject(applicationError("WORKER_UNAVAILABLE", "Load a scenario before sending controls."));
    }
    return new Promise((resolve, reject) => {
      this.#pending.set(command.requestId, { type: command.type, resolve, reject });
      try { this.#worker!.postMessage(detached(command)); }
      catch { this.#unavailable(); }
    });
  }

  #receive(value: unknown): void {
    if (!isWorkerEvent(value)) { this.#unavailable("The worker returned an invalid protocol message."); return; }
    const event = detached(value);
    const pending = event.requestId === undefined ? undefined : this.#pending.get(event.requestId);
    if (event.requestId !== undefined && !pending) return;
    if (event.type === "accepted") return;
    if (event.type === "error" && pending) {
      this.#pending.delete(event.requestId);
      pending.reject(event.error);
      if (pending.type === "load") this.#release(event.error);
      const projection = pending.type === "load" || (event.error.code === "SIMULATION_FAILED" && this.#snapshot.projection?.simulation.status !== "FAILED") ? null : this.#snapshot.projection;
      this.#update({ projection, error: event.error, loading: false });
      return;
    }
    if (event.type === "loaded" && pending?.type !== "load") return;
    if (event.type === "run.finished" && pending?.type !== "run") return;
    if (event.type === "projection.updated" && (pending?.type === "load" || !this.#snapshot.projection)) return;
    if (event.type === "loaded" || event.type === "projection.updated") {
      this.#update({ projection: event.projection, error: null, loading: false });
    }
    const terminal = event.type === "loaded" || event.type === "run.finished"
      || (event.type === "projection.updated" && event.projection.simulation.status !== "FAILED" && pending && ["pause", "step", "reset"].includes(pending.type));
    if (terminal && pending && event.requestId !== undefined) {
      this.#pending.delete(event.requestId);
      pending.resolve(event);
    }
  }

  #unavailable(message = "The simulation worker stopped or could not exchange messages."): ApplicationError {
    const error = applicationError("WORKER_UNAVAILABLE", message);
    this.#release(error);
    this.#update({ projection: null, error, loading: false });
    return error;
  }
  #release(error: ApplicationError): void {
    this.#generation++;
    this.#detach?.(); this.#detach = undefined;
    this.#worker?.terminate(); this.#worker = undefined;
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
  #update(snapshot: HostSnapshot): void {
    this.#snapshot = Object.freeze(snapshot);
    for (const listener of this.#listeners) {
      try { listener(); } catch { this.#listeners.delete(listener); }
    }
  }
}
