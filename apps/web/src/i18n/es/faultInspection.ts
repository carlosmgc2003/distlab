import type { faultInspection as source } from "../en/faultInspection.ts";
import type { Fmt } from "../format.ts";

/** Spanish messages for the `faultInspection` area. Typed by the English source, so keys and parameters must match. */
export const faultInspection: typeof source = {
  none: "ninguno",
  notProjected: "no proyectado",
  status: {
    selected: "seleccionada",
    recorded: "registrada",
    "not-recorded": "no registrada",
  },
  names: {
    customerApp: "App del cliente",
    orders: "Orders",
    payments: "Payments",
    processor: "Procesador de pagos",
  },
  resources: {
    request: "Solicitud y resultado del checkout, propios del modelo",
    ledger: "Registro de autorizaciones del proveedor, propio del modelo",
  },
  evidence: {
    faultSelection: "Mostrar la selección de la falla",
    droppedResponse: "Mostrar la respuesta descartada del procesador",
    processorAuthorization: "Mostrar la autorización del procesador",
    paymentsTimeout: "Mostrar el timeout de Payments",
    busAcknowledgement: "Mostrar la confirmación (ACK) del bus",
    ordersLifecycle: "Mostrar el ciclo de vida de Orders",
    paymentsLifecycle: "Mostrar el ciclo de vida de Payments",
  },
  stagedNote: "No se incluye ninguna transacción en preparación. Las filas de abajo están confirmadas.",
  knowledge: {
    sentences: (parts: readonly string[], _f: Fmt) => parts.join(" "),
    noFacts: "No se proyectó ningún hecho del checkout visible para el estudiante. El estado de los componentes que solo ve el host sigue oculto.",
    timeoutBoundary: "Un timeout de red es una respuesta que no llegó. No prueba que se haya rechazado ni revertido el pago.",
    payment: (p: { id: string; state: string; outcome: string; authorization: string }, _f: Fmt) =>
      `el pago ${p.id} se confirmó como ${p.state} con resultado ${p.outcome} e ID de autorización local ${p.authorization}`,
    localPayments: (list: string, _f: Fmt) => `${list}.`,
    noPayments: "Todavía no hay ninguna fila de pago confirmada.",
    authorization: (p: { id: string; status: string }, _f: Fmt) => `${p.id} ${p.status}`,
    ledger: (p: { processor: string; list: string }, _f: Fmt) => `El registro visible de ${p.processor} muestra ${p.list}.`,
    emptyLedger: (processor: string, _f: Fmt) => `El registro visible de ${processor} no muestra ninguna autorización.`,
    timeoutDiffers: "El timeout de Payments y el registro del procesador son hechos distintos.",
    agreed: "El ID de autorización local coincide con una autorización visible del procesador.",
    separate: "El estado local del pago y el registro del procesador se muestran como hechos separados.",
  },
};
