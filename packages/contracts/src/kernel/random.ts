export const SEEDED_RANDOM_ALGORITHM = "xoshiro128ss-splitmix32-v1" as const;

export type SeededRandomAlgorithm = typeof SEEDED_RANDOM_ALGORITHM;

export interface RandomDraw {
  readonly index: number;
  readonly algorithm: SeededRandomAlgorithm;
  readonly uint32: number;
  readonly unit: number;
}

export interface SeededRandomPort {
  draw(label: string): RandomDraw;
}
