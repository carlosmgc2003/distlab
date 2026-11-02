import type { DatabaseRow, NetworkReply, ServiceContext, ServiceDefinition } from "@distlab/contracts";
import { duration, ErrorCodes } from "@distlab/contracts/kernel";
import type { ScenarioModel } from "@distlab/scenario";
import { inventoryDescriptor } from "./descriptors.js";
import { ok, record, text } from "./common.js";

/** Virtual milliseconds Inventory spends validating a reservation between reading stock and writing it. */
const VALIDATION = 5;
/** An optimistic reservation that lost a conflict re-reads stock once; a second conflict is an error. */
const ATTEMPTS = 2;

function conflict(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === ErrorCodes.TRANSACTION_CONFLICT;
}

const outOfStock = (reservationId: string, sku: string, ctx: ServiceContext, stock: DatabaseRow | undefined): NetworkReply => {
  ctx.log.write("warn", "reservation.out-of-stock", { reservationId, sku, stock: stock?.stock ?? null, version: stock?.version ?? null });
  return ok({ reservationId, sku, status: "OUT_OF_STOCK" });
};

/**
 * Inventory reserves one unit of a SKU: it reads the stock row, validates the
 * request for a few milliseconds, then decrements the stock, bumps the row's
 * version, and inserts an ACTIVE reservation in one commit.
 *
 * Without `optimistic`, the check reads a snapshot that it closes before
 * validating, and the write starts a fresh transaction that decrements whatever
 * stock it finds (check-then-act). Two reservations that both pass the check
 * both commit, so the stock goes negative.
 *
 * With `optimistic`, the check and the write share one transaction. The
 * database rejects its commit with `TRANSACTION_CONFLICT` when another commit
 * changed the version it read (ADR-002); Inventory then re-reads the stock and
 * answers OUT_OF_STOCK when the unit is gone.
 */
export const inventoryModel: ScenarioModel = {
  ...inventoryDescriptor, checks: {},
  instantiate(instance): ServiceDefinition {
    const optimistic = record(instance.configuration).optimistic === true;
    return { id: instance.id, version: instance.version, background: {}, consumers: {}, endpoints: {
      "POST /reserve": function* (body, ctx) {
        const input = record(body);
        const reservationId = text(input.reservationId), sku = text(input.sku), client = text(input.client);
        for (let attempt = 1; ; attempt++) {
          let tx = ctx.db!.begin();
          const seen = tx.get("stock", sku);
          if (!seen || (seen.stock as number) < 1) {
            tx.rollback();
            return outOfStock(reservationId, sku, ctx, seen);
          }
          ctx.log.write("info", "stock.checked", { reservationId, sku, stock: seen.stock!, version: seen.version!, attempt });
          if (!optimistic) tx.rollback();
          yield ctx.clock.sleep(duration(VALIDATION));
          if (!optimistic) tx = ctx.db!.begin();
          // The unsafe write decrements the stock it finds now, not the stock it checked.
          const current = optimistic ? seen : tx.get("stock", sku)!;
          const stock = { ...current, stock: (current.stock as number) - 1, version: (current.version as number) + 1 };
          tx.update("stock", sku, stock);
          tx.insert("reservations", reservationId, { sku, client, status: "ACTIVE", reservedAt: Number(ctx.clock.now()) });
          try {
            yield tx.commit();
          } catch (error) {
            if (!optimistic || !conflict(error) || attempt >= ATTEMPTS) throw error;
            ctx.log.write("warn", "reservation.conflict", { reservationId, sku, readVersion: seen.version!, attempt });
            continue;
          }
          ctx.log.write("info", "reservation.committed", { reservationId, sku, stock: stock.stock, version: stock.version });
          return ok({ reservationId, sku, status: "RESERVED", stock: stock.stock });
        }
      },
    } };
  },
};
