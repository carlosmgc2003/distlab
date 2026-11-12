import type { timeline as source } from "../en/timeline.ts";
import type { Fmt } from "../format.ts";

/** Spanish messages for the `timeline` area. Typed by the English source, so keys and parameters must match. */
const recorded = (n: number, f: Fmt) => f.plural(n, { one: "1 observación registrada", other: `${f.number(n)} observaciones registradas` });
const clause = (n: number, f: Fmt) => f.plural(n, { one: "1 observación", other: `${f.number(n)} observaciones` });

export const timeline: typeof source = {
  recordLabels: {
    "network.request.sent": "Solicitud enviada",
    "network.request.delivered": "Solicitud entregada",
    "network.request.dropped": "Solicitud descartada",
    "network.request.timedout": "Timeout de solicitud",
    "network.response.sent": "Respuesta enviada",
    "network.response.received": "Respuesta recibida",
    "network.response.dropped": "Respuesta descartada",
    "message.published": "Mensaje publicado",
    "message.delivered": "Mensaje entregado",
    "message.acknowledged": "Mensaje confirmado",
    "message.ack.stale": "Confirmación de mensaje vencida",
    "message.retry.scheduled": "Reintento de mensaje programado",
    "database.transaction.committed": "Transacción de base de datos confirmada",
    "database.transaction.rolledback": "Transacción de base de datos revertida",
    "external.effect.committed": "Efecto externo confirmado",
    "fault.rule.matched": "Regla de falla aplicada",
    "fault.effect.selected": "Efecto de falla elegido",
  },
  faultRecorded: "Falla registrada",
  deliveredAttempt: (attempt: number | string, _f: Fmt) => `Mensaje entregado (intento ${attempt})`,
  learningGroups: {
    setup: "Configuración inicial de la cola del motor",
    assertion: "Evaluaciones de aserciones sin cambios",
  },
  recordedChange: "Cambio registrado",
  simulation: "Simulación",
  selectedNoMovement: (p: { type: string; source: string; target?: string; time: number | string }, _f: Fmt) =>
    `Elegiste ${p.type} en ${p.target === undefined ? p.source : `${p.source} hacia ${p.target}`} en el tiempo virtual ${p.time}. No hay movimiento de solicitud ni de mensaje.`,
  boundary: {
    none: "No hay observaciones visibles.",
    unselected: (count: number, f: Fmt) => f.plural(count, {
      one: "1 observación visible. Siguiente y Anterior la eligen.",
      other: `${f.number(count)} observaciones visibles. Siguiente elige la primera. Anterior elige la última.`,
    }),
    position: (p: { index: number; count: number }, f: Fmt) => `Observación visible ${f.number(p.index)} de ${f.number(p.count)}.`,
    cannotMoveBoth: "Anterior y Siguiente no pueden moverse.",
    cannotMovePrevious: "Anterior no puede moverse.",
    cannotMoveNext: "Siguiente no puede moverse.",
  },
  selection: (p: { sequence: number; type: string; time: number | string }, _f: Fmt) =>
    `Elegiste la observación n.º ${p.sequence}: ${p.type} en el tiempo virtual ${p.time}.`,
  clearedName: {
    fromTime: "tiempo virtual desde",
    toTime: "tiempo virtual hasta",
    type: "tipo",
    component: "componente",
    traceId: "traza",
    eventId: "evento",
    entity: "entidad",
  },
  clearedQuickView: (inline: string, _f: Fmt) => `vista rápida ${inline}`,
  revealCleared: (names: readonly string[], f: Fmt) => f.plural(names.length, {
    one: `Se quitó el filtro de ${f.list(names)} para que esta observación sea visible.`,
    other: `Se quitaron los filtros de ${f.list(names)} para que esta observación sea visible.`,
  }),
  traceAlready: (traceId: string, _f: Fmt) => `La línea de tiempo ya muestra la traza ${traceId}.`,
  traceNow: (traceId: string, _f: Fmt) => `La línea de tiempo ahora muestra la traza ${traceId}.`,
  traceCleared: (names: readonly string[], f: Fmt) => f.plural(names.length, {
    one: `Se quitó el filtro de ${f.list(names)}.`,
    other: `Se quitaron los filtros de ${f.list(names)}.`,
  }),
  payload: {
    omitted: "No se guardó ningún campo de datos.",
    redacted: "El payload guardado está oculto. Los campos ocultos no están disponibles.",
    stored: "Payload guardado",
  },
  terminal: {
    failure: (code: string | null, _f: Fmt) => code ? `Falla terminal ${code}.` : "Falla terminal.",
    historyIncomplete: "El historial de la ejecución está incompleto.",
    historyComplete: "El historial de la ejecución está completo.",
    historyNotReported: "No se informó si el historial de la ejecución está completo.",
    lastObservation: (id: string, _f: Fmt) => `Última observación registrada: ${id}.`,
  },

  review: {
    notInHistory: "Esa observación no está en este historial.",
    clearedAll: (total: number, f: Fmt) => f.plural(total, {
      one: "Se quitaron todos los filtros y vistas rápidas. La única observación registrada vuelve a estar disponible.",
      other: `Se quitaron todos los filtros y vistas rápidas. Las ${f.number(total)} observaciones registradas vuelven a estar disponibles.`,
    }),
  },

  filterHelp: [
    "Los filtros se combinan con AND.",
    "Los límites de tiempo virtual son inclusivos y son tiempos de simulación enteros.",
    "Exacto coincide con el valor guardado completo, Prefijo con su comienzo y Contiene con una parte del valor.",
    "La coincidencia distingue mayúsculas de minúsculas y usa solo el historial visible de esta ejecución.",
    "La lista de sugerencias muestra los valores registrados cuyo valor guardado o etiqueta contiene el texto escrito.",
    "Elegir una sugerencia aplica Exacto.",
    "Un componente coincide cuando coincide el origen o el destino.",
    "El tipo de entidad y el id de entidad tienen que coincidir con la misma referencia de entidad guardada.",
  ].join(" "),
  fieldNoun: {
    type: { noun: "Tipo", inline: "tipo" },
    component: { noun: "Componente", inline: "componente" },
    traceId: { noun: "Traza", inline: "traza" },
    eventId: { noun: "Evento", inline: "evento" },
    entityKind: { noun: "Tipo de entidad", inline: "tipo de entidad" },
    entityId: { noun: "Id de entidad", inline: "id de entidad" },
  },
  queryError: {
    notWholeTime: (p: { field: "fromTime" | "toTime"; value: string }, f: Fmt) =>
      `El tiempo virtual ${p.field === "fromTime" ? "desde" : "hasta"} ${f.quote(p.value)} no es un tiempo de simulación entero. Usá un entero no negativo, como 0 o 12.`,
    timeOrder: (p: { from: number; to: number }, _f: Fmt) =>
      `El tiempo virtual desde ${p.from} es posterior al tiempo virtual hasta ${p.to}. Usá un tiempo inicial menor o igual al final.`,
  },
  chip: {
    timeFrom: (time: number, _f: Fmt) => `Tiempo virtual desde ${time} inclusive`,
    timeTo: (time: number, _f: Fmt) => `Tiempo virtual hasta ${time} inclusive`,
    removeTimeFrom: "Quitar el filtro de tiempo virtual desde",
    removeTimeTo: "Quitar el filtro de tiempo virtual hasta",
    exact: (p: { noun: string; value: string }, _f: Fmt) => `${p.noun} igual a ${p.value}`,
    prefix: (p: { noun: string; value: string }, _f: Fmt) => `${p.noun} que empieza con ${p.value}`,
    contains: (p: { noun: string; value: string }, _f: Fmt) => `${p.noun} que contiene ${p.value}`,
    removeField: (inline: string, _f: Fmt) => `Quitar el filtro de ${inline}`,
  },
  explain: {
    intro: "Ninguna observación cumple todos los filtros activos. Los filtros se combinan con AND.",
    resetDefault: "Quitá un chip de filtro o limpiá todos los filtros para volver a ver las observaciones.",
    resetQuickView: (inline: string, _f: Fmt) => `Quitá el chip de la vista rápida ${inline} o limpiá todos los filtros para volver a ver las observaciones registradas.`,
    timeBoth: (p: { from: number; to: number }, _f: Fmt) => `El tiempo virtual es inclusivo desde ${p.from} hasta ${p.to}.`,
    timeFrom: (from: number, _f: Fmt) => `El tiempo virtual es inclusivo desde ${from} en adelante.`,
    timeTo: (to: number, _f: Fmt) => `El tiempo virtual es inclusivo desde el inicio hasta ${to}.`,
    excludedExact: (p: { noun: string; value: string; count: number }, f: Fmt) => f.plural(p.count, {
      one: `${p.noun} igual a ${f.quote(p.value)} coincide con 1 observación. Otro filtro activo la excluye.`,
      other: `${p.noun} igual a ${f.quote(p.value)} coincide con ${f.number(p.count)} observaciones. Otro filtro activo las excluye.`,
    }),
    excludedPrefix: (p: { noun: string; value: string; count: number }, f: Fmt) => f.plural(p.count, {
      one: `${p.noun} que empieza con ${f.quote(p.value)} coincide con 1 observación. Otro filtro activo la excluye.`,
      other: `${p.noun} que empieza con ${f.quote(p.value)} coincide con ${f.number(p.count)} observaciones. Otro filtro activo las excluye.`,
    }),
    excludedContains: (p: { noun: string; value: string; count: number }, f: Fmt) => f.plural(p.count, {
      one: `${p.noun} que contiene ${f.quote(p.value)} coincide con 1 observación. Otro filtro activo la excluye.`,
      other: `${p.noun} que contiene ${f.quote(p.value)} coincide con ${f.number(p.count)} observaciones. Otro filtro activo las excluye.`,
    }),
    notExact: (p: { noun: string; inline: string; value: string; values: readonly string[] }, f: Fmt) =>
      `${p.noun} ${f.quote(p.value)} no es un valor registrado exacto. Valores registrados que contienen ${f.quote(p.value)}: ${f.list(p.values)}. Elegí uno para una coincidencia exacta, o cambiá la coincidencia de ${p.inline} a Prefijo o Contiene.`,
    caseSensitive: (p: { inline: string; value: string; values: readonly string[] }, f: Fmt) =>
      `Ningún valor registrado de ${p.inline} contiene ${f.quote(p.value)}. La coincidencia distingue mayúsculas de minúsculas. Valores registrados parecidos: ${f.list(p.values)}.`,
    noneRecorded: (p: { inline: string; value: string }, f: Fmt) => `Ningún valor registrado de ${p.inline} coincide con ${f.quote(p.value)}.`,
    noneExact: (p: { inline: string; value: string; values: readonly string[] }, f: Fmt) =>
      `Ningún valor registrado de ${p.inline} es igual a ${f.quote(p.value)}. Valores registrados que contienen ${f.quote(p.value)}: ${f.list(p.values)}.`,
    nonePrefix: (p: { inline: string; value: string; values: readonly string[] }, f: Fmt) =>
      `Ningún valor registrado de ${p.inline} empieza con ${f.quote(p.value)}. Valores registrados que contienen ${f.quote(p.value)}: ${f.list(p.values)}.`,
    noneContains: (p: { inline: string; value: string; values: readonly string[] }, f: Fmt) =>
      `Ningún valor registrado de ${p.inline} contiene ${f.quote(p.value)}. Valores registrados que contienen ${f.quote(p.value)}: ${f.list(p.values)}.`,
  },

  quickView: {
    help: "Las vistas rápidas acotan el historial registrado; nunca cambian la ejecución.",
    views: {
      "key-events": {
        label: "Eventos clave",
        inline: "eventos clave",
        keeps: "Conserva los hitos didácticos de la vista Story.",
        empty: (total: number, f: Fmt) => `La vista rápida Eventos clave conserva los hitos didácticos de la vista Story, y esta ejecución registró ${clause(total, f)} sin ninguno de ellos.`,
      },
      "faults-and-timeouts": {
        label: "Fallas y timeouts",
        inline: "fallas y timeouts",
        keeps: "Conserva las reglas de falla, los efectos de falla, los mensajes descartados y los timeouts.",
        empty: (total: number, f: Fmt) => `La vista rápida Fallas y timeouts conserva las reglas de falla, los efectos de falla, los mensajes descartados y los timeouts, y esta ejecución registró ${clause(total, f)} sin ninguno de ellos.`,
      },
      "requests-and-responses": {
        label: "Solicitudes y respuestas",
        inline: "solicitudes y respuestas",
        keeps: "Conserva las solicitudes y respuestas de red registradas, incluidas las descartadas y las que vencieron por timeout.",
        empty: (total: number, f: Fmt) => `La vista rápida Solicitudes y respuestas conserva las solicitudes y respuestas de red registradas, incluidas las descartadas y las que vencieron por timeout, y esta ejecución registró ${clause(total, f)} sin ninguna de ellas.`,
      },
      messages: {
        label: "Mensajes",
        inline: "mensajes",
        keeps: "Conserva los mensajes publicados, entregados, confirmados y reintentados.",
        empty: (total: number, f: Fmt) => `La vista rápida Mensajes conserva los mensajes publicados, entregados, confirmados y reintentados, y esta ejecución registró ${clause(total, f)} sin ninguno de ellos.`,
      },
      "state-changes": {
        label: "Cambios de estado",
        inline: "cambios de estado",
        keeps: "Conserva las transacciones confirmadas y revertidas y los efectos externos confirmados.",
        empty: (total: number, f: Fmt) => `La vista rápida Cambios de estado conserva las transacciones confirmadas y revertidas y los efectos externos confirmados, y esta ejecución registró ${clause(total, f)} sin ninguno de ellos.`,
      },
      assertions: {
        label: "Aserciones",
        inline: "aserciones",
        keeps: "Conserva las evaluaciones de aserciones del escenario y sus veredictos guardados.",
        empty: (total: number, f: Fmt) => `La vista rápida Aserciones conserva las evaluaciones de aserciones del escenario y sus veredictos guardados, y esta ejecución registró ${clause(total, f)} sin ninguna de ellas.`,
      },
    },
    emptyRemove: "Quitá el chip de la vista rápida para volver a ver el historial registrado.",
    summaryNone: (p: { shown: number; recorded: number }, f: Fmt) =>
      `No hay ninguna vista rápida activa. Los filtros avanzados muestran ${f.number(p.shown)} de ${recorded(p.recorded, f)}.`,
    summaryNothing: (p: { label: string; inline: string; recorded: number }, f: Fmt) =>
      `${p.label} muestra 0 de ${recorded(p.recorded, f)}. Esta ejecución no registró ${p.inline}.`,
    summaryShown: (p: { label: string; shown: number; recorded: number }, f: Fmt) =>
      `${p.label} muestra ${f.number(p.shown)} de ${recorded(p.recorded, f)}.`,
    feedbackCleared: (total: number, f: Fmt) => f.plural(total, {
      one: "Se quitó la vista rápida. La única observación registrada vuelve a estar disponible.",
      other: `Se quitó la vista rápida. Las ${f.number(total)} observaciones registradas vuelven a estar disponibles.`,
    }),
    feedbackApplied: (p: { label: string; shown: number; recorded: number }, f: Fmt) => f.plural(p.recorded, {
      one: `Se aplicó la vista rápida ${p.label}. Muestra ${f.number(p.shown)} de 1 observación registrada y no cambia nada en la ejecución.`,
      other: `Se aplicó la vista rápida ${p.label}. Muestra ${f.number(p.shown)} de ${f.number(p.recorded)} observaciones registradas y no cambia nada en la ejecución.`,
    }),
    chip: (label: string, _f: Fmt) => `Vista rápida ${label}`,
    removeChip: (label: string, _f: Fmt) => `Quitar la vista rápida ${label}`,
  },
};
