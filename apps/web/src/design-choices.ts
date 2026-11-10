import type { CanonicalValue, LessonOverlayPolicy, LessonParameter, ParameterOverride, ScenarioDiagnostic } from "@distlab/contracts";

/**
 * Design choices model (ADR-004 parameters, issue #95). Pure: it reads lesson
 * policies as data and maps panel input to `ParameterOverride` values. It never
 * resolves a target, never applies an overlay, and never sends a command. The
 * worker validates the overrides against its own copy of the policy on load.
 */

/** Presentation copy, keyed by parameter key. It is UI data, not part of the policy contract. */
export interface ChoiceCopy {
  readonly label: string;
  /** One line on what the switch changes. It makes no claim about the outcome. */
  readonly hint: string;
}

const copy: Readonly<Record<string, ChoiceCopy>> = {
  idempotency: { label: "Idempotency key", hint: "Payments stores each result by idempotency key and returns it for a repeated key." },
  timeout: { label: "Client timeout", hint: "Virtual time the client waits for a Payments response before it gives up or retries." },
  compensation: { label: "Compensation", hint: "Orders undoes completed saga steps when a later step fails." },
  outbox: { label: "Transactional outbox", hint: "Payments records the event in the same commit as the payment and publishes it later." },
  "consumer-idempotency": { label: "Idempotent consumer", hint: "Notifications records each event ID in an inbox and skips one it has seen." },
  "circuit-breaker": { label: "Circuit breaker", hint: "Payments stops calling the risk provider after repeated failures and probes it later." },
  "decoupled-confirmation": { label: "Confirm before notifying", hint: "Orders confirms the order at checkout instead of waiting for NotificationSent." },
  "max-attempts": { label: "Notification delivery attempts", hint: "How many times the bus delivers OrderPlaced before it moves the message to the dead-letter queue." },
  "optimistic-concurrency": { label: "Optimistic concurrency", hint: "Inventory checks the stock and writes the reservation in one transaction, so the database rejects a commit whose stock version changed since it was read." },
  "cache-invalidation": { label: "Invalidate cache on price change", hint: "Catalog deletes the cached price when the back office changes it, instead of letting it live until its TTL ends." },
};

/**
 * Copy for one lesson where a key means something different there. Reliable Checkout (#97) puts
 * the outbox in Orders and adds payment retries.
 */
const lessonCopy: Readonly<Record<string, Readonly<Record<string, ChoiceCopy>>>> = {
  "reliable-checkout@1": {
    retries: { label: "Payment retries", hint: "How many times Payments repeats an authorization that timed out." },
    idempotency: { label: "Idempotency key", hint: "Payments sends the order ID as an idempotency key; the processor answers a repeated key with the authorization it already holds." },
    compensation: { label: "Compensation", hint: "Orders voids the payment and releases the inventory when a checkout step fails, then cancels the order." },
    outbox: { label: "Transactional outbox", hint: "Orders records OrderConfirmed in the same commit as the confirmation and publishes it from a later relay." },
  },
};

/** The copy for a parameter key, in `lesson` (a packaged scenario name) when that lesson words it differently. */
export function choiceCopy(key: string, lesson?: string): ChoiceCopy {
  return (lesson ? lessonCopy[lesson]?.[key] : undefined) ?? copy[key] ?? { label: key, hint: "" };
}

/** Every declared parameter, with the value the draft gives it (its default when absent). */
export function choiceValues(policy: LessonOverlayPolicy, overrides: readonly ParameterOverride[]): ReadonlyMap<string, CanonicalValue> {
  return new Map(policy.parameters.map(parameter => [parameter.key, overrides.find(item => item.key === parameter.key)?.value ?? parameter.domain.default]));
}

/**
 * Sets one value and returns the overrides in the worker's normalized form:
 * sorted by key, with defaults removed. A draft that equals the applied overlay
 * therefore compares equal to it.
 */
export function setChoice(policy: LessonOverlayPolicy, overrides: readonly ParameterOverride[], key: string, value: CanonicalValue): readonly ParameterOverride[] {
  const values = new Map(choiceValues(policy, overrides));
  values.set(key, value);
  return policy.parameters
    .filter(parameter => values.get(parameter.key) !== parameter.domain.default)
    .map(parameter => ({ key: parameter.key, value: values.get(parameter.key)! }))
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}

export function sameChoices(left: readonly ParameterOverride[], right: readonly ParameterOverride[]): boolean {
  return left.length === right.length && left.every((item, index) => item.key === right[index]!.key && item.value === right[index]!.value);
}

/** Reads an integer field. The worker checks the same domain again; this only keeps an invalid draft from being applied. */
export function readInteger(text: string, parameter: LessonParameter): { readonly value?: number; readonly error?: string } {
  const domain = parameter.domain;
  if (domain.type !== "integer") return { error: "This choice is not a number." };
  const trimmed = text.trim();
  const value = /^-?\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < domain.minimum || value > domain.maximum) return { error: `Enter a whole number from ${domain.minimum} to ${domain.maximum}.` };
  return { value };
}

export function formatChoice(value: CanonicalValue): string {
  return value === true ? "on" : value === false ? "off" : String(value);
}

/** The run header form of the applied overrides, for example `idempotency=on · timeout=40`. */
export function describeChoices(overrides: readonly ParameterOverride[]): string {
  return overrides.map(item => `${item.key}=${formatChoice(item.value)}`).join(" · ");
}

const diagnosticText: Readonly<Record<string, string>> = {
  UNKNOWN_PARAMETER: "This lesson does not offer this choice.",
  PARAMETER_VALUE: "This value is outside the allowed range.",
  DUPLICATE: "This choice appears twice.",
  REQUIRED: "This value is required.",
  TYPE: "This value has the wrong type.",
};

/** Places worker diagnostics whose paths point into `/parameters` on the choice they name. */
export function placeChoiceDiagnostics(diagnostics: readonly ScenarioDiagnostic[], overrides: readonly ParameterOverride[]): ReadonlyMap<string, string> {
  const placed = new Map<string, string>();
  for (const item of diagnostics) {
    const match = /^\/parameters\/(\d+)(?:\/|$)/.exec(item.path);
    const override = match ? overrides[Number(match[1])] : undefined;
    if (override) placed.set(override.key, `${diagnosticText[item.code] ?? "This value is not valid."} (${item.code})`);
  }
  return placed;
}

/** True for a diagnostic that belongs to the design choices rather than to a student fault. */
export function isChoiceDiagnostic(diagnostic: ScenarioDiagnostic): boolean {
  return diagnostic.path === "/parameters" || diagnostic.path.startsWith("/parameters/");
}
