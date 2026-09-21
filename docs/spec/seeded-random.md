# Seeded Random Specification

| Field | Value |
| --- | --- |
| Status | Implementation-ready MVP baseline |
| Owner | DistLab core team |
| Last updated | 2026-09-21 |
| Related issues | #3 |

## Responsibility

The seeded generator is the only source of pseudo-random behavior in a run. It
is a kernel-owned deterministic stream used by runtime adapters through a narrow
port. Application handlers, catalogs, UI, subscribers, assertions, and host code
must not call `Math.random()` or own a hidden random stream.

## Algorithm and seed normalization

The MVP algorithm is **xoshiro128**\*\*** with a **SplitMix32** expander. Its
algorithm identifier is `xoshiro128ss-splitmix32-v1`.

Before expansion the input seed is canonicalized as follows:

1. Accept a nonempty string after surrounding Unicode whitespace is trimmed.
2. Normalize it with Unicode NFC.
3. Encode it as UTF-8.
4. Hash the bytes with SHA-256.
5. Interpret digest bytes `0..3`, `4..7`, `8..11`, and `12..15` as four
   unsigned little-endian words `w0`–`w3`.
6. Run one independent SplitMix32 step with each `wi` as its initial state; the
   four outputs, in order, are xoshiro state words `s0`–`s3`. If all four words
   are zero, replace `s3` with `0x9e3779b9`.

The original normalized seed string, not the expanded state, remains part of
`RunInputs` and run ID calculation.

All arithmetic below is unsigned 32-bit arithmetic: after every addition,
shift, multiplication, or XOR, reduce with `>>> 0`. `rotl(x, k)` is
`((x << k) | (x >>> (32 - k))) >>> 0`; `imul` is `Math.imul` (or an exact
32-bit integer multiplication in another language). A SplitMix32 step and a
xoshiro128** draw are exactly:

```ts
function splitMix32(state: number): number {
  let z = (state + 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  return (z ^ (z >>> 15)) >>> 0;
}

function next(state: [number, number, number, number]): number {
  let [s0, s1, s2, s3] = state;
  const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
  const t = (s1 << 9) >>> 0;
  s2 = (s2 ^ s0) >>> 0;
  s3 = (s3 ^ s1) >>> 0;
  s1 = (s1 ^ s2) >>> 0;
  s0 = (s0 ^ s3) >>> 0;
  s2 = (s2 ^ t) >>> 0;
  s3 = rotl(s3, 11);
  state[0] = s0; state[1] = s1; state[2] = s2; state[3] = s3;
  return result;
}
```

Conformance vectors use the normalized UTF-8 seed shown. The state column is
`[s0, s1, s2, s3]` after expansion; outputs are the first five `uint32` draws.

| Seed | Initial state | Outputs |
| --- | --- | --- |
| `mvp-response-lost-001` | `[1779426968, 130810414, 2509473014, 3460957345]` | `[1848708011, 276145100, 3342336838, 2133524352, 2602090516]` |
| `distlab` | `[2896119305, 3228219259, 2060793878, 3830696279]` | `[1629508329, 3786623983, 3349857114, 1564400182, 2109307711]` |

## Draw port

```ts
interface RandomDraw {
  readonly index: number;
  readonly algorithm: "xoshiro128ss-splitmix32-v1";
  readonly uint32: number;
  readonly unit: number;
}
interface SeededRandomPort {
  draw(label: string): RandomDraw;
}
```

`draw` is synchronous and consumes exactly one value. `index` is a safe-integer
counter starting at zero. `uint32` is the raw unsigned 32-bit output after the
xoshiro step. `unit` is `uint32 / 2 ** 32`, so it is in `[0, 1)` and never equals
`1`. `label` is diagnostic only; changing it does not change the stream. Invalid
or stale ports fail before consuming a draw.

Runtime models convert the draw to decisions in their own specs. Bernoulli tests
use `unit < probability`. Integer ranges use rejection sampling from `uint32` so
modulo bias is not introduced. A derived delay or fault decision that does not
need randomness must not draw.

## Reset and reproducibility

A fresh construction and a reset with equal normalized architecture, scenario,
configuration, model versions, and seed produce the same draw sequence at the
same modeled probe points. Reset creates a fresh generator from the normalized
seed and resets the draw index to zero. Old draw ports reject with
`STALE_CAPABILITY` and do not consume values.

Equal seeds in different browser sessions produce equal values. Different seeds
may collide only through the SHA-256/algorithm state mapping; no host time,
session identity, object iteration order, or UI interaction is mixed into the
stream.

## Versioning

The algorithm identifier is part of `modelVersions` under `kernel.random`. Any
change to normalization, expansion, output, range conversion, or draw-order
requirements requires a new identifier and a migration note. Existing accepted
scenarios pin the old version until deliberately updated.

## Acceptance coverage

- **RAND-AC-1:** Equal normalized seeds produce equal first N draws across fresh
  runs and reset.
- **RAND-AC-2:** Reset restores index zero and stale ports cannot draw.
- **RAND-AC-3:** Fault and network probability decisions use `unit < p` and
  consume no random values when no probabilistic decision is required.
- **RAND-AC-4:** The algorithm identifier is present in `modelVersions`.
- **RAND-AC-5:** Implementations match published seed/output vectors before
  they are accepted as an implementation of this algorithm.

## References

- [Shared contracts](contracts.md)
- [Simulation Core](simulation-core.md)
- [Virtual Network](virtual-network.md)
- [Fault Engine](fault-engine.md)
