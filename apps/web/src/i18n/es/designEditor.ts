import type { Fmt } from "../format.ts";
import type { designEditor as source } from "../en/designEditor.ts";

/** Spanish messages for the `designEditor` area (ADR-007): design-edits.ts and ArchitectureSection.tsx. */
export const designEditor: typeof source = {
  title: "Arquitectura",
  help: "Los cambios de diseño modifican la arquitectura de la lección: el modelo que ocupa un slot, un par al que llama, los recursos que posee un servicio y los destinos a los que se suscribe. Solo se ofrecen los cambios que esta lección permite, y Aplicar y reiniciar es lo que verifica que un diseño sea válido.",
  count: (p: { count: number; max: number }, f: Fmt) => `${f.number(p.count)} de ${f.number(p.max)} cambios de diseño`,
  problems: "Problemas de diseño",
  controls: {
    slot: (p: { component: string }, _f: Fmt) => `Modelo de ${p.component}`,
    packagedEmpty: "Slot vacío (empaquetado)",
    packagedModel: (p: { model: string; version: string }, _f: Fmt) => `${p.model} ${p.version} (empaquetado)`,
    option: (p: { component: string; key: string }, _f: Fmt) => `${p.component}: ${p.key}`,
    binding: (p: { component: string; peer: string }, _f: Fmt) => `${p.component} llama a ${p.peer} en`,
    ownsDatabase: (p: { owner: string }, _f: Fmt) => `${p.owner} posee una base de datos`,
    ownsStore: (p: { owner: string }, _f: Fmt) => `${p.owner} posee un almacén clave-valor`,
    subscription: (p: { consumer: string; destination: string }, _f: Fmt) => `${p.consumer} se suscribe a ${p.destination}`,
  },
  summary: {
    edits: (count: number, f: Fmt) => f.plural(count, { one: "1 cambio de diseño", other: `${f.number(count)} cambios de diseño` }),
    slot: (p: { component: string; model: string; version: string }, _f: Fmt) => `${p.component}: ${p.model} ${p.version}`,
  },
  diagnostics: {
    STORAGE: "Este modelo necesita almacenamiento que el componente no posee.",
    SUBSCRIPTION: "Los consumidores del modelo y las suscripciones del componente no coinciden.",
    PEER: "Un par de este componente no se resuelve a un componente al que pueda llamar.",
    INTERFACE: "El componente llamado no ofrece un endpoint que este componente llama.",
    LINK: "Ningún enlace transporta esta llamada.",
    PUBLISH: "Este modelo publica en un destino que no existe.",
    OWNERSHIP: "Solo los servicios poseen recursos.",
    DUPLICATE: "Dos cambios modifican el mismo elemento.",
    OVERLAY_NOT_ALLOWED: "Esta lección no permite este cambio.",
    PARAMETER_VALUE: "Este valor está fuera del rango permitido.",
  },
  limit: (max: number, f: Fmt) => f.plural(max, { one: "Esta lección permite como máximo 1 cambio de diseño.", other: `Esta lección permite como máximo ${f.number(max)} cambios de diseño.` }),
  diagnosticUnknown: "Este cambio no es válido.",
};
