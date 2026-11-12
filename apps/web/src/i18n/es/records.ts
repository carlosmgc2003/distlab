import type { records as source } from "../en/records.ts";
import type { Fmt } from "../format.ts";

type Move = { source: string; target?: string; time: number };

/** Spanish messages for the `records` area. Typed by the English source, so keys and parameters must match. */
export const records: typeof source = {
  attemptSuffix: (attempt: number | string, _f: Fmt) => ` (intento ${attempt})`,
  qualifier: {
    detail: (text: string, _f: Fmt) => `: ${text}`,
    code: (text: string, _f: Fmt) => ` (${text})`,
    checkId: (id: string, _f: Fmt) => `: ${id}`,
    checkPassed: (id: string, _f: Fmt) => `: ${id} superada`,
    checkNotPassed: (id: string, _f: Fmt) => `: ${id} no superada`,
    verdictPassed: ": superada",
    verdictNotPassed: ": no superada",
  },
  noStoredFields: "Sin campos registrados.",
  none: "Ninguno.",
  movement: {
    "network.request.sent": (p: Move) => p.target !== undefined
      ? `Solicitud enviada de ${p.source} a ${p.target} en el tiempo virtual ${p.time}.`
      : `Solicitud enviada en ${p.source} en el tiempo virtual ${p.time}.`,
    "network.request.delivered": (p: Move) => p.target !== undefined
      ? `Solicitud entregada de ${p.source} a ${p.target} en el tiempo virtual ${p.time}.`
      : `Solicitud entregada en ${p.source} en el tiempo virtual ${p.time}.`,
    "network.request.dropped": (p: Move) => p.target !== undefined
      ? `Solicitud descartada de ${p.source} a ${p.target} en el tiempo virtual ${p.time}.`
      : `Solicitud descartada en ${p.source} en el tiempo virtual ${p.time}.`,
    "network.request.timedout": (p: Move) => p.target !== undefined
      ? `Solicitud con timeout de ${p.source} a ${p.target} en el tiempo virtual ${p.time}.`
      : `Solicitud con timeout en ${p.source} en el tiempo virtual ${p.time}.`,
    "network.response.sent": (p: Move) => p.target !== undefined
      ? `Respuesta enviada de ${p.source} a ${p.target} en el tiempo virtual ${p.time}.`
      : `Respuesta enviada en ${p.source} en el tiempo virtual ${p.time}.`,
    "network.response.dropped": (p: Move) => p.target !== undefined
      ? `Respuesta descartada de ${p.source} a ${p.target} en el tiempo virtual ${p.time}.`
      : `Respuesta descartada en ${p.source} en el tiempo virtual ${p.time}.`,
    "network.response.received": (p: Move) => p.target !== undefined
      ? `Respuesta recibida de ${p.source} a ${p.target} en el tiempo virtual ${p.time}.`
      : `Respuesta recibida en ${p.source} en el tiempo virtual ${p.time}.`,
    "message.published": (p: Move) => p.target !== undefined
      ? `Mensaje publicado de ${p.source} a ${p.target} en el tiempo virtual ${p.time}.`
      : `Mensaje publicado en ${p.source} en el tiempo virtual ${p.time}.`,
    "message.delivered": (p: Move) => p.target !== undefined
      ? `Mensaje entregado de ${p.source} a ${p.target} en el tiempo virtual ${p.time}.`
      : `Mensaje entregado en ${p.source} en el tiempo virtual ${p.time}.`,
    "message.acknowledged": (p: Move) => p.target !== undefined
      ? `Mensaje confirmado por ${p.source} en ${p.target} en el tiempo virtual ${p.time}.`
      : `Mensaje confirmado en ${p.source} en el tiempo virtual ${p.time}.`,
  },
  movementUnknown: (p: Move & { type: string }, _f: Fmt) => p.target !== undefined
    ? `Movimiento ${p.type} de ${p.source} a ${p.target} en el tiempo virtual ${p.time}.`
    : `Movimiento ${p.type} en ${p.source} en el tiempo virtual ${p.time}.`,
};
