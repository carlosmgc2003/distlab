import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DeterministicExternalServiceRuntime, DeterministicServiceRuntime, HeadlessSimulationFactory, canonicalCopy, canonicalEncode, sha256Hex } from "@distlab/kernel";
import { duration, simulationTime, throwSimulationError } from "@distlab/contracts/kernel";
import type { ControlledTask, RunInputs } from "@distlab/contracts/kernel";
import type { CanonicalValue, MessageBus, NetworkReply } from "@distlab/contracts";

/** Headless fixture: billing calls a provider and receives its callback. */
export const golden06Inputs: RunInputs = {
  contractVersion: 1,
  modelVersions: { "kernel.external-service-runtime": "1", "fixture.golden-06": "1", service: "1", external: "1" },
  architecture: { components: ["billing", "provider"] },
  scenario: { id: "golden-06", actions: ["authorize", "callback"] },
  configuration: {
    startTime: simulationTime(0), historyLimit: 1000,
    visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {},
  },
  seed: "golden-06",
};

/** Present in provider state and absent from replies, callbacks, and history. */
export const golden06Secret = "provider-ledger-secret";

interface GoldenState {
  authorizationId: string;
  status: string;
  callbackEventId: string;
  authorizationCount: number;
  availability: string;
}

const events: MessageBus = { publish: () => throwSimulationError("INVALID_MESSAGE_OPERATION") };

export function createGolden06() {
  let state: GoldenState = { authorizationId: "", status: "", callbackEventId: "", authorizationCount: 0, availability: "" };
  let provider!: DeterministicExternalServiceRuntime;
  const simulation = new HeadlessSimulationFactory({ network: { targets: ["billing", "provider"], links: [
    { source: "billing", target: "provider" }, { source: "provider", target: "billing" },
  ] } }).createSimulation(golden06Inputs, setup => {
    state = { authorizationId: "", status: "", callbackEventId: "", authorizationCount: 0, availability: "" };
    provider = new DeterministicExternalServiceRuntime({
      definition: {
        id: "provider", version: "1", initialState: { orders: [], secret: golden06Secret },
        operations: { authorize: { apply: (body, current, parameters) => {
          const request = body as { orderId: string };
          const decision = (parameters as { decision?: string } | null)?.decision;
          const ledger = current as { orders: readonly string[]; secret: string };
          if (decision !== "approved") {
            return { nextState: { orders: [...ledger.orders], secret: ledger.secret }, reply: { status: "error", body: { code: "DECLINED" } },
              visibleChanges: { authorizationCount: ledger.orders.length }, callbacks: [] };
          }
          const orders = [...ledger.orders, request.orderId];
          return {
            nextState: { orders, secret: ledger.secret },
            reply: { status: "ok", body: { authorizationId: `auth-${request.orderId}`, status: "approved" } },
            visibleChanges: { authorizationCount: orders.length },
            callbacks: [{ after: duration(20), request: { target: "billing", endpoint: "POST /provider-callback", body: { eventId: "e1", orderId: request.orderId } } }],
          };
        } } },
      },
      setup, scenarioEventType: "scenario.provider", activeOwner: () => simulation.activeTaskOwner, activeEvent: () => simulation.activeEvent,
      configure: controller => controller.configure("authorize", {
        latency: duration(30), degradedExtraLatency: duration(0), dropResponse: false, parameters: { decision: "approved" },
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
        const reply = (yield ctx.http.request({ target: "provider", endpoint: "authorize", body: { orderId: "o1" } })) as unknown as NetworkReply;
        const payload = reply.body as { authorizationId: string; status: string };
        state.authorizationId = payload.authorizationId;
        state.status = payload.status;
      } } }),
    });
    setup.schedule({ time: simulationTime(0), type: billing.lifecycleEventType, payload: { next: "RUNNING" } });
    setup.schedule({ time: simulationTime(1), type: billing.backgroundEventType, payload: { name: "authorize", data: null } });
  });
  return { simulation, snapshot: (): GoldenState => {
    const visible = provider.inspect().visible as { authorizationCount: number };
    state.authorizationCount = visible.authorizationCount;
    state.availability = provider.availability;
    return canonicalCopy(state) as unknown as GoldenState;
  } };
}

export function golden06Result(fixture: ReturnType<typeof createGolden06>) {
  const { simulation, snapshot } = fixture;
  const state = snapshot();
  const history = simulation.history.export();
  return { status: simulation.status, time: simulation.time, state, history,
    digest: sha256Hex(canonicalEncode(canonicalCopy({ status: simulation.status, time: simulation.time, state, history }))) };
}

// Usage: node --experimental-strip-types packages/kernel/examples/golden-06.ts
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixture = createGolden06();
  await fixture.simulation.run();
  process.stdout.write(`${JSON.stringify(golden06Result(fixture), null, 2)}\n`);
}
