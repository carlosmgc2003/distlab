import type { errors as source } from "../en/errors.ts";

/** Spanish messages for the `errors` area. Typed by the English source, so keys and parameters must match. */
export const errors: typeof source = {
  text: {
    controlBusy: "Ya hay un control de la simulación en curso.",
    invalidCommand: "Se esperaba un comando de worker de la versión 1.",
    protocolMismatch: "El comando no cumple el protocolo versión 1.",
    noSession: "Cargá un escenario antes de enviar controles.",
    controlNotApplied: "No se pudo aplicar el control de la simulación.",
    hostClosed: "Se cerró el host del worker.",
    workerStopped: "El worker de simulación se detuvo o no pudo intercambiar mensajes.",
    invalidProtocolMessage: "El worker devolvió un mensaje de protocolo inválido.",
    sessionReplaced: "Un escenario nuevo reemplazó la sesión anterior.",
    failedAtBoundary: "La simulación falló en un límite de evento.",
    failedBeforePause: "La simulación falló antes de completar la pausa.",
    scenarioNotLoaded: "No se pudo cargar el escenario.",
    documentInvalid: "El documento de escenario no es válido.",
    overlayInvalid: "Los cambios de la sesión no están permitidos para esta lección o la vuelven inválida.",
    overlayRowRejected: "Se rechazaron los cambios de la fila.",
    suiteStopped: "La evaluación no pudo continuar.",
  },
};
