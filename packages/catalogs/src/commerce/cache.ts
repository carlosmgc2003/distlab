import type { CanonicalValue, ComponentId, NetworkReply, ServiceContext, ServiceDefinition } from "@distlab/contracts";
import { duration } from "@distlab/contracts/kernel";
import type { ScenarioModel } from "@distlab/scenario";
import { peer } from "../peer.js";
import { cacheCartDescriptor, cacheCatalogDescriptor, cacheOrdersDescriptor } from "./descriptors.js";
import { ok, record, save, text, timeout } from "./common.js";

/** Configuration may carry a positive TTL as lesson data; otherwise the default applies. */
function ttl(configuration: CanonicalValue | undefined, fallback: number): number {
  const value = configuration && typeof configuration === "object" && !Array.isArray(configuration)
    ? (configuration as Readonly<Record<string, CanonicalValue>>).ttl : undefined;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/**
 * Catalog owns the price of record in its database and caches reads in its
 * KeyValueStore (cache-aside). Every price change commits the current price and
 * a history row together. With `invalidate`, the change also deletes the cached
 * key after the commit; without it, a cached price lives until its TTL expires.
 */
export const cacheCatalogModel: ScenarioModel = {
  ...cacheCatalogDescriptor, checks: {},
  instantiate(instance): ServiceDefinition {
    const invalidate = record(instance.configuration).invalidate === true;
    const lifetime = ttl(instance.configuration, 100);
    return { id: instance.id, version: instance.version, background: {}, consumers: {}, endpoints: {
      "GET /price": (body, ctx) => {
        const sku = text(record(body).sku);
        const cached = ctx.kv!.get(`price:${sku}`);
        if (cached !== undefined) {
          ctx.log.write("info", "price.cache-hit", { sku, ...record(cached) });
          return ok({ ...record(cached), source: "cache" });
        }
        const tx = ctx.db!.begin();
        const row = tx.get("prices", sku);
        tx.rollback();
        if (!row) return ok({ sku, status: "UNKNOWN_SKU" });
        const price = { sku, price: row.price!, version: row.version! };
        ctx.kv!.set(`price:${sku}`, price, { ttl: duration(lifetime) });
        ctx.log.write("info", "price.cache-miss", { ...price, ttl: lifetime });
        return ok({ ...price, source: "database" });
      },
      "POST /price": function* (body, ctx) {
        const input = record(body);
        const sku = text(input.sku);
        const validFrom = Number(ctx.clock.now());
        const tx = ctx.db!.begin();
        const current = tx.get("prices", sku);
        const version = (typeof current?.version === "number" ? current.version : 0) + 1;
        const row = { sku, price: input.price!, version, validFrom };
        if (current) tx.update("prices", sku, row);
        else tx.insert("prices", sku, row);
        tx.insert("price-history", `${sku}@${version}`, row);
        yield tx.commit();
        ctx.log.write("info", "price.updated", row);
        if (invalidate) {
          const removed = ctx.kv!.delete(`price:${sku}`);
          ctx.log.write("info", "price.cache-invalidated", { sku, removed });
        }
        return ok({ sku, price: row.price, version, status: "UPDATED" });
      },
    } };
  },
};

/** Cart keeps each cart in its KeyValueStore with a TTL; an expired cart is absent. */
export const cacheCartModel: ScenarioModel = {
  ...cacheCartDescriptor, checks: {},
  instantiate(instance): ServiceDefinition {
    const lifetime = ttl(instance.configuration, 30);
    return { id: instance.id, version: instance.version, background: {}, consumers: {}, endpoints: {
      "POST /cart": (body, ctx) => {
        const input = record(body);
        const cartId = text(input.cartId);
        // The cart records its own deadline so a checkout can show which cart it relied on.
        const cart = { cartId, sku: text(input.sku), quantity: input.quantity ?? 1, expiresAt: Number(ctx.clock.now()) + lifetime };
        ctx.kv!.set(`cart:${cartId}`, cart, { ttl: duration(lifetime) });
        ctx.log.write("info", "cart.saved", cart);
        return ok({ ...cart, status: "ACTIVE" });
      },
      "GET /cart": (body, ctx) => {
        const cartId = text(record(body).cartId);
        const cart = ctx.kv!.get(`cart:${cartId}`);
        if (cart === undefined) {
          ctx.log.write("warn", "cart.expired", { cartId });
          return ok({ cartId, status: "EXPIRED" });
        }
        return ok({ ...record(cart), status: "ACTIVE" });
      },
    } };
  },
};

/** A reply body, or `null` when the call timed out or returned an error reply. */
function* call(ctx: ServiceContext, target: ComponentId, endpoint: string, body: CanonicalValue) {
  try {
    const reply = (yield ctx.http.request({ target, endpoint, body })) as unknown as NetworkReply;
    return reply.status === "ok" ? record(reply.body) : null;
  } catch (error) {
    if (!timeout(error)) throw error;
    return null;
  }
}

/**
 * Orders checks the cart, then prices the order with whatever price Catalog
 * returns, and records both: the price and its source, and the deadline of the
 * cart it relied on. It cannot tell a cached price from a current one.
 */
export const cacheOrdersModel: ScenarioModel = {
  ...cacheOrdersDescriptor, checks: {},
  instantiate(instance): ServiceDefinition {
    const cart = peer(cacheOrdersDescriptor, instance, "cart");
    const catalog = peer(cacheOrdersDescriptor, instance, "catalog");
    return { id: instance.id, version: instance.version, background: {}, consumers: {}, endpoints: {
      "POST /checkout": function* (body, ctx) {
        const input = record(body);
        const orderId = text(input.orderId), cartId = text(input.cartId);
        const found = yield* call(ctx, cart, "GET /cart", { cartId });
        if (!found) return ok({ orderId, status: "UNAVAILABLE", reason: "CART_UNAVAILABLE" });
        if (found.status !== "ACTIVE") {
          yield* save(ctx, "orders", orderId, { status: "REJECTED", reason: "CART_EXPIRED", cartId, checkedOutAt: Number(ctx.clock.now()) });
          ctx.log.write("warn", "order.rejected", { orderId, cartId, reason: "CART_EXPIRED" });
          return ok({ orderId, status: "REJECTED", reason: "CART_EXPIRED" });
        }
        const priced = yield* call(ctx, catalog, "GET /price", { sku: found.sku! });
        if (!priced || typeof priced.price !== "number") return ok({ orderId, status: "UNAVAILABLE", reason: "PRICE_UNAVAILABLE" });
        const row = {
          status: "PLACED", cartId, sku: found.sku!, quantity: found.quantity!, price: priced.price, priceVersion: priced.version!,
          priceSource: priced.source!, cartExpiresAt: found.expiresAt!, checkedOutAt: Number(ctx.clock.now()),
        };
        yield* save(ctx, "orders", orderId, row);
        ctx.log.write("info", "order.placed", { orderId, price: row.price, priceSource: row.priceSource, checkedOutAt: row.checkedOutAt });
        return ok({ orderId, status: "PLACED", price: row.price });
      },
    } };
  },
};
