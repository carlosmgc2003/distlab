import type { NetworkReply, ServiceDefinition } from "@distlab/contracts";
import type { ScenarioModel } from "@distlab/scenario";
import { peer } from "../peer.js";
import { leaseStorageDescriptor, leaseWorkerDescriptor, lockServiceDescriptor } from "./descriptors.js";
import { ok, record, save, text } from "./common.js";

const LOCK = "report-lock";

/**
 * The lock service grants one time-limited lease at a time. Every grant carries
 * a token one larger than the last, whether or not anyone uses it. A lease that
 * has passed `expiresAt` is free again: the service cannot know whether its old
 * holder is still working, only that its time is up.
 */
export const lockServiceModel: ScenarioModel = {
  ...lockServiceDescriptor, checks: {},
  instantiate(instance): ServiceDefinition {
    const ttl = record(instance.configuration).ttl as number;
    return { id: instance.id, version: instance.version, background: {}, consumers: {}, endpoints: {
      "POST /acquire": function* (body, ctx) {
        const holder = text(record(body).holder);
        const now = Number(ctx.clock.now());
        const tx = ctx.db!.begin();
        const lease = tx.get("leases", LOCK);
        tx.rollback();
        if (lease && (lease.expiresAt as number) > now && lease.holder !== holder) {
          ctx.log.write("info", "lease.busy", { holder, heldBy: lease.holder!, expiresAt: lease.expiresAt! });
          return ok({ status: "BUSY", heldBy: lease.holder!, expiresAt: lease.expiresAt! });
        }
        const token = ((lease?.token as number | undefined) ?? 0) + 1;
        const granted = { holder, token, expiresAt: now + ttl };
        yield* save(ctx, "leases", LOCK, granted);
        ctx.log.write("info", "lease.granted", { ...granted, previousHolder: lease?.holder ?? null });
        return ok({ status: "GRANTED", ...granted });
      },
    } };
  },
};

/**
 * A report worker takes the lease, checks that it has not expired, and writes
 * its report to storage with the lease's token. The check is correct when it
 * runs; nothing stops the write from arriving after the lease has expired.
 */
export const leaseWorkerModel: ScenarioModel = {
  ...leaseWorkerDescriptor, checks: {},
  instantiate(instance): ServiceDefinition {
    const lock = peer(leaseWorkerDescriptor, instance, "lock");
    const storage = peer(leaseWorkerDescriptor, instance, "storage");
    return { id: instance.id, version: instance.version, background: {}, consumers: {}, endpoints: {
      "POST /job": function* (body, ctx) {
        const input = record(body);
        const lease = record(((yield ctx.http.request({ target: lock, endpoint: "POST /acquire", body: { holder: instance.id } })) as unknown as NetworkReply).body);
        if (lease.status !== "GRANTED") return ok({ status: "LOCK_BUSY" });
        const now = Number(ctx.clock.now());
        ctx.log.write("info", "lease.checked", { holder: instance.id, token: lease.token!, expiresAt: lease.expiresAt!, now, valid: now < (lease.expiresAt as number) });
        const reply = (yield ctx.http.request({ target: storage, endpoint: "PUT /file", body: {
          path: text(input.path), content: text(input.content), writer: instance.id, token: lease.token!,
        } })) as unknown as NetworkReply;
        return ok({ ...record(reply.body), token: lease.token! });
      },
    } };
  },
};

/**
 * Storage keeps one row per file and an append-only log of write attempts.
 * With `fencing`, it remembers the largest token it has accepted for a file and
 * rejects a write with a smaller one: a writer whose lease was superseded can
 * no longer change the file, however late its write arrives.
 */
export const leaseStorageModel: ScenarioModel = {
  ...leaseStorageDescriptor, checks: {},
  instantiate(instance): ServiceDefinition {
    const fencing = record(instance.configuration).fencing === true;
    return { id: instance.id, version: instance.version, background: {}, consumers: {}, endpoints: {
      "PUT /file": function* (body, ctx) {
        const input = record(body);
        const path = text(input.path), writer = text(input.writer), token = input.token as number;
        const tx = ctx.db!.begin();
        const current = tx.get("files", path);
        const seq = tx.scan("writes").length + 1;
        const stale = fencing && current !== undefined && token < (current.token as number);
        tx.insert("writes", `write-${seq}`, { seq, path, writer, token, accepted: !stale, at: Number(ctx.clock.now()) });
        if (stale) {
          yield tx.commit();
          ctx.log.write("warn", "storage.fenced", { path, writer, token, highestToken: current!.token! });
          return ok({ status: "REJECTED", reason: "STALE_TOKEN" });
        }
        const file = { content: text(input.content), writer, token };
        if (current) tx.update("files", path, file);
        else tx.insert("files", path, file);
        yield tx.commit();
        ctx.log.write("info", "storage.written", { path, writer, token, overwrote: current?.writer ?? null });
        return ok({ status: "WRITTEN" });
      },
    } };
  },
};
