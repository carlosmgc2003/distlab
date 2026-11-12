import type { content as source } from "../en/content.ts";

/**
 * Spanish translations of the text lesson authors write in `packages/catalogs`, keyed by stable id
 * (ADR-007 section 5). Identifiers inside a label (`NETWORK_TIMEOUT`, `UNKNOWN`, `Draft`, `t=120`, counts)
 * stay literal. `tests/content-translations.test.ts` fails on a missing id or a stale key.
 */
export const content: typeof source = {
  checks: {
    "one-payment-per-order": "Una solicitud de pago reintentada cobra el pedido una sola vez",
    "inconsistent-order": "El envío falló después de crear el pedido, así que hace falta compensar (t=30)",
    "inventory-still-reserved": "El inventario seguía reservado cuando falló el envío (t=30)",
    "payment-still-approved": "El pago seguía aprobado cuando falló el envío (t=30)",
    "failed-order-cancelled": "Un pedido fallido se cancela",
    "failed-order-releases-inventory": "Un pedido fallido no deja inventario reservado",
    "failed-order-refunded": "Un pedido fallido no deja ningún pago aprobado",
    "committed-before-crash": "El pago se confirmó antes de que Payments se cayera (t=6)",
    "nothing-published-yet": "Todavía no existía ninguna notificación cuando Payments se cayó (t=6)",
    "dual-write/durable-outbox": "Ninguna fila del outbox registró el evento (t=6)",
    "durable-outbox": "El outbox registró el evento sin enviar junto con el pago (t=6)",
    "payment-survives-restart": "Un pago aprobado sobrevive a una caída y un reinicio",
    "one-notification-per-payment": "Un pago aprobado produce exactamente una notificación",
    "payment-event-published": "El evento de un pago aprobado se registra y se publica",
    "write-paid": "Orders registró el pago (t=10)",
    "read-stale": "Reporting todavía mostraba PENDING mientras la actualización estaba demorada (t=10)",
    "write-remains-paid": "El modelo de escritura conserva el pago",
    "read-converged": "El modelo de lectura converge al modelo de escritura",
    "dependency-recovered": "La dependencia de Payments se recuperó: 16 llamadas a risk, 13 fallas, 3 éxitos (t=120)",
    "cascade-breaker/dependency-recovered": "La dependencia de Payments se recuperó: 5 llamadas a risk, 3 fallas, 2 éxitos, 11 rechazos (t=120)",
    "bounded-waiting": "Nunca hay más de 3 solicitudes de pago esperando a la vez al proveedor de riesgo lento",
    "upstream-drained": "Las 16 verificaciones llegaron a la API y se vaciaron (t=120)",
    "nothing-sent-during-outage": "Ninguna notificación llegó al Messaging Provider inalcanzable (t=60)",
    "order-confirmed-despite-notification-failure": "Un pedido se confirma mientras su notificación está fallando",
    "failed-notification-dead-lettered": "Una notificación que usó los 3 intentos queda en la dead-letter queue",
    "bounded-notification-retries": "Ninguna notificación se intenta más de 3 veces",
    "price-raised": "El back office subió el precio de sku-1 de 1000 a 1200 (t=15)",
    "expired-cart-rejected": "El carrito cart-2 venció en t=31, así que su checkout en t=40 fue rechazado (t=60)",
    "order-priced-at-checkout": "Un pedido se cobra con el precio de catálogo vigente en el checkout",
    "no-expired-cart-checkout": "Un carrito vencido no puede pasar por el checkout",
    "last-unit-contended": "sku-1 todavía tenía su última unidad mientras se validaban las dos reservas (t=3)",
    "stock-never-negative": "El stock nunca es negativo",
    "one-reservation-per-unit": "Una unidad tiene a lo sumo una reserva activa",
    "lease-passed-on": "La entrada de lease de worker-1 venció, así que worker-2 tiene el lease y obtuvo el token 2 (t=20)",
    "writes-in-token-order": "Storage nunca acepta una escritura con un token de lease menor después de uno mayor",
    "file-from-latest-lease": "El archivo del reporte contiene la escritura con el mayor token de lease que storage aceptó",
    "first-edit-replicated": "La región us mostraba Draft antes de que su editor cambiara el título (t=11)",
    "replicas-converge": "Ambas regiones terminan con el mismo título",
    "later-edit-kept": "Una edición hecha después de leer el título no se pierde: ambas regiones conservan Final",
  },
  checkoutTitles: {
    normal: "Checkout con respuesta del procesador",
    "response-lost": "Checkout con respuesta del procesador perdida",
  },
  checkoutExplanations: {
    normal: "Orders crea el pedido y publica OrderCreated. Payments recibe la aprobación y registra AUTHORIZED.",
    "response-lost": "El procesador confirma una autorización, pero su respuesta se descarta. Payments observa NETWORK_TIMEOUT y registra UNKNOWN sin un ID de autorización.",
  },
  assessmentTitles: {
    "reliable-checkout-assessment@1": "Checkout confiable",
  },
  assessmentRequirements: {
    "Services own independent state.": "Los servicios son dueños de un estado independiente.",
    "A customer must not be charged twice.": "No se le debe cobrar dos veces a un cliente.",
    "Inventory may temporarily fail.": "Inventory puede fallar temporalmente.",
    "Payment Processor may return an ambiguous timeout.": "El Procesador de pagos puede devolver un timeout ambiguo.",
    "Messaging Provider may be unavailable.": "El Messaging Provider puede no estar disponible.",
    "Distributed transactions are forbidden.": "Las transacciones distribuidas están prohibidas.",
    "The system must eventually reach a valid business state.": "El sistema debe llegar, tarde o temprano, a un estado de negocio válido.",
  },
  assessmentRows: {
    "reliable-checkout-assessment@1/happy-path": "Camino feliz",
    "reliable-checkout-assessment@1/duplicate-order-confirmed": "OrderConfirmed duplicado",
    "reliable-checkout-assessment@1/inventory-unavailable": "Inventario no disponible",
    "reliable-checkout-assessment@1/processor-response-lost": "Respuesta del procesador perdida",
    "reliable-checkout-assessment@1/notification-provider-down": "Proveedor de notificaciones caído",
    "reliable-checkout-assessment@1/crash-after-local-commit": "Caída después del commit local",
  },
  assessmentInvariants: {
    "reliable-checkout-assessment@1/charged-at-most-once": "Al cliente se le cobra a lo sumo una vez",
    "reliable-checkout-assessment@1/failed-order-uncharged": "Un pedido fallido no deja ningún cobro",
    "reliable-checkout-assessment@1/notified-exactly-once": "Un pedido confirmado se notifica exactamente una vez",
    "reliable-checkout-assessment@1/order-final": "Todo pedido llega a un estado final",
  },
};
