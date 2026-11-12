import type { lessonChooser as source } from "../en/lessonChooser.ts";
import type { Fmt } from "../format.ts";

/** Spanish messages for the `lessonChooser` area. Typed by the English source, so keys and parameters must match. */
export const lessonChooser: typeof source = {
  title: "Elegí una lección",
  discardNotice: "Al elegir una lección se descartan tus decisiones de diseño y fallas sin aplicar.",
  topicGroup: "Tema",
  allTopics: "Todos los temas",
  search: "Buscar",
  searchPlaceholder: "Concepto, patrón o falla",
  count: (p: { shown: number; total: number }, f: Fmt) =>
    p.shown === p.total
      ? f.plural(p.total, { one: "1 lección", other: `${f.number(p.total)} lecciones` })
      : f.plural(p.total, { one: `${f.number(p.shown)} de 1 lección`, other: `${f.number(p.shown)} de ${f.number(p.total)} lecciones` }),
  topicLessons: (title: string, _f: Fmt) => `Lecciones de ${title}`,
  concepts: "Conceptos: ",
  loaded: "Cargada",
  empty: "Ninguna lección coincide. Borrá la búsqueda o elegí Todos los temas.",
  assessment: "Evaluación",
  assessments: "Evaluaciones",
  cancel: "Cancelar",
};
