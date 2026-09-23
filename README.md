# DistLab

DistLab is a work-in-progress browser-based educational simulator for distributed systems and microservice architectures. It aims to make behavior such as latency, failures, retries, duplicate messages, eventual consistency, and ambiguous outcomes visible and reproducible.

## Project status

DistLab is in the early implementation phase. `@distlab/contracts` encodes the
shared simulation types; `@distlab/kernel` provides canonical data, execution
history, deterministic scheduling, virtual time, seeded randomness, and a
headless simulation runner and deterministic virtual request/response network.
`apps/web` provides a minimal React scenario chooser backed by a Web Worker.
`@distlab/catalogs` provides versioned checkout
models, two scenarios, and their assessment predicates. `@distlab/scenario`
validates a scenario document, composes the kernel runtimes, and evaluates assertions at
deterministic event boundaries. Golden scenarios 01, 02, 04, 05, 06, and 07
are loaded through one headless harness (`packages/kernel/examples/harness.ts`).

## Goals

DistLab is intended to let students and instructors:

- design systems from clients, internal services, external services, and infrastructure primitives;
- run deterministic scenarios using virtual time and seeded randomness;
- inject network, service, and messaging failures;
- inspect requests, messages, state changes, and execution history;
- reason about distributed patterns without first deploying production infrastructure.

DistLab models the semantics that matter for learning rather than emulating specific products.

## Design principles

- The simulation owns time, scheduling, and randomness.
- Components communicate through the modeled `VirtualNetwork` or `MessageBus`.
- Internal services, external services, clients, and infrastructure primitives remain distinct.
- Identical architecture, scenario, configuration, and seed inputs must produce identical results.
- Observability is part of the simulation model and supports debugging, replay, and assessment.

## Documentation

- [Vision](docs/vision.md) describes the educational problem, target audience, reference domain, and intended product experience.
- [Architecture](docs/architecture.md) defines the simulation model, runtime components, state boundaries, and architectural guarantees.
- [Glossary](docs/glossary.md) establishes the terminology used throughout the project.
- [Shared simulation contracts](docs/spec/contracts.md) defines common values, identities, capabilities, and correlation rules. The TypeScript encoding is [`packages/contracts`](packages/contracts) (`@distlab/contracts`).
- [Component specifications](docs/spec/) covers the simulation core, scheduler, virtual clock, observability, and the following runtime and application models:
  - [Virtual Network](docs/spec/virtual-network.md) and [Message Bus](docs/spec/message-bus.md)
  - [Database](docs/spec/database.md) and [KeyValueStore](docs/spec/kv-store.md)
  - [Service Runtime](docs/spec/service-runtime.md), [Client Runtime](docs/spec/client-runtime.md), and [External Service Runtime](docs/spec/external-service-runtime.md)
  - [Fault Engine](docs/spec/fault-engine.md) and [Scenario Engine](docs/spec/scenario-engine.md)
- [Architecture decisions](docs/spec/adr/) records significant decisions about simulation semantics.

The documentation is evolving while the remaining design decisions are made.

## Headless kernel

`HeadlessSimulationFactory` from `@distlab/kernel` composes a fresh clock,
scheduler, history, and random stream for every construction and reset. Optional
`createClock`, `createScheduler`, `createHistory`, and `createRandom` port factories
allow a composition root to inject per-attempt implementations. Pass
normalized `RunInputs` and a synchronous initializer that registers handlers
before scheduling initial events. The returned simulation supports `step()`,
`run()`, `pause()`, and `reset()`; its `history.export()` provides canonical
observations. Trusted adapters may use `operations` for controlled completion
and `taskLifecycle` for abandonment. `HeadlessSimulationFactory` optionally
accepts a per-attempt `createBoundaryHook` for deterministic read-side checks.
The host yields through `MessageChannel` only between event boundaries.
Handlers use generators and virtual sleeps, not native async work. No browser, React, or scenario interpreter is required.

To enable modeled network transport, pass directed `network.targets` and
`network.links` to `HeadlessSimulationFactory`. The initializer obtains
owner-bound request ports with `setup.networkFor(owner)` and a trusted reply and
registration port with `setup.networkController()`. Receivers can enqueue
target-owned work using `setup.enqueueNetworkWork(owner, type, payload)` during
delivery. Register handlers and receivers before the first initial event is
scheduled. `setup.networkInFlight()` returns detached pending metadata. An
optional `network.faults` port supplies request and response leg decisions;
without it, the decision is neutral. See the executable
[`network tests`](packages/kernel/tests/network.test.ts) for success, timeout,
lost response, reset, and callback examples.

To enable the message broker, pass `messageBus.destinations` to
`HeadlessSimulationFactory`. Each destination is a queue or topic. Omitted
delivery and retry delays default to 0, the ACK timeout to 1000 ms, max
attempts to 3, and capacity to 10000. The initializer obtains an owner-bound
publish port with `setup.messageBusFor(owner)` and the trusted subscription
port with `setup.messageBusController()`. Subscribe before the first initial
event is scheduled. `setup.inspectMessageBus()` returns detached routing
state, cursors, counters, and dead letters. Publish success means the broker
accepted the message. An optional `messageBus.faults` port supplies delivery
delay, drop, and duplicate decisions; without it, the decision is neutral.
See the executable [`message bus tests`](packages/kernel/tests/message-bus.test.ts).

Golden scenario 01 is a runnable, UI-free fixture in
[`packages/kernel/examples/golden-01.ts`](packages/kernel/examples/golden-01.ts).
`npm run golden:01` prints its final state and canonical history. Its checked-in
[digest and expected state](packages/kernel/examples/golden-01.expected.json)
are verified by `npm test` across independent continuous runs, repeated steps,
per-boundary resumes, and reset/replay.

