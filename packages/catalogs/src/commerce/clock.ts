import type { DatabaseRow, ServiceContext, ServiceDefinition } from "@distlab/contracts";
import type { ScenarioModel } from "@distlab/scenario";
import { titleReplicaDescriptor } from "./descriptors.js";
import { ok, record, text } from "./common.js";

const DOC = "doc-1";

interface Stamped { readonly stamp: number; readonly origin: string }

/** Last-writer-wins order: the larger stamp wins, and the origin's name breaks a tie. */
const newer = (left: Stamped, right: DatabaseRow | undefined) =>
  !right || left.stamp > (right.stamp as number) || (left.stamp === right.stamp && left.origin > text(right.origin));

function* store(ctx: ServiceContext, write: Stamped & { readonly title: string }, counter: number | undefined) {
  const tx = ctx.db!.begin();
  const current = tx.get("documents", DOC);
  const wins = newer(write, current);
  if (wins) {
    const row: DatabaseRow = { title: write.title, stamp: write.stamp, origin: write.origin };
    if (current) tx.update("documents", DOC, row);
    else tx.insert("documents", DOC, row);
  }
  if (counter !== undefined) {
    if (tx.get("clock", "lamport")) tx.update("clock", "lamport", { counter });
    else tx.insert("clock", "lamport", { counter });
  }
  if (wins || counter !== undefined) yield tx.commit();
  else tx.rollback();
  return { wins, current };
}

function counterOf(ctx: ServiceContext): number {
  const tx = ctx.db!.begin();
  const row = tx.get("clock", "lamport");
  tx.rollback();
  return (row?.counter as number | undefined) ?? 0;
}

/**
 * One regional replica of a document title, in a multi-leader setup: each
 * region accepts edits and publishes them on `TitleChanged`, and each applies
 * the other's edits by last-writer-wins on a timestamp.
 *
 * Without `logical`, the timestamp is the region's wall clock: virtual time
 * plus its configured `skew`. With `logical`, it is a Lamport clock: a local
 * edit takes one more than the largest stamp the region has seen, and applying
 * a remote edit advances the counter past its stamp, so an edit made after
 * seeing another always gets the larger stamp.
 */
export const titleReplicaModel: ScenarioModel = {
  ...titleReplicaDescriptor, checks: {},
  instantiate(instance): ServiceDefinition {
    const config = record(instance.configuration);
    const logical = config.logical === true;
    const skew = (config.skew as number | undefined) ?? 0;
    return { id: instance.id, version: instance.version, background: {}, endpoints: {
      "PUT /title": function* (body, ctx) {
        const title = text(record(body).title);
        const stamp = logical ? counterOf(ctx) + 1 : Number(ctx.clock.now()) + skew;
        const write = { title, stamp, origin: instance.id };
        const { wins, current } = yield* store(ctx, write, logical ? stamp : undefined);
        if (wins) ctx.log.write("info", "title.written", write);
        else ctx.log.write("warn", "title.discarded", { ...write, keptTitle: current!.title!, keptStamp: current!.stamp! });
        yield ctx.events.publish("TitleChanged", { type: "TitleChanged", body: write });
        // The editor's write is acknowledged either way: last-writer-wins drops it silently.
        return ok({ status: "SAVED", title, stamp });
      },
      "GET /title": (_body, ctx) => {
        const tx = ctx.db!.begin();
        const row = tx.get("documents", DOC);
        tx.rollback();
        ctx.log.write("info", "title.read", { replica: instance.id, title: row?.title ?? null, stamp: row?.stamp ?? null });
        return ok({ title: row?.title ?? null, stamp: row?.stamp ?? null });
      },
    }, consumers: {
      TitleChanged: function* (delivery, ctx) {
        const write = record(delivery.message.body);
        if (write.origin === instance.id) return;
        const remote = { title: text(write.title), stamp: write.stamp as number, origin: text(write.origin) };
        const counter = logical ? Math.max(counterOf(ctx), remote.stamp) : undefined;
        const { wins, current } = yield* store(ctx, remote, counter);
        if (wins) ctx.log.write("info", "title.replicated", { replica: instance.id, ...remote });
        else ctx.log.write("warn", "title.discarded", { replica: instance.id, ...remote, keptTitle: current!.title!, keptStamp: current!.stamp! });
      },
    } };
  },
};
