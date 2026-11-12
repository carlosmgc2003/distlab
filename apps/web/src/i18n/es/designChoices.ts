import type { designChoices as source } from "../en/designChoices.ts";
import type { Fmt } from "../format.ts";

/** Spanish messages for the `designChoices` area. Typed by the English source, so keys and parameters must match. */
export const designChoices: typeof source = {
  choices: {
    idempotency: { label: "Clave de idempotencia", hint: "Payments guarda cada resultado por clave de idempotencia y lo devuelve cuando la clave se repite." },
    timeout: { label: "Timeout del cliente", hint: "Tiempo virtual que el cliente espera una respuesta de Payments antes de rendirse o reintentar." },
    compensation: { label: "Compensación", hint: "Orders deshace los pasos completados de la saga cuando falla un paso posterior." },
    outbox: { label: "Outbox transaccional", hint: "Payments registra el evento en la misma confirmación que el pago y lo publica más tarde." },
    "consumer-idempotency": { label: "Consumidor idempotente", hint: "Notifications registra el ID de cada evento en una bandeja de entrada y saltea los que ya vio." },
    "circuit-breaker": { label: "Patrón circuit breaker", hint: "Payments deja de llamar al proveedor de riesgo después de fallas repetidas y lo sondea más tarde." },
    "decoupled-confirmation": { label: "Confirmar antes de notificar", hint: "Orders confirma el pedido en el checkout en lugar de esperar a NotificationSent." },
    "max-attempts": { label: "Intentos de entrega de la notificación", hint: "Cuántas veces el bus entrega OrderPlaced antes de mover el mensaje a la cola de dead letters." },
    "optimistic-concurrency": { label: "Concurrencia optimista", hint: "Inventory verifica el stock y escribe la reserva en una sola transacción, así que la base de datos rechaza una confirmación cuya versión de stock cambió desde que se leyó." },
    fencing: { label: "Tokens de fencing", hint: "Storage recuerda el token de lease más grande que aceptó para un archivo y rechaza una escritura que lleve uno menor." },
    "lease-ttl": { label: "Duración del lease", hint: "El TTL que cada worker le pone a la clave del lease. El almacén clave-valor elimina la clave cuando vence, y otro worker puede entonces tomar el lease." },
    "logical-clock": { label: "Relojes de Lamport", hint: "Las dos regiones marcan las ediciones con un contador de Lamport en lugar de usar sus relojes de pared." },
    "clock-skew": { label: "Desfase de reloj en eu", hint: "Cuánto se adelanta el reloj de pared de la región eu respecto del tiempo virtual (negativo: se atrasa)." },
    "cache-invalidation": { label: "Invalidar la caché al cambiar el precio", hint: "Catalog elimina el precio cacheado cuando el back office lo cambia, en lugar de dejarlo vivir hasta que venza su TTL." },
  },
  lessonChoices: {
    "reliable-checkout@1": {
      retries: { label: "Reintentos de pago", hint: "Cuántas veces Payments repite una autorización que venció por timeout." },
      idempotency: { label: "Clave de idempotencia", hint: "Payments envía el ID del pedido como clave de idempotencia; el procesador responde a una clave repetida con la autorización que ya tiene." },
      compensation: { label: "Compensación", hint: "Orders anula el pago y libera el inventario cuando falla un paso del checkout, y después cancela el pedido." },
      outbox: { label: "Outbox transaccional", hint: "Orders registra OrderConfirmed en la misma confirmación que el pedido confirmado y lo publica desde un relay posterior." },
    },
  },
  on: "activado",
  off: "desactivado",
  separator: " · ",
  errors: {
    notNumber: "Esta decisión no es un número.",
    range: (p: { minimum: number; maximum: number }, f: Fmt) => `Ingresá un número entero de ${f.number(p.minimum)} a ${f.number(p.maximum)}.`,
  },
  diagnostics: {
    UNKNOWN_PARAMETER: "Esta lección no ofrece esta decisión.",
    PARAMETER_VALUE: "Este valor está fuera del rango permitido.",
    DUPLICATE: "Esta decisión aparece dos veces.",
    REQUIRED: "Este valor es obligatorio.",
    TYPE: "Este valor tiene un tipo incorrecto.",
  },
  diagnosticUnknown: "Este valor no es válido.",
  withCode: (p: { text: string; code: string }, _f: Fmt) => `${p.text} (${p.code})`,
  stepNotice: "El paso de diseño todavía no está disponible en el navegador. Podés ejecutar la lección con el slot vacío y ver qué falta.",
  emptySlot: {
    label: "Slot vacío",
    description: "Ningún modelo ocupa este componente todavía. No recibe, publica ni almacena nada, y responde cualquier solicitud con NOT_IMPLEMENTED.",
  },
  section: {
    title: "Decisiones de diseño",
    help: "Los invariantes de negocio informan qué logran tus decisiones. Las verificaciones de configuración siguen describiendo la lección empaquetada, así que una puede decir “no reproducida” con tus decisiones. Eso muestra cómo tu cambio alteró la historia, no un error del simulador.",
    lessonDefault: (value: string, _f: Fmt) => `Valor de la lección: ${value}.`,
  },
};
