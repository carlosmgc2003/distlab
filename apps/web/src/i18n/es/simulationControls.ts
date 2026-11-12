import type { simulationControls as source } from "../en/simulationControls.ts";
import type { Fmt } from "../format.ts";

/** Spanish messages for the `simulationControls` area. Typed by the English source, so keys and parameters must match. */
export const simulationControls: typeof source = {
  executionLabel: "Simulación",
  run: "Ejecutar",
  pause: "Pausar",
  step: "Paso",
  reset: "Reiniciar",
  help: "Estos cuatro controles modifican la simulación. Paso avanza un evento programado. Pausar tiene efecto en el límite de un evento. Reiniciar vuelve a empezar el escenario cargado. La reproducción, en la pestaña Arquitectura, es un grupo de controles aparte que no modifica la simulación.",
  committedState: "Estado confirmado de la simulación",
  statusLabel: "Estado de la simulación",
  status: { READY: "LISTO", PAUSED: "PAUSADO", RUNNING: "EJECUTANDO", COMPLETED: "COMPLETADO", FAILED: "FALLIDO" },
  statusUnavailable: "Simulación no disponible.",
  statusAssessmentRunning: "Evaluación en curso.",
  statusChoose: "Elegí un escenario.",
  pendingPause: "Pausa solicitada; esperando un límite de evento…",
  pendingReset: "Reiniciando el escenario…",
  pendingStep: "Avanzando un evento…",
  pendingRun: "Ejecución en curso…",
  pendingLoading: "Cargando…",
  pendingAssessment: "Evaluación en curso…",
  virtualTime: "Tiempo virtual",
  processedEvents: "Eventos procesados",
  pendingEvents: "Eventos pendientes",
  errorDetails: "Detalles del error",
};
