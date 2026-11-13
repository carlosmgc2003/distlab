import type { playback as source } from "../en/playback.ts";
import type { Fmt } from "../format.ts";

type Transit = { from: string; to?: string; departure?: { time: number; sequence: number } };

/** Spanish messages for the `playback` area. Typed by the English source, so keys and parameters must match. */
export const playback: typeof source = {
  pace: {
    label: { slow: "Lenta", steady: "Constante", fast: "Rápida" },
    note: (p: { seconds: number }, f: Fmt) => `un movimiento cada ${f.number(p.seconds)} segundos`,
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
    none: "No hay movimientos registrados para reproducir.",
    noneDetail: "Ejecutá el escenario, o abrí el historial registrado y elegí un registro.",
    nothingSelected: (total: number, f: Fmt) => f.plural(total, {
      one: "0 de 1 movimiento registrado. No hay nada seleccionado.",
      other: `0 de ${f.number(total)} movimientos registrados. No hay nada seleccionado.`,
    }),
    current: (p: { index: number; total: number; time: number; sequence: number }, f: Fmt) =>
      `Movimiento ${f.number(p.index)} de ${f.number(p.total)} · tiempo virtual ${p.time} · observación #${p.sequence}.`,
    atLast: "Estás en el último movimiento registrado. La reproducción espera a que la ejecución registre más.",
    jump: (p: { from: number; to: number }, _f: Fmt) => `El tiempo virtual saltó de t=${p.from} a t=${p.to} sin ningún movimiento registrado en el medio.`,
    sameTime: (p: { total: number; time: number }, f: Fmt) => f.plural(p.total, {
      one: `El único movimiento registrado ocurre en el tiempo virtual ${p.time}.`,
      other: `Los ${f.number(p.total)} movimientos registrados ocurren en el tiempo virtual ${p.time}.`,
    }),
    boundaries: (p: { total: number; boundaries: number; from: number; to: number }, f: Fmt) =>
      `${f.number(p.total)} movimientos registrados en ${f.number(p.boundaries)} límites de tiempo virtual registrados, de t=${p.from} a t=${p.to}. Las líneas marcan solo los límites; no se guarda ninguna duración.`,
  },
  control: {
    play: "Reproducir",
    restart: "Reiniciar reproducción",
    pause: "Pausar reproducción",
    playing: "Reproduciendo la línea de tiempo visible. Pausar detiene el cursor.",
    noObservations: "No hay observaciones visibles para reproducir.",
    atEnd: "Estás al final de los resultados visibles. Reiniciar reproducción empieza desde la primera observación visible.",
    fromStart: "Reproducir empieza en la primera observación visible.",
    fromSelected: "Reproducir continúa desde la observación seleccionada.",
    paused: "La reproducción está en pausa.",
    ended: "La reproducción llegó al final de los resultados visibles. Reiniciar reproducción empieza desde la primera observación visible.",
    recording: "Reproduciendo los movimientos registrados. El cursor espera al final mientras la ejecución registra más.",
  },
  legend: {
    REQ: { label: "Token: solicitud", detail: "sale de quien llama cuando se envía, espera a mitad del enlace y llega al destinatario cuando se entrega; su punta de flecha señala el sentido del viaje" },
    RES: { label: "Token: respuesta", detail: "sale del destinatario cuando se envía y llega a quien llama cuando se recibe; su punta de flecha señala el sentido del viaje" },
    MSG: { label: "Token: mensaje", detail: "viaja del publicador al MessageBus, o del MessageBus a un consumidor" },
    ACK: { label: "Token: confirmación", detail: "viaja del consumidor de vuelta al MessageBus" },
    "⊘": { label: "Token: descartado", detail: "el registro dice que este movimiento nunca llegó; el token se detiene en el enlace" },
    "◷": { label: "Token: con timeout", detail: "el registro dice que venció el plazo de quien llama; el token queda en quien llama" },
  },
  toolbar: {
    label: "Reproducción",
    group: "Reproducción de movimientos registrados",
    previous: "Movimiento anterior",
    next: "Movimiento siguiente",
    speed: "Velocidad",
    help: "Estos controles mueven un cursor del navegador sobre movimientos que la ejecución ya registró. No envían ningún comando a la simulación, no cambian el tiempo virtual y no registran observaciones. Desde el teclado, Flecha izquierda y Flecha derecha avanzan o retroceden un movimiento, y Espacio reproduce o pausa.",
  },
  narration: {
    position: "Posición de la reproducción de la arquitectura",
    region: "Movimiento registrado",
    noFields: "Este registro no guarda más campos para la narración.",
    lookFor: "Qué mirar",
    details: "Detalles registrados",
    trace: (id: string, _f: Fmt) => `Traza ${id}`,
    activityRegion: "Actividad de los componentes",
    activityHeading: "Actividad de los componentes en este registro",
    allIdle: "Todos los componentes están inactivos en este registro.",
    timeoutRests: "El token queda en quien llama. Este registro dice que venció el plazo de quien llama; no dice si llegó la solicitud o su respuesta.",
    interrupted: "El token se detiene en este enlace. Este registro dice que el movimiento no llegó; no dice qué concluyó cada componente.",
  },
};
