/**
 * DistLab shared simulation contracts.
 *
 * TypeScript encoding of docs/spec. Names and shapes follow those specs.
 * Importing this package must not pull in runtime models, application
 * packages, or UI. Implementations live in later packages and inject
 * capabilities at a composition root.
 */

export * from "./kernel/index.js";
export * from "./network.js";
export * from "./message-bus.js";
export * from "./database.js";
export * from "./kv-store.js";
export * from "./fault.js";
export * from "./logging.js";
export * from "./service.js";
export * from "./client.js";
export * from "./external.js";
export * from "./scenario.js";
export * from "./application.js";
export * from "./mvp-catalog.js";
export {
  ObservationTypes,
  type KnownObservationType,
} from "./observation-types.js";
