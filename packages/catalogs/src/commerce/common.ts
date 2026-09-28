import type { CanonicalValue, ClientDefinition, ComponentInstance, DatabaseRow, NetworkReply, ServiceContext } from "@distlab/contracts";
import { duration, ErrorCodes } from "@distlab/contracts/kernel";
import type { ScenarioModel } from "@distlab/scenario";

export function record(value: CanonicalValue): Record<string, CanonicalValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected object");
  return value as Record<string, CanonicalValue>;
}
export function text(value: CanonicalValue | undefined): string {
  if (typeof value !== "string") throw new Error("Expected string");
  return value;
}
export function timeout(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === ErrorCodes.NETWORK_TIMEOUT;
}
export const ok = (body: CanonicalValue): NetworkReply => ({ status: "ok", body });
export function* save(ctx: ServiceContext, table: string, key: string, row: DatabaseRow) {
  const tx = ctx.db!.begin();
  if (tx.get(table, key)) tx.update(table, key, row);
  else tx.insert(table, key, row);
  yield tx.commit();
}
export function client(instance: ComponentInstance): ClientDefinition {
  return { id: instance.id, version: instance.version, initialState: {}, callbacks: {}, actions: {
    request: function* (data, ctx) {
      const input = record(data);
      const attempts = input.retry === true ? 2 : 1;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          const reply = (yield ctx.http.request({ target: text(input.target), endpoint: text(input.endpoint), body: input.body ?? {} })) as unknown as NetworkReply;
          ctx.state.set(text(input.label), reply.body);
          ctx.log.write("info", "client.result", { attempt, label: input.label!, result: reply.body });
          return reply.body;
        } catch (error) {
          if (!timeout(error)) throw error;
          ctx.log.write("warn", "client.ambiguous-timeout", { attempt });
          ctx.state.set(text(input.label), { status: "UNKNOWN" });
          if (attempt < attempts) yield ctx.clock.sleep(duration(1));
        }
      }
      return null;
    },
  } };
}
export const clientModel: ScenarioModel = { model: "commerce.client", version: "1.0.0", kind: "client", actions: ["request"], endpoints: [], consumers: [], operations: [], checks: {}, instantiate: client };
