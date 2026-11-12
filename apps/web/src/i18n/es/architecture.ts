import type { architecture as source } from "../en/architecture.ts";
import type { Fmt } from "../format.ts";

/** Spanish messages for the `architecture` area. Typed by the English source, so keys and parameters must match. */
export const architecture: typeof source = {
  invalid: "La arquitectura tiene componentes duplicados o conexiones a componentes que no existen.",
  category: {
    client: "Cliente",
    service: "Servicio interno",
    external: "Servicio externo",
    infrastructure: "Infraestructura",
  },
  symbol: {
    client: "Cliente",
    service: "Servicio interno",
    external: "Servicio externo",
    topic: "Tópico del bus de mensajes",
    queue: "Cola del bus de mensajes",
    kvstore: "Almacén clave-valor compartido",
  },
  resourceKind: { database: "Base de datos", kvstore: "KeyValueStore" },
  databaseOwnedBy: (owner: string, _f: Fmt) => `Base de datos de ${owner}`,
  storeOwnedBy: (owner: string, _f: Fmt) => `KeyValueStore de ${owner}`,
  databaseResource: (p: { owner: string; tables: readonly string[] }, _f: Fmt) => `Base de datos de ${p.owner}: ${p.tables.join(", ")}`,
  storeResource: (owner: string, _f: Fmt) => `KeyValueStore de ${owner}`,
  destinationResource: {
    topic: (id: string, _f: Fmt) => `Tópico de MessageBus: ${id}`,
    queue: (id: string, _f: Fmt) => `Cola de MessageBus: ${id}`,
  },
  destinationResourceOther: (p: { kind: string; id: string }, _f: Fmt) => `MessageBus ${p.kind}: ${p.id}`,
  link: {
    request: "Solicitud",
    requestNamed: (label: string, _f: Fmt) => `Solicitud · ${label}`,
    subscription: "Suscripción",
    publication: "Publicación",
    aria: (p: { source: string; target: string; label: string }, _f: Fmt) => `${p.source} a ${p.target}: ${p.label}`,
    publicationAria: "Orders a MessageBus OrderCreated: publicación",
  },
  nodeAria: (p: { title: string; symbol: string }, _f: Fmt) => `${p.title}, ${p.symbol}`,
  nodeAriaEmptySlot: (p: { title: string; symbol: string }, _f: Fmt) => `${p.title}, ${p.symbol}, espacio vacío`,
  activity: {
    state: { idle: "Inactivo", processing: "Procesando", waiting: "Esperando" },
    waitingUntil: (deadline: number, _f: Fmt) => `Esperando · plazo t=${deadline}`,
    idle: (id: string, _f: Fmt) => `${id} está inactivo.`,
    waiting: (p: { id: string; targets: string; deadline?: number }, _f: Fmt) => p.deadline !== undefined
      ? `${p.id} está esperando a ${p.targets} con un plazo registrado en el tiempo virtual ${p.deadline}.`
      : `${p.id} está esperando a ${p.targets} sin plazo registrado.`,
    processing: (p: { id: string; work: string }, _f: Fmt) => `${p.id} está procesando ${p.work}.`,
    waitingAndProcessing: (p: { id: string; targets: string; work: string; deadline?: number }, _f: Fmt) => p.deadline !== undefined
      ? `${p.id} está esperando a ${p.targets} con un plazo registrado en el tiempo virtual ${p.deadline} y procesando ${p.work}.`
      : `${p.id} está esperando a ${p.targets} sin plazo registrado y procesando ${p.work}.`,
    timedOut: (p: { target: string; time: number }, _f: Fmt) => `Su solicitud a ${p.target} venció por timeout en el tiempo virtual ${p.time}.`,
    work: {
      requests: (n: number, f: Fmt) => f.plural(n, { one: "una solicitud entregada", other: `${f.number(n)} solicitudes entregadas` }),
      transactions: (n: number, f: Fmt) => f.plural(n, { one: "una transacción abierta", other: `${f.number(n)} transacciones abiertas` }),
      deliveries: (n: number, f: Fmt) => f.plural(n, { one: "una entrega de mensaje sin confirmar", other: `${f.number(n)} entregas de mensajes sin confirmar` }),
    },
  },
};
