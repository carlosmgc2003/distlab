import type { CanonicalValue, ExpectedValue, NetworkReply, ServiceDefinition } from "@distlab/contracts";
import { duration } from "@distlab/contracts/kernel";
import type { ScenarioModel } from "@distlab/scenario";
import { peer } from "../peer.js";
import { kvServerDescriptor, leaseStorageDescriptor, leaseWorkerDescriptor } from "./descriptors.js";
import { ok, record, text, timeout } from "./common.js";

const invalid = (): NetworkReply => ({ status: "error", body: { code: "INVALID_KV_OPERATION" } });
const positive = (value: CanonicalValue | undefined): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/**
 * A key-value node that several services reach over the network, as they would
 * a shared cache or coordination store. It holds no logic of its own: each
 * endpoint is one `KeyValueStore` operation on the node's store, so what a
 * caller builds from them (a lock, a counter, a deduplication marker) is the
 * caller's protocol, and every call can be delayed, lost, or time out.
 */
export const kvServerModel: ScenarioModel = {
  ...kvServerDescriptor, checks: {},
  instantiate: instance => ({ id: instance.id, version: instance.version, background: {}, consumers: {}, endpoints: {
    "POST /get": (body, ctx) => {
      const { key } = record(body);
      if (typeof key !== "string" || !key) return invalid();
      const value = ctx.kv!.get(key);
      return ok({ present: value !== undefined, value: value ?? null });
    },
    "POST /set": (body, ctx) => {
      const { key, value, ttl, ifAbsent } = record(body);
      if (typeof key !== "string" || !key || value === undefined || (ttl !== undefined && !positive(ttl))) return invalid();
      return ok({ ok: ctx.kv!.set(key, value, { ...(ttl === undefined ? {} : { ttl: duration(ttl) }), ifAbsent: ifAbsent === true }) });
    },
    "POST /delete": (body, ctx) => {
      const { key } = record(body);
      if (typeof key !== "string" || !key) return invalid();
      return ok({ deleted: ctx.kv!.delete(key) });
    },
    "POST /increment": (body, ctx) => {
      const { key } = record(body);
      if (typeof key !== "string" || !key) return invalid();
      const current = ctx.kv!.get(key);
      if (current !== undefined && !(typeof current === "number" && Number.isSafeInteger(current) && current < Number.MAX_SAFE_INTEGER)) return invalid();
      return ok({ value: ctx.kv!.increment(key) });
    },
    "POST /compare-and-set": (body, ctx) => {
      const { key, expected, next, ttl } = record(body);
      const tagged = expected && typeof expected === "object" && !Array.isArray(expected) ? record(expected) : undefined;
      if (typeof key !== "string" || !key || next === undefined || (ttl !== undefined && !positive(ttl))
        || !tagged || typeof tagged.present !== "boolean" || (tagged.present && tagged.value === undefined)) return invalid();
      const condition: ExpectedValue = tagged.present ? { present: true, value: tagged.value! } : { present: false };
      return ok({ ok: ctx.kv!.compareAndSet(key, condition, next, ttl === undefined ? {} : { ttl: duration(ttl) }) });
    },
  } } satisfies ServiceDefinition),
};

/** The lease key and its fencing counter in the shared key-value node. */
const LOCK = "lock:report", TOKEN = "lock:report:token";

/**
 * A report worker builds a lease from two key-value operations, as a client of
 * a shared store does:
 *
 * 1. `set(lock, me, { ifAbsent, ttl })` takes the lease if nobody holds it.
 *    The entry expires by itself; nobody has to release it.
 * 2. `increment(token)` draws a fencing token larger than every earlier one.
 * 3. It checks the lease against its own clock, counting the lease from
 *    before it sent step 1, so its estimate never outlives the real entry.
 * 4. It writes the report to storage with the token.
 *
 * The check in step 3 is correct when it runs; nothing stops the write in
 * step 4 from arriving after the lease has expired. A worker that passes the
 * check drew its token while its lease was live, so tokens follow lease order.
 */
export const leaseWorkerModel: ScenarioModel = {
  ...leaseWorkerDescriptor, checks: {},
  instantiate(instance): ServiceDefinition {
    const kv = peer(leaseWorkerDescriptor, instance, "kv");
    const storage = peer(leaseWorkerDescriptor, instance, "storage");
    const configured = record(instance.configuration).ttl;
    const ttl = positive(configured) ? configured : 10;
    return { id: instance.id, version: instance.version, background: {}, consumers: {}, endpoints: {
      "POST /job": function* (body, ctx) {
        const input = record(body);
        const asked = Number(ctx.clock.now());
        let taken: NetworkReply, drawn: NetworkReply;
        try {
          taken = (yield ctx.http.request({ target: kv, endpoint: "POST /set", body: { key: LOCK, value: instance.id, ttl, ifAbsent: true } })) as unknown as NetworkReply;
          if (taken.status !== "ok" || record(taken.body).ok !== true) {
            ctx.log.write("info", "lease.busy", { holder: instance.id });
            return ok({ status: "LOCK_BUSY" });
          }
          drawn = (yield ctx.http.request({ target: kv, endpoint: "POST /increment", body: { key: TOKEN } })) as unknown as NetworkReply;
        } catch (error) {
          if (!timeout(error)) throw error;
          // The store may or may not have applied the call. The worker does not know, so it does not write.
          ctx.log.write("warn", "lease.unknown", { holder: instance.id });
          return ok({ status: "LOCK_UNAVAILABLE" });
        }
        if (drawn.status !== "ok") return ok({ status: "LOCK_UNAVAILABLE" });
        const token = record(drawn.body).value as number;
        const now = Number(ctx.clock.now()), validUntil = asked + ttl;
        ctx.log.write("info", "lease.checked", { holder: instance.id, token, validUntil, now, valid: now < validUntil });
        if (now >= validUntil) return ok({ status: "LEASE_EXPIRED", token });
        const reply = (yield ctx.http.request({ target: storage, endpoint: "PUT /file", body: {
          path: text(input.path), content: text(input.content), writer: instance.id, token,
        } })) as unknown as NetworkReply;
        return ok({ ...record(reply.body), token });
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
