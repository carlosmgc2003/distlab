import type { CanonicalValue } from "@distlab/contracts";
import type { ScenarioAssessment, ScenarioCatalog } from "@distlab/scenario";
import { clientModel, record, text } from "./common.js";
import { retryModel } from "./retry.js";
import { carrierModel, sagaModel, sagaResourceModel } from "./saga.js";
import { notificationModel, outboxModel } from "./outbox.js";
import { orderReadModel, orderWriteModel } from "./cqrs.js";
import { dependencyModel, riskModel } from "./circuit.js";
import { messagingModel, notifyOrdersModel, notifySenderModel } from "./notify.js";
import { cacheCartModel, cacheCatalogModel, cacheOrdersModel } from "./cache.js";
import { inventoryModel } from "./inventory.js";
import { placeholderExternalModel, placeholderServiceModel } from "./placeholder.js";
import { reliableInventoryModel, reliableNotificationsModel, reliableOrdersModel, reliablePaymentsModel, reliableProcessorModel } from "./reliable.js";
export { commerceCatalogReference, commerceChecks, commerceScenario, commerceLessonNames, commerceOverlayPolicy } from "./scenarios.js";
export { commerceDescriptors } from "./descriptors.js";
export type { CommerceCheck, CommerceLessonName } from "./scenarios.js";
export {
  assessmentDefinitions, reliableCheckoutAssessment, reliableCheckoutChecks, reliableCheckoutName, reliableCheckoutOverlayPolicy,
  reliableCheckoutScenario, reliableCheckoutTimes,
} from "./reliable-checkout.js";

const models = [clientModel, retryModel, carrierModel, sagaModel, sagaResourceModel, notificationModel, outboxModel, orderReadModel, orderWriteModel, dependencyModel, riskModel,
  notifyOrdersModel, notifySenderModel, messagingModel, cacheCatalogModel, cacheCartModel, cacheOrdersModel, inventoryModel,
  reliableOrdersModel, reliableInventoryModel, reliablePaymentsModel, reliableProcessorModel, reliableNotificationsModel,
  placeholderServiceModel, placeholderExternalModel];
export const commerceCatalog: ScenarioCatalog = {
  id: "commerce.lessons", version: "1.0.0",
  find: (name, version) => models.find(model => model.model === name && model.version === version),
  versions: name => models.filter(model => model.model === name).map(model => model.version),
};
/** Routing records of one destination as delivery facts: message, state, and attempt. */
function deliveries(messageBus: CanonicalValue, destination: string) {
  const records = record(messageBus).records;
  return (Array.isArray(records) ? records : []).map(item => record(item)).filter(item => item.destination === destination)
    .map(item => ({ messageId: text(item.messageId), state: text(item.state), attempt: item.attempt as number }));
}

/** Committed rows of one table, or none when the owner or table is absent. */
function tableRows(databases: CanonicalValue, owner: string, table: string): Record<string, CanonicalValue> {
  const db = record(databases)[owner];
  const tables = db && typeof db === "object" && !Array.isArray(db) ? record(db).tables : undefined;
  const found = tables && typeof tables === "object" && !Array.isArray(tables) ? record(tables)[table] : undefined;
  return found && typeof found === "object" && !Array.isArray(found) ? record(found) : {};
}
/** The declared visible state of an external component, or an empty one before its first operation. */
function visible(components: CanonicalValue, id: string): Record<string, CanonicalValue> {
  const boundary = record(components)[id];
  const state = boundary && typeof boundary === "object" && !Array.isArray(boundary) ? record(boundary).visible : undefined;
  return state && typeof state === "object" && !Array.isArray(state) ? record(state) : {};
}
const list = (value: CanonicalValue | undefined): readonly Record<string, CanonicalValue>[] => Array.isArray(value) ? value.map(item => record(item)) : [];
/** Approved, unvoided authorizations the processor holds. */
const approved = (components: CanonicalValue, processor: string) =>
  list(visible(components, processor).authorizations).filter(entry => entry.status === "APPROVED");
