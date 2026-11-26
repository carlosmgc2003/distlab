import type { playback as source } from "../en/playback.ts";
import type { Fmt } from "../format.ts";

type Transit = { from: string; to?: string; departure?: { time: number; sequence: number } };

/** Spanish messages for the `playback` area. Typed by the English source, so keys and parameters must match. */
export const playback: typeof source = {
  pace: {
    label: { slow: "Lenta", steady: "Constante", fast: "Rápida" },
    note: (p: { seconds: number }, f: Fmt) => `un hito cada ${f.number(p.seconds)} segundos`,
  },
  pattern: {
    "network.request.sent": "Quien llama espera una respuesta. ¿Qué registró hasta ahora el receptor?",
    "network.request.delivered": "La solicitud llegó. ¿Qué trabajo empezó el receptor, y en qué orden?",
    "network.request.dropped": "La solicitud nunca llegó. ¿Qué componente puede darse cuenta de eso, y cuál no?",
    "network.request.timedout": "Venció el plazo de quien llama. ¿Qué sabe ahora quien llama sobre el resultado?",
    "network.response.sent": "Quien responde produjo una respuesta. Compará con el efecto registrado justo antes.",
    "network.response.received": "Quien llama tiene una respuesta. ¿Coincide con el estado que todavía conserva quien respondió?",
    "network.response.dropped": "La respuesta se descartó. ¿Qué hará quien llama a continuación, y qué seguirá creyendo quien la envió?",
    "message.published": "Quien publica ya no espera a un consumidor. ¿Qué guarda ahora el MessageBus?",
    "message.delivered": "Un consumidor recibió una copia del mensaje. ¿Fue este el primer intento de entrega?",
    "message.acknowledged": "Se confirmó la entrega. ¿Qué haría un consumidor si la confirmación nunca llegara?",
    "message.ack.stale": "Esta confirmación no coincide con el estado de entrega registrado. ¿A qué intento pertenece?",
    "message.retry.scheduled": "Se entregará de nuevo el mismo mensaje. ¿Es seguro repetir el trabajo del consumidor?",
    "message.nacked": "El consumidor rechazó la entrega. ¿Cuándo la volverá a entregar el MessageBus, si es que lo hace?",
    "message.dead": "El MessageBus dejó de entregar este mensaje. ¿Quién lo va a revisar ahora?",
    "database.transaction.committed": "Este cambio ya es durable. ¿Se confirmó el mismo cambio antes en esta ejecución?",
    "database.transaction.rolledback": "La transacción se revirtió. ¿Qué deshizo, y qué efectos fuera de la base de datos siguen en pie?",
    "database.transaction.rejected": "La base de datos rechazó esta transacción. ¿Qué condición registrada no cumplió, y quién se entera?",
    "external.effect.committed": "Este efecto es visible fuera del sistema y no se puede revertir. ¿Ocurrió antes el mismo efecto?",
    "service.handler.failed": "Falló el handler. ¿Qué había cambiado antes de fallar, y qué lo volverá a intentar?",
    "kv.changed": "Cambió una clave. ¿Qué lectores todavía tienen el valor anterior?",
    "kv.expired": "Venció una clave. ¿Qué hará el próximo lector de esta clave?",
    "kv.read": "Se leyó una clave. ¿El valor que devolvió sigue siendo el actual?",
    "kv.condition.failed": "La escritura condicional no se hizo. ¿Qué valor había en su lugar, y quién lo escribió?",
    "fault.rule.matched": "Una regla de falla coincidió con esta operación. ¿Qué componente notará la falla, y cómo?",
    "fault.effect.selected": "La falla eligió su efecto. ¿Qué registrará a continuación cada lado de la operación?",
    "fault.applied": "La falla actuó. ¿Qué registros posteriores serían distintos sin ella?",
    "runtime.log": "El servicio anotó lo que cree. ¿Coincide con los registros que lo rodean?",
    "scenario.assertion.evaluated": "Se evaluó una verificación de la lección. ¿Qué registros deciden su resultado?",
  },
  patternFallback: "¿Qué afirma este registro y qué deja sin saber?",
  fieldLabel: {
    endpoint: "Endpoint",
    operation: "Operación registrada",
    deadline: "Plazo en el tiempo virtual",
    dueTime: "Reintento previsto en el tiempo virtual",
    previousAttempt: "Reintento del intento de entrega",
    status: "Estado registrado",
    late: "Indicador de tardío registrado",
    reason: "Motivo registrado",
    ruleId: "Regla de falla",
    attempt: "Intento de entrega",
    destination: "Destino",
    consumer: "Consumidor",
    subscriber: "Suscriptor",
    transactionId: "Transacción",
    messageId: "ID de mensaje",
    deliveryId: "ID de entrega",
    routingId: "ID de ruteo",
  },
  fact: {
    storedPayload: "Payload registrado",
    redacted: "Oculto; no se muestra",
    omitted: "Omitido; no se muestra",
    transition: "Transición registrada",
    changedRows: "Filas modificadas registradas",
    messageType: "Tipo de mensaje",
    messageBodyFields: "Campos del cuerpo del mensaje",
    bodyFields: "Campos del cuerpo registrado",
    externalChange: "Cambio externo registrado",
  },
  relationship: {
    request: "Enlace de solicitud",
    publication: "Publicación de MessageBus",
    subscription: "Suscripción de MessageBus",
  },
  route: (p: { from: string; to?: string; relationship: string }, _f: Fmt) => p.to !== undefined
    ? `${p.from} → ${p.to} · ${p.relationship}`
    : `${p.from} · ${p.relationship}`,
  transit: {
    departure: (p: Transit, _f: Fmt) => p.to !== undefined
      ? `Salida: el token sale de ${p.from} y espera a mitad del enlace. Un registro posterior indica si llegó a ${p.to}.`
      : `Salida: el token sale de ${p.from} y espera a mitad del enlace. Un registro posterior indica si llegó a su destino.`,
    arrival: (p: Transit, _f: Fmt) => p.departure !== undefined
      ? (p.to !== undefined
        ? `Llegada: el token de la salida que partió en el tiempo virtual ${p.departure.time} (observación #${p.departure.sequence}) llega a ${p.to}.`
        : `Llegada: el token de la salida que partió en el tiempo virtual ${p.departure.time} (observación #${p.departure.sequence}) llega a su destino.`)
      : (p.to !== undefined
        ? `Llegada: el token llega a ${p.to}.`
        : "Llegada: el token llega a su destino."),
    interrupted: (p: Transit, _f: Fmt) => p.departure !== undefined
      ? (p.to !== undefined
        ? `Detenido: el viaje que partió en el tiempo virtual ${p.departure.time} (observación #${p.departure.sequence}) termina en el enlace y nunca llega a ${p.to}.`
        : `Detenido: el viaje que partió en el tiempo virtual ${p.departure.time} (observación #${p.departure.sequence}) termina en el enlace y nunca llega a su destino.`)
      : (p.to !== undefined
        ? `Detenido: el viaje termina en el enlace y nunca llega a ${p.to}.`
        : "Detenido: el viaje termina en el enlace y nunca llega a su destino."),
    timeout: (p: Transit, _f: Fmt) => p.departure !== undefined
      ? `Plazo: ${p.from} deja de esperar la solicitud que partió en el tiempo virtual ${p.departure.time} (observación #${p.departure.sequence}). No viaja nada; este es el registro propio de quien llama.`
      : `Plazo: ${p.from} deja de esperar la solicitud. No viaja nada; este es el registro propio de quien llama.`,
    trip: (p: Transit, _f: Fmt) => p.to !== undefined
      ? `Viaje: el token viaja de ${p.from} a ${p.to} en un solo registro.`
      : `Viaje: el token viaja de ${p.from} a su destino en un solo registro.`,
  },
  position: {
    unrun: "La corrida todavía no se ejecutó. Ejecutar o Paso la ejecutan.",
    none: "La corrida no registró hitos.",
    start: (total: number, f: Fmt) => f.plural(total, {
      one: "Antes del primer registro. La corrida registró 1 hito.",
      other: `Antes del primer registro. La corrida registró ${f.number(total)} hitos.`,
    }),
    current: (p: { index: number; total: number; time: number; sequence: number }, f: Fmt) =>
      `Hito ${f.number(p.index)} de ${f.number(p.total)} · tiempo virtual ${p.time} · observación #${p.sequence}.`,
    jump: (p: { from: number; to: number }, _f: Fmt) => `El tiempo virtual saltó de t=${p.from} a t=${p.to} sin ningún hito registrado en el medio.`,
  },
  legend: {
    REQ: { label: "Token: solicitud", detail: "sale de quien llama cuando se envía, espera a mitad del enlace y llega al destinatario cuando se entrega; su punta de flecha señala el sentido del viaje" },
    RES: { label: "Token: respuesta", detail: "sale del destinatario cuando se envía y llega a quien llama cuando se recibe; su punta de flecha señala el sentido del viaje" },
    MSG: { label: "Token: mensaje", detail: "viaja del publicador al MessageBus, o del MessageBus a un consumidor" },
    ACK: { label: "Token: confirmación", detail: "viaja del consumidor de vuelta al MessageBus" },
    "⊘": { label: "Token: descartado", detail: "el registro dice que este movimiento nunca llegó; el token se detiene en el enlace" },
    "◷": { label: "Token: con timeout", detail: "el registro dice que venció el plazo de quien llama; el token queda en quien llama" },
  },
  legendInTransit: { label: "Token: sigue en viaje", detail: "salió antes, y ningún registro hasta este hito dice que llegó o que se descartó; un número cuenta los que esperan en el mismo enlace" },
  settings: {
    group: "Ajustes de reproducción",
    animation: "Animación",
    speed: "Velocidad",
    help: "Con Animación activada, Ejecutar reproduce los hitos registrados de a uno, a la velocidad elegida. Con Animación desactivada, Ejecutar muestra el final de la corrida de inmediato, y Velocidad no está disponible. Ningún ajuste cambia la corrida.",
  },
  narration: {
    position: "Posición del cabezal",
    region: "Hito registrado",
    noFields: "Este registro no guarda más campos para la narración.",
    lookFor: "Qué mirar",
    details: "Detalles registrados",
    inTransitRoute: (p: { glyph: string; from: string; to?: string }, _f: Fmt) => p.to !== undefined ? `${p.glyph} ${p.from} → ${p.to}` : `${p.glyph} ${p.from}`,
    inTransit: (routes: readonly string[], f: Fmt) => f.plural(routes.length, {
      one: `Sigue en viaje: ${f.list(routes)}.`,
      other: `Siguen en viaje: ${f.list(routes)}.`,
    }),
    inTransitMany: (count: number, f: Fmt) => `Siguen en viaje otros ${f.number(count)} movimientos.`,
    trace: (id: string, _f: Fmt) => `Traza ${id}`,
    activityRegion: "Actividad de los componentes",
    activityHeading: "Actividad de los componentes en este registro",
    allIdle: "Todos los componentes están inactivos en este registro.",
    timeoutRests: "El token queda en quien llama. Este registro dice que venció el plazo de quien llama; no dice si llegó la solicitud o su respuesta.",
    interrupted: "El token se detiene en este enlace. Este registro dice que el movimiento no llegó; no dice qué concluyó cada componente.",
    recordAt: (component: string, _f: Fmt) => `En ${component}`,
    recordBySimulation: "Registrado por la simulación, en ningún componente",
    recordAnnouncement: (p: { label: string; component?: string; time: number }, _f: Fmt) => p.component !== undefined
      ? `${p.label} en ${p.component}, tiempo virtual ${p.time}.`
      : `${p.label}, registrado por la simulación en el tiempo virtual ${p.time}.`,
    recordTransit: "Nada viaja: este registro se pinta en su componente.",
  },
};
