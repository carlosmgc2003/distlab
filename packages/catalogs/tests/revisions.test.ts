import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CanonicalValue, LessonOverlayPolicy } from "@distlab/contracts";
import { canonicalEncode } from "@distlab/kernel";
import {
  checkoutAssessment, checkoutCatalog, checkoutLesson, checkoutOverlayPolicy, commerceAssessment, commerceCatalog, commerceChecks, commerceLessonNames,
  commerceOverlayPolicy, commerceRevision, commerceScenario, normalCheckout, responseLostCheckout,
} from "@distlab/catalogs";
import type { LessonRevision } from "@distlab/catalogs";
import { DeterministicScenarioEngine, openHarness } from "@distlab/scenario";

// Lesson revisions: every packaged lesson carries its own version counter and the date of its last change.
// The fingerprints below make the pair trustworthy: a lesson whose recorded run, checks, or overlay policy
// changes must get a new revision and date in the same change.

interface Packaged {
  readonly id: string;
  readonly revision: LessonRevision;
  readonly document: CanonicalValue;
  /** Catalog data a student reads or that bounds what a student may change: check labels and kinds, lesson copy, the policy. */
  readonly data: CanonicalValue;
  readonly engine: DeterministicScenarioEngine;
}

const commerceEngine = new DeterministicScenarioEngine({ catalog: commerceCatalog, assessment: commerceAssessment });
const checkoutEngine = new DeterministicScenarioEngine({ catalog: checkoutCatalog, assessment: checkoutAssessment });
const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as CanonicalValue;
const checkout = (id: "normal" | "response-lost", document: CanonicalValue): Packaged => ({
  id, revision: { revision: checkoutLesson[id].revision, updated: checkoutLesson[id].updated }, document, engine: checkoutEngine,
  data: plain({ title: checkoutLesson[id].title, explanation: checkoutLesson[id].explanation, policy: checkoutOverlayPolicy(id) as LessonOverlayPolicy }),
});
const packaged: readonly Packaged[] = [
  checkout("normal", normalCheckout), checkout("response-lost", responseLostCheckout),
  ...commerceLessonNames.map(id => ({ id, revision: commerceRevision(id), document: commerceScenario(id), engine: commerceEngine, data: plain({ checks: commerceChecks(id), policy: commerceOverlayPolicy(id) }) })),
];

/** The digest of the lesson's packaged run with its catalog data, shortened. The run digest covers the document and the models' behavior. */
async function fingerprint(lesson: Packaged): Promise<string> {
  const session = openHarness(lesson.engine.create(lesson.document));
  await session.run();
  return createHash("sha256").update(session.inspect().digest).update(canonicalEncode(lesson.data)).digest("hex").slice(0, 16);
}

/**
 * The fingerprint each lesson had when its current revision was recorded.
 *
 * When this test fails for a lesson, the lesson changed. In the same change:
 * 1. raise its `revision` by one and set `updated` to the date of the change
 *    (`commerceRevisions` in src/commerce/scenarios.ts, or `checkoutLesson` in src/scenarios.ts);
 * 2. update its row in the "Lesson versions" table of docs/commerce-lessons.md;
 * 3. record the new revision and the fingerprint the failure prints here.
 * A change to its title, description, or guide section needs the same new revision, by hand: no fingerprint sees it.
 */