const countBy = (values: readonly string[]) => values.reduce<Record<string, number>>((counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }), {});
const placed = (orders: Record<string, CanonicalValue>) =>
  Object.entries(orders).map(([key, row]) => [key, record(row)] as const).filter(([, row]) => row.status === "PLACED");

export const commerceAssessment: ScenarioAssessment = {
  version: "1.0.0",
  find: id => !["commerce.rows", "commerce.metrics", "commerce.attempts", "commerce.dead-letters", "commerce.pricing", "commerce.live-carts",
    "commerce.stock", "commerce.reservations", "commerce.charges", "commerce.unconfirmed-charges", "commerce.notifications", "commerce.final-orders"].includes(id) ? undefined : {
    id, version: "1.0.0", evaluate({ parameters, projection }) {
      const p = record(parameters);
      if (id === "commerce.charges") {
        // No order holds more than `maximum` approved, unvoided authorizations at the processor.
        const evidence = countBy(approved(projection.components, text(p.processor)).map(entry => text(entry.orderId)));
        return { pass: Object.values(evidence).every(count => count <= (p.maximum as number)), evidence };
      }
      if (id === "commerce.unconfirmed-charges") {
        // Every approved, unvoided authorization belongs to a CONFIRMED order.
        const orders = tableRows(projection.databases, text(p.owner), text(p.table));
        const evidence = approved(projection.components, text(p.processor)).map(entry => ({
          authorizationId: entry.authorizationId!, orderId: entry.orderId!, order: record(orders[text(entry.orderId)] ?? {}).status ?? null,
        }));
        return { pass: evidence.every(item => item.order === "CONFIRMED"), evidence };
      }
      if (id === "commerce.notifications") {
        // No order is notified twice, and every CONFIRMED order is notified once.
        const sent = countBy(list(visible(projection.components, text(p.provider)).sent).map(entry => text(entry.orderId)));
        const orders = tableRows(projection.databases, text(p.owner), text(p.table));
        const ids = [...new Set([...Object.keys(orders), ...Object.keys(sent)])].sort();
        const evidence = ids.map(orderId => ({ orderId, status: record(orders[orderId] ?? {}).status ?? null, sent: sent[orderId] ?? 0 }));
        return { pass: evidence.every(item => item.sent <= 1 && (item.status !== "CONFIRMED" || item.sent === 1)), evidence };
      }
      if (id === "commerce.final-orders") {
        // Every order is in one of the final states.
        const states = (p.states as readonly CanonicalValue[]).map(text);
        const evidence = Object.entries(tableRows(projection.databases, text(p.owner), text(p.table)))
          .map(([orderId, row]) => ({ orderId, status: record(row).status ?? null }));
        return { pass: evidence.every(item => typeof item.status === "string" && states.includes(item.status)), evidence };
      }
      if (id === "commerce.pricing") {
        // Each placed order's price equals the catalog price valid when the order was placed:
        // the history row of its SKU with the latest `validFrom` at or before `checkedOutAt`.
        const history = Object.values(tableRows(projection.databases, text(p.catalog), text(p.history))).map(row => record(row));
        const evidence = placed(tableRows(projection.databases, text(p.owner), text(p.table))).map(([orderId, order]) => {
          const valid = history.filter(row => row.sku === order.sku && (row.validFrom as number) <= (order.checkedOutAt as number))
            .reduce<Record<string, CanonicalValue> | undefined>((best, row) => !best || (row.validFrom as number) > (best.validFrom as number) ? row : best, undefined);
          return { orderId, sku: order.sku!, checkedOutAt: order.checkedOutAt!, charged: order.price!, valid: valid?.price ?? null };
        });
        return { pass: evidence.every(item => item.charged === item.valid), evidence };
      }
      if (id === "commerce.stock") {
        // No SKU's available stock is negative: an oversold unit is a negative count.
        const evidence = Object.entries(tableRows(projection.databases, text(p.owner), text(p.table)))
          .map(([sku, row]) => ({ sku, stock: record(row).stock ?? null, version: record(row).version ?? null }));
        return { pass: evidence.every(item => typeof item.stock === "number" && item.stock >= 0), evidence };
      }
      if (id === "commerce.reservations") {
        // A SKU never has more ACTIVE reservations than physical units on hand.
        const reservations = Object.entries(tableRows(projection.databases, text(p.owner), text(p.reservations)))
          .map(([reservationId, row]) => [reservationId, record(row)] as const).filter(([, row]) => row.status === "ACTIVE");
        const evidence = Object.entries(tableRows(projection.databases, text(p.owner), text(p.stock))).map(([sku, row]) => ({
          sku, units: record(row).units ?? null,
          active: reservations.filter(([, reservation]) => reservation.sku === sku).map(([reservationId]) => reservationId),
        }));
        return { pass: evidence.every(item => typeof item.units === "number" && item.active.length <= item.units), evidence };
      }
      if (id === "commerce.live-carts") {
        // Every placed order committed before the cart it relied on expired.
        const evidence = placed(tableRows(projection.databases, text(p.owner), text(p.table))).map(([orderId, order]) =>
          ({ orderId, cartId: order.cartId!, checkedOutAt: order.checkedOutAt!, cartExpiresAt: order.cartExpiresAt! }));
        return { pass: evidence.every(item => (item.checkedOutAt as number) < (item.cartExpiresAt as number)), evidence };
      }
      if (id === "commerce.attempts") {
        // No message of the destination was delivered more often than the retry budget allows.
        const records = deliveries(projection.messageBus, text(p.destination));
        return { pass: records.every(item => item.attempt <= (p.maximum as number)), evidence: records };
      }
      if (id === "commerce.dead-letters") {
        // A message that used its whole retry budget without an ACK is held in the dead-letter queue.
        const records = deliveries(projection.messageBus, text(p.destination));
        const exhausted = records.filter(item => item.attempt >= (p.attempts as number) && item.state !== "ACKED");
        const dead = record(projection.messageBus).deadLetters;
        const held = new Set((Array.isArray(dead) ? dead : []).map(item => text(record(item).messageId)));
        return { pass: exhausted.every(item => item.state === "DEAD" && held.has(item.messageId)), evidence: { exhausted, deadLetters: [...held] } };
      }
      if (id === "commerce.metrics") {
        const entries = record(projection.stores)[text(p.owner)];
        const entry = Array.isArray(entries) ? entries.find(item => record(item).key === "dependency") : undefined;
        const actual = entry ? record(record(entry).value!) : {};
        // `expected` compares by equality. `maximum` is an upper bound that holds at every
        // boundary: before the first dependency call no metrics exist, so nothing has exceeded it.
        const equal = Object.entries(record(p.expected ?? {})).every(([key, value]) => actual[key] === value);
        const bounded = !entry || Object.entries(record(p.maximum ?? {})).every(([key, value]) => typeof actual[key] === "number" && actual[key] <= (value as number));
        return { pass: equal && bounded, evidence: actual };
      }
      // An owner without the database (an unfilled design slot) has no rows.
      const rows = tableRows(projection.databases, text(p.owner), text(p.table));
      // `maximum` is an upper bound on the row count that holds at every boundary, including
      // before the first commit; `count` is the exact count at one moment.
      if (typeof p.maximum === "number") return { pass: Object.keys(rows).length <= p.maximum, evidence: rows };
      const expected = record(p.expected!);
      const row = rows[text(p.key)] ?? {};
      const pass = Object.keys(rows).length === p.count && Object.entries(expected).every(([key, value]) => record(row)[key] === value);
      return { pass, evidence: rows };
    },
  },
};
