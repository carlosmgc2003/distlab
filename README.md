# DistLab

DistLab is a work-in-progress browser-based educational simulator for distributed systems and microservice architectures. It aims to make behavior such as latency, failures, retries, duplicate messages, eventual consistency, and ambiguous outcomes visible and reproducible.

## Project status

DistLab is in the early implementation phase. `@distlab/contracts` encodes the
shared simulation types; `@distlab/kernel` provides canonical data, execution
history, deterministic scheduling, virtual time, seeded randomness, and a
headless simulation runner and deterministic virtual request/response network.
There is no browser UI yet.

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

```sh
npm install
npm run build
npm run typecheck
npm test
npm run golden:01                # print headless golden scenario 01
npm run golden:04                # print headless golden scenario 04
npm run golden:06                # print headless golden scenario 06
```

## License

DistLab is licensed under the [Apache License 2.0](LICENSE).
