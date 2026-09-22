# DistLab

DistLab is a work-in-progress browser-based educational simulator for distributed systems and microservice architectures. It aims to make behavior such as latency, failures, retries, duplicate messages, eventual consistency, and ambiguous outcomes visible and reproducible.

## Project status

DistLab is in the early implementation phase. `@distlab/contracts` encodes the
shared simulation types; `@distlab/kernel` provides canonical data, execution
history, deterministic scheduling, and virtual time. There is no runnable
simulator or browser UI yet.

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

```sh
npm install
npm run build
npm run typecheck
npm test
```

## License

DistLab is licensed under the [Apache License 2.0](LICENSE).
