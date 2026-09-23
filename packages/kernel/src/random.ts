import type { SeededRandomPort, RandomDraw } from "@distlab/contracts/kernel";
import { ErrorCodes, SEEDED_RANDOM_ALGORITHM, throwSimulationError } from "@distlab/contracts/kernel";
import { sha256Hex } from "./canonical.js";

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;
function splitMix32(state: number): number {
  let z = (state + 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  return (z ^ (z >>> 15)) >>> 0;
}

export class SeededRandom implements SeededRandomPort {
  readonly #state: number[];
  #index = 0;
  #valid = true;
  constructor(seed: string) {
    if (typeof seed !== "string" || !seed.trim()) throwSimulationError(ErrorCodes.INVALID_RUN_INPUT);
    const hex = sha256Hex(seed.trim().normalize("NFC"));
    this.#state = Array.from({ length: 4 }, (_, i) => {
      const bytes = hex.slice(i * 8, i * 8 + 8).match(/../g)!;
      return splitMix32(Number.parseInt(bytes.reverse().join(""), 16));
    });
    if (this.#state[0] === 0 && this.#state[1] === 0 && this.#state[2] === 0 && this.#state[3] === 0) this.#state[3] = 0x9e3779b9;
  }
  revoke(): void { this.#valid = false; }
  draw(label: string): RandomDraw {
    if (!this.#valid) throwSimulationError(ErrorCodes.STALE_CAPABILITY);
    if (typeof label !== "string" || !label.length) throwSimulationError(ErrorCodes.INVALID_OPERATION);
    if (!Number.isSafeInteger(this.#index + 1)) throwSimulationError(ErrorCodes.IDENTITY_OVERFLOW);
    let [a, b, c, d] = this.#state as [number, number, number, number];
    const uint32 = Math.imul(rotl(Math.imul(b, 5) >>> 0, 7), 9) >>> 0;
    const t = (b << 9) >>> 0;
    c = (c ^ a) >>> 0; d = (d ^ b) >>> 0; b = (b ^ c) >>> 0;
    a = (a ^ d) >>> 0; c = (c ^ t) >>> 0; d = rotl(d, 11);
    this.#state.splice(0, 4, a, b, c, d);
    return Object.freeze({ index: this.#index++, algorithm: SEEDED_RANDOM_ALGORITHM, uint32, unit: uint32 / 2 ** 32 });
  }
}
