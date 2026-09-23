import { WorkerAdapter } from "./adapter.ts";

const adapter = new WorkerAdapter(event => globalThis.postMessage(event));
globalThis.addEventListener("message", (event: MessageEvent<unknown>) => { void adapter.receive(event.data); });