const recorded: Readonly<Record<string, { readonly revision: number; readonly fingerprint: string }>> = {
  "normal": { revision: 1, fingerprint: "a7d5136cd1d70209" },
  "response-lost": { revision: 1, fingerprint: "18f58f5162e1cacb" },
  "retry-unsafe": { revision: 1, fingerprint: "ef5166ea7a67b481" },
  "retry-idempotent": { revision: 1, fingerprint: "3f88d305cfe93b39" },
  "saga-uncompensated": { revision: 1, fingerprint: "e7332b1b6a11f4be" },
  "saga-compensated": { revision: 1, fingerprint: "e459f1789113caf2" },
  "dual-write": { revision: 1, fingerprint: "0cc09ee5a932616a" },
  "outbox-unsafe-consumer": { revision: 1, fingerprint: "aa14052409e835a2" },
  "outbox-idempotent": { revision: 1, fingerprint: "a8516720248c5561" },
  "outbox-notifications-gap": { revision: 1, fingerprint: "48a8951ecab457f7" },
  "cqrs-delayed": { revision: 1, fingerprint: "909d432bab4a810d" },
  "cascade-unprotected": { revision: 1, fingerprint: "8c9d1b05e0332a5f" },
  "cascade-breaker": { revision: 1, fingerprint: "6b383edce023341e" },
  "notifications-unbounded": { revision: 1, fingerprint: "d995d0ebaaa7bead" },
  "notifications-dlq": { revision: 1, fingerprint: "8d9c24b9614fca4d" },
  "cache-stale-price": { revision: 1, fingerprint: "1956ece982f9eb15" },
  "cache-invalidated": { revision: 1, fingerprint: "0a7c09426a2644e0" },
  "inventory-oversell": { revision: 1, fingerprint: "431f5e6b9c180ba3" },
  "inventory-optimistic": { revision: 1, fingerprint: "378f400b61283198" },
  "lease-unfenced": { revision: 1, fingerprint: "42207cedcd03a7b8" },
  "lease-fenced": { revision: 1, fingerprint: "9abb4b29219d1993" },
  "clock-last-write-wins": { revision: 1, fingerprint: "51006084d91bfd03" },
  "clock-lamport": { revision: 1, fingerprint: "ea564f47922bfafd" },
};

test("REV-1: every packaged lesson has a revision of 1 or more and a real calendar date", () => {
  assert.equal(packaged.length, 2 + commerceLessonNames.length);
  for (const { id, revision } of packaged) {
    assert.ok(Number.isSafeInteger(revision.revision) && revision.revision >= 1, `${id}: revision ${revision.revision}`);
    assert.match(revision.updated, /^\d{4}-\d{2}-\d{2}$/, `${id}: updated ${revision.updated}`);
    // A date such as 2026-02-31 parses to another day; the round trip rejects it.
    assert.equal(new Date(`${revision.updated}T00:00:00Z`).toISOString().slice(0, 10), revision.updated, `${id}: ${revision.updated} is not a calendar date`);
  }
});

test("REV-2: a lesson whose recorded run, checks, or policy changed has a new revision", async () => {
  assert.deepEqual(Object.keys(recorded).sort(), packaged.map(lesson => lesson.id).sort(), "one recorded fingerprint per packaged lesson");
  for (const lesson of packaged) {
    const actual = await fingerprint(lesson);
    const known = recorded[lesson.id]!;
    if (actual === known.fingerprint) {
      assert.equal(lesson.revision.revision, known.revision, `${lesson.id}: its revision changed and the lesson did not. Record revision ${lesson.revision.revision} here only together with a changed lesson.`);
    } else {
      assert.ok(lesson.revision.revision > known.revision,
        `${lesson.id} changed (fingerprint ${actual}, recorded ${known.fingerprint}) and is still revision ${known.revision}. Raise its revision and its updated date, update docs/commerce-lessons.md, then record { revision: ${known.revision + 1}, fingerprint: "${actual}" } in tests/revisions.test.ts.`);
      assert.fail(`${lesson.id} has a new revision ${lesson.revision.revision}: record { revision: ${lesson.revision.revision}, fingerprint: "${actual}" } in tests/revisions.test.ts.`);
    }
  }
});

test("REV-3: the Lesson versions table of the guide states every lesson's revision and date", () => {
  const guide = readFileSync(fileURLToPath(new URL("../../../docs/commerce-lessons.md", import.meta.url)), "utf8");
  const start = guide.indexOf("## Lesson versions");
  assert.ok(start >= 0, "docs/commerce-lessons.md has a Lesson versions section");
  const next = guide.indexOf("\n## ", start + 1);
  const section = guide.slice(start, next < 0 ? undefined : next);
  const rows = [...section.matchAll(/^\| `([a-z0-9-]+)` \| (\d+) \| (\d{4}-\d{2}-\d{2}) \|$/gm)].map(match => ({ id: match[1]!, revision: Number(match[2]), updated: match[3]! }));
  assert.deepEqual(rows, packaged.map(lesson => ({ id: lesson.id, ...lesson.revision })));
});
