import type { CanonicalValue, RunId, RunInputs } from "@distlab/contracts/kernel";
import { ErrorCodes, throwSimulationError } from "@distlab/contracts/kernel";

/** Copies a value without reading accessors, then makes every reachable value immutable. */
export function canonicalCopy(value: unknown): CanonicalValue {
  const active = new Set<object>();
  return copy(value, active);
}

function copy(value: unknown, active: Set<object>): CanonicalValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) invalid("number");
    return value;
  }
  if (typeof value !== "object") invalid(typeof value);
  if (active.has(value)) invalid("cycle");
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const result: CanonicalValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid("sparse array or accessor");
        result.push(copy(descriptor.value, active));
      }
      for (const key of Reflect.ownKeys(value)) {
        if (key === "length" || (typeof key === "string" && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length)) continue;
        invalid("array property");
      }
      return Object.freeze(result);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalid("non-plain object");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result: Record<string, CanonicalValue> = Object.create(null) as Record<string, CanonicalValue>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") invalid("symbol");
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) invalid("non-enumerable property or accessor");
      result[key] = copy(descriptor.value, active);
    }
    return Object.freeze(result);
  } finally {
    active.delete(value);
  }
}

function invalid(reason: string): never {
  throwSimulationError(ErrorCodes.INVALID_RUN_INPUT, { reason });
}

/** UTF-8 JSON with lexicographically sorted UTF-16 property names. */
export function canonicalEncode(value: CanonicalValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalEncode).join(",")}]`;
  const object = value as { readonly [key: string]: CanonicalValue };
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalEncode(object[key]!)}`).join(",")}}`;
}

/** A synchronous, dependency-free SHA-256 digest for browser and worker use. */
export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const paddedLength = ((bytes.length + 9 + 63) >> 6) << 6;
  const message = new Uint8Array(paddedLength);
  message.set(bytes); message[bytes.length] = 0x80;
  const view = new DataView(message.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const w = new Uint32Array(64);
  for (let offset = 0; offset < message.length; offset += 64) {
    for (let i=0;i<16;i++) w[i] = view.getUint32(offset + i*4);
    for (let i=16;i<64;i++) { const a=w[i-15]!, b=w[i-2]!; w[i]=(((a>>>7)|(a<<25))^((a>>>18)|(a<<14))^(a>>>3)) + w[i-16]! + (((b>>>17)|(b<<15))^((b>>>19)|(b<<13))^(b>>>10)) + w[i-7]!; }
    let a=h[0]!, b=h[1]!, c=h[2]!, d=h[3]!, e=h[4]!, f=h[5]!, g=h[6]!, hh=h[7]!;
    for (let i=0;i<64;i++) { const s1=((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7)); const choice=(e&f)^((~e)&g); const t1=(hh+s1+choice+k[i]!+w[i]!)>>>0; const s0=((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10)); const majority=(a&b)^(a&c)^(b&c); hh=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+s0+majority)>>>0; }
    h[0]=(h[0]!+a)>>>0; h[1]=(h[1]!+b)>>>0; h[2]=(h[2]!+c)>>>0; h[3]=(h[3]!+d)>>>0; h[4]=(h[4]!+e)>>>0; h[5]=(h[5]!+f)>>>0; h[6]=(h[6]!+g)>>>0; h[7]=(h[7]!+hh)>>>0;
  }
  return Array.from(h, word => word.toString(16).padStart(8, "0")).join("");
}

export function fingerprintRunInputs(inputs: RunInputs): RunId {
  // Copy first: unsupported values fail before any caller can observe an ID.
  return `run:${sha256Hex(canonicalEncode(canonicalCopy(inputs)))}`;
}
