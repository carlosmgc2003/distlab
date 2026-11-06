import ELK from "elkjs/lib/elk-api.js";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import type { ElkEngine, Size } from "./elk-layout.ts";

/**
 * Browser ELK: the small API runs on the main thread and the layout engine runs
 * in its own presentation worker, apart from the simulation worker. The engine
 * script is fetched only when the first layout is requested.
 */
let engine: ElkEngine | undefined;
export function browserElk(): ElkEngine {
  engine ??= new ELK({ workerUrl: elkWorkerUrl });
  return engine;
}

/** Matches the edge label style in architecture-view.ts: 13 px text, 7 × 5 px background padding. */
const LABEL_FONT_SIZE = 13;
const LABEL_PADDING = { x: 7, y: 5 };

let context: CanvasRenderingContext2D | null | undefined;

/**
 * Measures an edge label with the canvas's own font, so ELK reserves the space
 * the label really takes. Returns undefined when the browser cannot measure
 * text; that label then gets no reserved space.
 */
export function edgeLabelMeasurer(element: Element): (text: string) => Size | undefined {
  const family = getComputedStyle(element).fontFamily || "sans-serif";
  return text => {
    context ??= document.createElement("canvas").getContext("2d");
    if (!context) return undefined;
    context.font = `${LABEL_FONT_SIZE}px ${family}`;
    const metrics = context.measureText(text);
    const height = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
    return { width: Math.ceil(metrics.width + 2 * LABEL_PADDING.x), height: Math.ceil(height + 2 * LABEL_PADDING.y) };
  };
}
