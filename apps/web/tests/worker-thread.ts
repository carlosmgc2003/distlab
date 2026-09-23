import { parentPort } from "node:worker_threads";
import { WorkerAdapter } from "../src/worker/adapter.ts";

const adapter = new WorkerAdapter(event => parentPort!.postMessage(event));
parentPort!.on("message", (value: unknown) => { void adapter.receive(value); });
