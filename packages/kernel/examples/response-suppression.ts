import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DeterministicExternalServiceRuntime, DeterministicServiceRuntime, HeadlessSimulationFactory, canonicalCopy, canonicalEncode, sha256Hex } from "@distlab/kernel";
import { duration, simulationTime, throwSimulationError } from "@distlab/contracts/kernel";
import type { ControlledTask, RunInputs } from "@distlab/contracts/kernel";
import type { CanonicalValue, MessageBus, NetworkReply } from "@distlab/contracts";

/** Caller times out after the provider has committed. The effect is not undone. */
export const suppressionInputs: RunInputs = {
  contractVersion: 1,
  modelVersions: { "kernel.external-service-runtime": "1", "fixture.response-suppression": "1" },
  architecture: { components: ["billing", "provider"] },
  scenario: { id: "response-suppression", actions: ["authorize"] },
  configuration: {
    startTime: simulationTime(0), historyLimit: 1000,
    visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {},
  },
  seed: "response-suppression",
};

export const suppressionSecret = "suppressed-ledger-secret";

interface SuppressionState {
  caller: string;
  callbackEventId: string;
  effectCount: number;
  suppressedCount: number;
  authorizationCount: number;
}

const events: MessageBus = { publish: () => throwSimulationError("INVALID_MESSAGE_OPERATION") };

export function createResponseSuppression() {
  let state: SuppressionState = { caller: "", callbackEventId: "", effectCount: 0, suppressedCount: 0, authorizationCount: 0 };
  let provider!: DeterministicExternalServiceRuntime;
  const simulation = new HeadlessSimulationFactory({ network: { targets: ["billing", "provider"], links: [
    { source: "billing", target: "provider" }, { source: "provider", target: "billing" },
  ] } }).createSimulation(suppressionInputs, setup => {
    state = { caller: "", callbackEventId: "", effectCount: 0, suppressedCount: 0, authorizationCount: 0 };
    provider = new DeterministicExternalServiceRuntime({
      definition: {
        id: "provider", version: "1", initialState: { approved: [], secret: suppressionSecret },
        operations: { authorize: { apply: (body, current) => {
          const request = body as { orderId: string };
          const ledger = current as { approved: readonly string[]; secret: string };
          const approved = [...ledger.approved, request.orderId];
          return {
            nextState: { approved, secret: ledger.secret },
            reply: { status: "ok", body: { authorizationId: `auth-${request.orderId}`, status: "approved" } },
            visibleChanges: { authorizationCount: approved.length },
            callbacks: [{ after: duration(10), request: { target: "billing", endpoint: "POST /provider-callback", body: { eventId: "e1", orderId: request.orderId } } }],
          };
        } } },
      },
      setup, scenarioEventType: "scenario.provider", activeOwner: () => simulation.activeTaskOwner, activeEvent: () => simulation.activeEvent,
      configure: controller => controller.configure("authorize", {
        latency: duration(0), degradedExtraLatency: duration(0), dropResponse: true, parameters: null,
      }),
    });
    const billing = new DeterministicServiceRuntime({
      id: "billing", version: "1", setup, taskLifecycle: () => simulation.taskLifecycle, activeOwner: () => simulation.activeTaskOwner, events,
      resolve: () => ({ id: "billing", version: "1", consumers: {}, endpoints: {
        "POST /provider-callback": (body: CanonicalValue): NetworkReply => {
          state.callbackEventId = (body as { eventId: string }).eventId;
          return { status: "ok", body: { received: true } };
        },
      }, background: { authorize: function* (_data, ctx): ControlledTask {
        try {
          yield ctx.http.request({ target: "provider", endpoint: "authorize", body: { orderId: "o1" } });
          state.caller = "reply";
        } catch (error) {
          state.caller = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "error";
        }
      } } }),
    });
    setup.schedule({ time: simulationTime(0), type: billing.lifecycleEventType, payload: { next: "RUNNING" } });
    setup.schedule({ time: simulationTime(1), type: billing.backgroundEventType, payload: { name: "authorize", data: null } });
  });
  return { simulation, snapshot: (): SuppressionState => {
    const boundary = provider.boundary();
    const visible = boundary.visible as { authorizationCount: number };
    state.effectCount = boundary.effectCount;
    state.suppressedCount = boundary.suppressedCount;
    state.authorizationCount = visible.authorizationCount;
    return canonicalCopy(state) as unknown as SuppressionState;
  } };
}

export function suppressionResult(fixture: ReturnType<typeof createResponseSuppression>) {
  const { simulation, snapshot } = fixture;
  const state = snapshot();
  const history = simulation.history.export();
  return { status: simulation.status, time: simulation.time, state, history,
    digest: sha256Hex(canonicalEncode(canonicalCopy({ status: simulation.status, time: simulation.time, state, history }))) };
}

// Usage: node --experimental-strip-types packages/kernel/examples/response-suppression.ts
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixture = createResponseSuppression();
  await fixture.simulation.run();
  process.stdout.write(`${JSON.stringify(suppressionResult(fixture), null, 2)}\n`);
}
