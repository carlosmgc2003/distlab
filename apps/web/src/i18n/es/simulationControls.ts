import type { simulationControls as source } from "../en/simulationControls.ts";
import type { Fmt } from "../format.ts";

/** Spanish messages for the `simulationControls` area. Typed by the English source, so keys and parameters must match. */
export const simulationControls: typeof source = {
  executionLabel: "Simulación",
  run: "Ejecutar",
  continue: "Continuar",
  pause: "Pausar",
  back: "Atrás",
  step: "Paso",
  reset: "Reiniciar",
  help: "El primer Ejecutar o Paso ejecuta toda la corrida una vez. Después, Ejecutar reproduce los hitos registrados en el grafo, Pausar detiene el cabezal, Paso y Atrás mueven un hito, y nada se vuelve a ejecutar. Reiniciar vuelve a empezar el escenario cargado. Una vez ejecutada la corrida, Flecha izquierda es Atrás, Flecha derecha es Paso y Espacio es Ejecutar o Pausar.",
  committedState: "Estado confirmado de la simulación",
  statusLabel: "Estado de la simulación",
  status: { READY: "LISTO", PAUSED: "PAUSADO", RUNNING: "EJECUTANDO", COMPLETED: "COMPLETADO", FAILED: "FALLIDO" },
  statusUnavailable: "Simulación no disponible.",
  statusAssessmentRunning: "Evaluación en curso.",
  statusChoose: "Elegí un escenario.",
  pendingReset: "Reiniciando el escenario…",
  pendingRun: "Ejecución en curso…",
  pendingLoading: "Cargando…",
  pendingAssessment: "Evaluación en curso…",
  virtualTime: "Tiempo virtual",
  processedEvents: "Eventos procesados",
  pendingEvents: "Eventos pendientes",
  errorDetails: "Detalles del error",
};