Golden scenario 04 is a runnable, UI-free fixture in
[`packages/kernel/examples/golden-04.ts`](packages/kernel/examples/golden-04.ts).
One service publishes `OrderCreated` and another service consumes it.
`npm run golden:04` prints the final state and canonical history. Its checked-in
[digest and expected state](packages/kernel/examples/golden-04.expected.json)
are verified by `npm test`, including the shared publication, delivery, and
acknowledgement trace.

`DeterministicFaultEngine` selects ordered, seeded rules at network, message
delivery, and database commit boundaries. Construct it in each simulation
initializer with the run clock, random port, and observation sink, then inject
its decision port into the boundary owner. Scheduled crash and provider
availability faults use narrow trusted callbacks inside scenario events.

Golden scenario 05 duplicates one `OrderCreated` delivery through a fault rule.
`npm run golden:05` prints its state and canonical history; its checked-in
[expected digest](packages/kernel/examples/golden-05.expected.json) is verified
by `npm test` across fresh runs and reset.

`DeterministicExternalServiceRuntime` is a provider outside the simulated
service. Construct it in the initializer with a versioned definition. The
initializer `configure` callback, and later `dispatch` on that provider's
scenario event, are the controller. Service code reaches the provider only
through `VirtualNetwork`. `inspect` returns the declared visible projection.

Golden scenario 06 is a runnable, UI-free fixture in
[`packages/kernel/examples/golden-06.ts`](packages/kernel/examples/golden-06.ts).
Billing calls a provider `authorize` operation and receives the provider
callback. `npm run golden:06` prints the final state and canonical history. Its
checked-in
[digest and expected state](packages/kernel/examples/golden-06.expected.json)
are verified by `npm test`. The response-suppression fixture in
[`packages/kernel/examples/response-suppression.ts`](packages/kernel/examples/response-suppression.ts)
commits the remote effect and still settles the caller with `NETWORK_TIMEOUT`.

Golden scenario 07 drops a processor's successful response through a fault
rule. The processor applies its effect, while the caller times out. Run
`npm run golden:07`; its checked-in
[expected digest](packages/kernel/examples/golden-07.expected.json) is verified
by `npm test` across fresh runs and reset.

```sh
npm install
npm run browser:install          # install Chromium once for the browser smoke test
npm run dev                      # build packages and start the browser app on localhost
npm run build
npm run build:packages           # compile the headless workspaces only
npm run typecheck
npm test                         # all unit, integration, boundary, and browser tests
npm run test:browser             # browser smoke test against the production build
npm run test:boundaries          # verify the main-thread and package import boundaries
npm run golden:01                # print headless golden scenario 01
npm run golden:02                # print headless golden scenario 02
npm run golden:04                # print headless golden scenario 04
npm run golden:05                # print headless golden scenario 05
npm run golden:06                # print headless golden scenario 06
npm run golden:07                # print headless golden scenario 07
```

## License

DistLab is licensed under the [Apache License 2.0](LICENSE).

## Browser worker host

Use Node.js 22.12 or newer and `npm install`. `npm run dev` starts Vite at
`http://127.0.0.1:5173`; choose either checkout scenario and press **Load scenario**
to receive READY, architecture, and execution projections from the worker.
`npm run build` produces the static site in `apps/web/dist`, including its worker
bundle; no backend is required. Linux CI images may also need
`npm exec -w @distlab/web -- playwright install --with-deps chromium`.

The [application boundary](docs/spec/application-boundary.md) contracts are used
unchanged. `SimulationHost` exposes load, run, pause, step, reset, and a read-only
snapshot; status arrives inside projections. React uses only this host and
scenario data. The data-only catalog scenario module is imported directly so
model factories and the ScenarioEngine never enter the main-thread module graph.
The worker adapter owns the engine and delegates controls to Simulation.

Each load terminates the previous worker and clears its projection. Host worker
generations and unique request IDs fence late messages even when two loads have
the same deterministic run ID. Invalid loads expose no runnable partial session;
worker startup, transport, and worker errors clear the projection and surface a
structured `WORKER_UNAVAILABLE` host error. Loading again starts a fresh worker.
Host subscriber failures do not change canonical history.

The adapter acknowledges valid commands with `accepted`. `load` finishes with
`loaded`; `step`, `pause`, and `reset` finish with a correlated
`projection.updated`. `run` publishes its final boundary projection followed by
`run.finished`; runtime failure instead produces `SIMULATION_FAILED` with the
kernel error context. Projection notifications are coalesced to control
boundaries, and the kernel yields every 16 events so pause messages can arrive.
Projections are copied and recursively frozen on both sides of structured clone.
Component state is labeled `host` visibility and is not rendered by the shell.

This initial host accepts exactly the two packaged checkout documents. Their
complete, visible scheduler observations provide pending/processed event counts,
and their specified random draw count is zero. Modified or arbitrary scenarios
are rejected with `INVALID_SCENARIO`: general scenario hosting requires a kernel
counter read port, including reliable counts when history is incomplete or
redacted. No counters are inferred from incomplete history. UI controls beyond
the chooser are reserved for subsequent issues.

## Checkout lesson

`@distlab/catalogs` exports `checkoutCatalog`, `checkoutAssessment`, and
`checkoutScenario("normal" | "response-lost")`. The two scenarios share one
architecture. The response-lost input selects a `network.response` FaultEngine
rule; the provider records one approved authorization while Payments records
`UNKNOWN` and `NETWORK_TIMEOUT`. Run `npm test -w @distlab/catalogs` for the
headless proof, including fresh, stepped, and reset replay comparisons.

Install with `npm install`, then use `npm run build`, `npm run typecheck`, and
`npm test` for all workspaces.
