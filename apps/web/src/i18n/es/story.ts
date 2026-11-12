import type { story as source } from "../en/story.ts";
import type { Fmt } from "../format.ts";

/** Spanish messages for the `story` area. Typed by the English source, so keys and parameters must match. */
const observations = (n: number, f: Fmt) => f.plural(n, { one: "1 observación registrada", other: `${f.number(n)} observaciones registradas` });
const milestones = (n: number, f: Fmt) => f.plural(n, { one: "1 hito didáctico", other: `${f.number(n)} hitos didácticos` });

export const story: typeof source = {
  labelOverrides: {
    "database.transaction.committed": "Transacción confirmada",
    "database.transaction.rolledback": "Transacción revertida",
  },
  kinds: {
    request: "Solicitud",
    response: "Respuesta",
    message: "Mensaje",
    retry: "Reintento",
    commit: "Confirmación de transacción",
    rollback: "Reversión de transacción",
    external: "Efecto externo",
    fault: "Falla",
    drop: "Mensaje descartado",
    timeout: "Timeout",
  },
  reduction: (p: { milestones: number; recorded: number }, f: Fmt) => `${milestones(p.milestones, f)} de ${observations(p.recorded, f)}.`,
  summaryEmpty: (reduction: string, _f: Fmt) => `No hay hitos didácticos en los resultados actuales. ${reduction}`,
  summary: (p: { reduction: string; lanes: readonly string[]; first: number | string; last: number | string }, f: Fmt) =>
    `${p.reduction} La tira se lee de izquierda a derecha en el orden de secuencia de las observaciones registradas, en ${f.plural(p.lanes.length, {
      one: "1 carril de componente",
      other: `${f.number(p.lanes.length)} carriles de componente`,
    })}: ${f.list(p.lanes)}. El primer hito se registró en el tiempo virtual ${p.first} y el último en el tiempo virtual ${p.last}.`,
  detailEmpty: "La tira Story y su tabla están vacías.",
  detail: (p: { columns: number; lanes: number; boundaries: number; kinds: readonly string[] }, f: Fmt) =>
    `${f.plural(p.columns, { one: "1 columna", other: `${f.number(p.columns)} columnas` })} y ${f.plural(p.lanes, { one: "1 carril de componente", other: `${f.number(p.lanes)} carriles de componente` })}. `
    + f.plural(p.boundaries, {
      one: "Hay marcado 1 límite de tiempo virtual registrado, y no se guarda ninguna duración transcurrida entre hitos. ",
      other: `Hay marcados ${f.number(p.boundaries)} límites de tiempo virtual registrados, y no se guarda ninguna duración transcurrida entre hitos. `,
    })
    + "Cada hito es una observación registrada; el orden es su secuencia registrada. "
    + `Categorías de hitos guardadas y sus formas: ${f.list(p.kinds)}. `
    + "La tabla repite los mismos hitos en el mismo orden y elige las mismas observaciones.",
  count: (p: { reduction: string; filtered: number; total: number; otherRecords: number }, f: Fmt) => {
    const filters = p.filtered === p.total ? "" : `Los filtros muestran ${f.number(p.filtered)} de ${f.plural(p.total, { one: "1 observación", other: `${f.number(p.total)} observaciones` })}; `;
    const rest = p.otherRecords === 0
      ? p.filtered === 0 ? "No hay registros visibles para reducir." : "Todos los registros visibles son hitos."
      : f.plural(p.otherRecords, {
        one: "1 registro visible no es un hito didáctico; Learning y Raw lo conservan.",
        other: `${f.number(p.otherRecords)} registros visibles no son hitos didácticos; Learning y Raw los conservan.`,
      });
    return `${p.reduction} ${filters}${rest}`;
  },
};
