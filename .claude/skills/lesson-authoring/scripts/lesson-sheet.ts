/**
 * Lesson sheet: everything a student reads and sees for one packaged lesson, beside what the run
 * actually recorded, so that copy, configuration, and presentation can be reviewed against facts.
 *
 * Read-only. It builds nothing, edits nothing, and adds no simulation semantics: it runs the packaged
 * document through the same engine the catalog tests use, and renders text with the browser's own pure
 * modules (lesson copy, check labels, design-choice copy, component names, Story milestones).
 *
 * Usage, from the repository root (the packages must be built):
 *
 *   npm run build:packages --silent
 *   node --experimental-strip-types .claude/skills/lesson-authoring/scripts/lesson-sheet.ts --list
 *   node --experimental-strip-types .claude/skills/lesson-authoring/scripts/lesson-sheet.ts retry-unsafe
 *   node --experimental-strip-types .claude/skills/lesson-authoring/scripts/lesson-sheet.ts retry-unsafe --set timeout=40
 *   node --experimental-strip-types .claude/skills/lesson-authoring/scripts/lesson-sheet.ts notifications-dlq --matrix
 *   node --experimental-strip-types .claude/skills/lesson-authoring/scripts/lesson-sheet.ts cqrs-delayed \
 *     --fault '{"point":"message.delivery","source":"orders","target":"reporting","name":"OrderUpdated","effect":{"kind":"drop"}}'
 *   node --experimental-strip-types .claude/skills/lesson-authoring/scripts/lesson-sheet.ts cqrs-delayed \
 *     --fault '{"kind":"crash","target":"reporting","at":20,"restart":5}'
 *
 * Options:
 *   --list            every packaged lesson with its topic and Compare partner
 *   --set key=value   apply a design choice (repeatable); the sheet then describes that run
 *   --fault '<json>'  add a student fault (repeatable), as the Experiment drawer's Faults section would. A fault rule
 *                     has `point` and `effect` (and usually `source`, `target`, `name`); `id`, `from`, `probability`,
 *                     and `maxApplications` default to student-N, 0, 1, and 1. Effects: {"kind":"drop"},
 *                     {"kind":"delay","duration":30}, {"kind":"disconnect"}, {"kind":"fail"},
 *                     {"kind":"duplicate","additionalCopies":1,"spacing":3}. A scheduled fault has `kind`
 *                     ("crash" or "external-availability" with `state`), `target`, `at`, and for a crash an
 *                     optional `restart` after that many virtual milliseconds. The lesson's policy decides what
 *                     is allowed, exactly as in the browser.
 *   --matrix          run every combination of the design choices' domain edges and defaults, and print the verdicts
 *   --sweep key       run every value of one integer design choice (other choices as given by --set) and print
 *                     the ranges over which the outcome stays the same: where the story changes
 *   --lang es         render Story labels and the matrix in another interface language (default en)
 *   --story N         print at most N Story milestones (default: all)
 */
import type { CanonicalValue, LessonOverlayPolicy, LessonParameter, Observation, ScenarioDefinition } from "@distlab/contracts";
import { checkoutAssessment, checkoutCatalog, commerceAssessment, commerceCatalog } from "@distlab/catalogs";
import { composeOverlay, DeterministicScenarioEngine, openHarness } from "@distlab/scenario";
import { byCode, messages } from "../../../../apps/web/src/i18n/catalog.ts";
import type { Messages } from "../../../../apps/web/src/i18n/catalog.ts";
import { isLocale } from "../../../../apps/web/src/i18n/locales.ts";
import { lessonDescription, lessonTitle, scenarios } from "../../../../apps/web/src/scenarios.ts";
import type { PackagedScenario } from "../../../../apps/web/src/scenarios.ts";
import { lessonClassification } from "../../../../apps/web/src/lesson-topics.ts";
import { checkLabel } from "../../../../apps/web/src/lesson-checks.ts";
import { storyMilestones } from "../../../../apps/web/src/story-timeline.ts";

const args = process.argv.slice(2);
const option = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const lessonId = args.find((arg, index) => !arg.startsWith("--") && !["--set", "--fault", "--sweep", "--lang", "--story"].includes(args[index - 1] ?? ""));
const sets = args.flatMap((arg, index) => arg === "--set" && args[index + 1] ? [args[index + 1]!] : []);
const faultTexts = args.flatMap((arg, index) => arg === "--fault" && args[index + 1] ? [args[index + 1]!] : []);
const lang = option("--lang") ?? "en";
const storyLimit = option("--story") === undefined ? Infinity : Number(option("--story"));

const en = messages("en");
const es = messages("es");
const shown: Messages = isLocale(lang) ? messages(lang) : en;
const out: string[] = [];
const say = (line = "") => out.push(line);
const json = (value: unknown) => JSON.stringify(value);
const cell = (text: string) => text.replaceAll("|", "\\|");

interface StudentFaults { readonly faults: readonly Record<string, unknown>[]; readonly scheduledFaults: readonly Record<string, unknown>[] }
const NO_FAULTS: StudentFaults = { faults: [], scheduledFaults: [] };

const usage = () => {
  console.error("Usage: node --experimental-strip-types .claude/skills/lesson-authoring/scripts/lesson-sheet.ts <lesson> [--set key=value]... [--fault '<json>']... [--matrix] [--sweep key] [--lang es] [--story N]\n       ... lesson-sheet.ts --list");
  process.exitCode = 1;
};

if (args.includes("--list")) {
  say("| Lesson | Topic | Compare | Title |");
  say("| --- | --- | --- | --- |");
  for (const lesson of scenarios) say(`| \`${lesson.id}\` | ${lessonClassification(lesson.id)?.topic ?? "—"} | ${lesson.compare ? `\`${lesson.compare}\`` : "—"} | ${cell(lessonTitle(lesson, en))} |`);
  console.log(out.join("\n"));
} else {
  const lesson = scenarios.find(item => item.id === lessonId);
  if (!lesson) {
    if (lessonId) console.error(`Unknown lesson "${lessonId}". Use --list.`);
    usage();
  } else await sheet(lesson).catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}

function engineOf(lesson: PackagedScenario) {
  return lesson.family === "commerce"
    ? { engine: new DeterministicScenarioEngine({ catalog: commerceCatalog, assessment: commerceAssessment }), catalog: commerceCatalog }
    : { engine: new DeterministicScenarioEngine({ catalog: checkoutCatalog, assessment: checkoutAssessment }), catalog: checkoutCatalog };
}

/** Reads `--fault` values into the overlay's two lists, filling the defaults the Faults section fills. */
function parseFaults(texts: readonly string[]): StudentFaults {
  const faults: Record<string, unknown>[] = [], scheduledFaults: Record<string, unknown>[] = [];
  texts.forEach((text, index) => {
    let input: Record<string, unknown>;
    try { input = JSON.parse(text) as Record<string, unknown>; } catch { throw new Error(`--fault ${text}: not JSON.`); }
    const id = typeof input.id === "string" ? input.id : `student-${index + 1}`;
    if (typeof input.point === "string") faults.push({ from: 0, probability: 1, maxApplications: 1, ...input, id });
    else if (typeof input.kind === "string" && typeof input.target === "string" && typeof input.at === "number") {
      const { at, restart, ...fault } = input;
      scheduledFaults.push({ id, at, kind: "fault", fault: { ...fault, id: `${id}-fault` }, ...(typeof restart === "number" ? { restart: { after: restart } } : {}) });
    } else throw new Error(`--fault ${text}: a fault rule needs "point" and "effect"; a scheduled fault needs "kind", "target", and "at".`);
  });
  return { faults, scheduledFaults };
}

/** Runs the lesson with design-choice overrides and student faults, as one `load` with that overlay would. */
async function run(lesson: PackagedScenario, parameters: readonly { key: string; value: CanonicalValue }[], student: StudentFaults = NO_FAULTS) {
  const { engine, catalog } = engineOf(lesson);
  const packaged = lesson.scenario as CanonicalValue;
  let document = packaged;
  if (parameters.length || student.faults.length || student.scheduledFaults.length) {
    const overlay = { version: 1, parameters: [...parameters], faults: student.faults, scheduledFaults: student.scheduledFaults };
    const composed = composeOverlay(packaged, lesson.policy, overlay as unknown as CanonicalValue, value => engine.validate(value), catalog);
    if (!composed.ok) throw new Error(`The overlay was rejected (${composed.code}): ${json(composed.diagnostics)}`);
    document = composed.document;
  }
  const diagnostics = engine.validate(document);
  if (diagnostics.length) throw new Error(`The document is invalid: ${json(diagnostics)}`);
  const session = openHarness(engine.create(document));
  await session.run();
  return { document: document as unknown as ScenarioDefinition, result: session.inspect() };
}

function parseSet(policy: LessonOverlayPolicy, text: string): { key: string; value: CanonicalValue } {
  const [key, raw] = text.split("=", 2) as [string, string | undefined];
  const parameter = policy.parameters.find(item => item.key === key);
  if (!parameter || raw === undefined) throw new Error(`--set ${text}: this lesson declares ${policy.parameters.map(item => item.key).join(", ") || "no design choices"}.`);
  const value = parameter.domain.type === "boolean" ? raw === "true" || raw === "on" : parameter.domain.type === "integer" ? Number(raw) : raw;
  return { key, value };
}

function describeDomain(parameter: LessonParameter): string {
  const domain = parameter.domain;
  return domain.type === "boolean" ? `boolean, default ${domain.default}`
    : domain.type === "integer" ? `integer ${domain.minimum}–${domain.maximum}, default ${domain.default}`
    : `choice ${json((domain as { values?: unknown }).values ?? [])}, default ${json(domain.default)}`;
}

/** The values worth running for one parameter: both booleans, an integer's edges and default, every choice. */
function edges(parameter: LessonParameter): readonly CanonicalValue[] {
  const domain = parameter.domain;
  if (domain.type === "boolean") return [false, true];
  if (domain.type === "integer") return [...new Set([domain.minimum, domain.default, domain.maximum])];
  return ((domain as { values?: readonly string[] }).values ?? [domain.default as string]);
}

/** Paths at which two JSON values differ. */
function differences(left: unknown, right: unknown, path = ""): string[] {
  if (json(left) === json(right)) return [];
  const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
  if (!isObject(left) || !isObject(right) || Array.isArray(left) !== Array.isArray(right)) return [`${path || "/"}: ${json(left)} → ${json(right)}`];
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(key => differences(left[key], right[key], `${path}/${key}`));
}

function verdict(kind: "invariant" | "expectation" | undefined, status: string): string {
  if (kind === "invariant") return status === "PASS" ? "HOLDS" : status === "FAIL" ? "VIOLATED" : status;
  if (kind === "expectation") return status === "PASS" ? "reproduced" : status === "FAIL" ? "not reproduced" : status;
  return status;
}

async function sheet(lesson: PackagedScenario) {
  const findings: string[] = [];
  const overrides = sets.map(text => parseSet(lesson.policy, text));
  const student = parseFaults(faultTexts);
  const changed = overrides.length + student.faults.length + student.scheduledFaults.length > 0;
  const { document, result } = await run(lesson, overrides, student);
  const commerce = lesson.family === "commerce";
  const checks = lesson.family === "commerce" ? lesson.checks : [];
  const classification = lessonClassification(lesson.id);
  const observations = result.history.observations as readonly Observation[];

  say(`# Lesson sheet: ${lesson.id}`);
  say();
  say(`Document \`${document.name}\`, seed \`${document.seed}\`, catalog \`${lesson.catalog.id}@${lesson.catalog.version}\`.${overrides.length ? ` **Design choices applied: ${overrides.map(item => `${item.key}=${item.value}`).join(", ")}.**` : ""}`);
  for (const fault of [...student.faults, ...student.scheduledFaults]) say(`\n**Student fault applied:** \`${json(fault)}\``);
  if (changed) say("\nThis sheet describes the changed experiment. The checks and the copy are still the packaged lesson's.");
  say();

  say("## What the student reads");
  say();
  say("| | English | Spanish |");
  say("| --- | --- | --- |");
  say(`| Title | ${cell(lessonTitle(lesson, en))} | ${cell(lessonTitle(lesson, es))} |`);
  say(`| ① Goal and chooser card | ${cell(lessonDescription(lesson, en))} | ${cell(lessonDescription(lesson, es))} |`);
  if (classification) {
    say(`| Topic | ${cell(en.lessons.topics[classification.topic].title)} | ${cell(es.lessons.topics[classification.topic].title)} |`);
    say(`| Concepts | ${classification.concepts.map(id => en.lessons.concepts[id]).join(", ")} | ${classification.concepts.map(id => es.lessons.concepts[id]).join(", ")} |`);
  } else findings.push("The lesson has no topic or concepts in `apps/web/src/lesson-topics.ts`.");
  say(`| Compare | ${lesson.compare ? `\`${lesson.compare}\`` : "none"} | |`);
  say();
  if (lessonTitle(lesson, es) === lessonTitle(lesson, en)) findings.push("The Spanish title equals the English one.");
  if (lessonDescription(lesson, es) === lessonDescription(lesson, en)) findings.push("The Spanish description equals the English one.");

  say("## Architecture");
  say();
  say("| Component | Display name (en / es) | Kind | Model | Configuration |");
  say("| --- | --- | --- | --- | --- |");
  for (const component of document.architecture.components) {
    const name = lesson.family === "commerce" ? byCode(en.components.names, component.id) : "(checkout-display.ts)";
    const spanish = lesson.family === "commerce" ? byCode(es.components.names, component.id) : "";
    if (lesson.family === "commerce" && name === undefined) findings.push(`Component \`${component.id}\` has no display name in \`i18n/en/components.ts\`: the graph, Story lanes, and narration show the raw ID.`);
    say(`| \`${component.id}\` | ${name ?? "**missing**"}${spanish ? ` / ${spanish}` : ""} | ${component.kind} | \`${component.model}@${component.version}\` | \`${json(component.configuration ?? {})}\` |`);
  }
  say();
  for (const link of document.architecture.links) say(`- Link \`${link.source}\` → \`${link.target}\`: \`${json(link.policy)}\``);
  for (const database of document.architecture.databases) say(`- Database owned by \`${database.owner}\`: tables ${database.tables.map(table => `\`${table.name}\``).join(", ")}`);
  for (const store of document.architecture.stores) say(`- KeyValueStore owned by \`${store.owner}\``);
  for (const destination of document.architecture.destinations) say(`- Destination \`${destination.id}\`: \`${json(destination)}\``);
  for (const subscription of document.architecture.subscriptions) say(`- Subscription \`${subscription.destination}\` → \`${subscription.consumer}\``);
  const drawn = document.architecture.components.length + document.architecture.destinations.length;
  say();
  say(`The graph draws ${drawn} component and destination nodes plus ${document.architecture.databases.length + document.architecture.stores.length} owned resources.`);
  if (drawn > 6) findings.push(`The graph has ${drawn} component and destination nodes. Look at it at 1366×768 with the Lesson panel open (\`e2e/graph-legibility.spec.ts\`).`);
  say();

  say("## Story inputs");
  say();
  say("Packaged faults:");
  if (!document.faults.length) say("- none");
  for (const fault of document.faults) say(`- \`${json(fault)}\``);
  say();
  say("Workload:");
  for (const action of document.actions) say(`- \`${json(action)}\``);
  say();

  say("## Design choices and allowed faults");
  say();
  if (!lesson.policy.parameters.length) say("The lesson declares no design choices.");
  else {
    say("| Key | Domain | Targets | Label (en / es) | Hint (en) |");
    say("| --- | --- | --- | --- | --- |");
    for (const parameter of lesson.policy.parameters) {
      const own = (m: Messages) => byCode<Record<string, { label: string; hint: string }>>(m.designChoices.lessonChoices as never, document.name)?.[parameter.key]
        ?? byCode<{ label: string; hint: string }>(m.designChoices.choices as never, parameter.key);
      const english = own(en), spanish = own(es);
      if (!english) findings.push(`Design choice \`${parameter.key}\` has no label or hint in \`i18n/en/designChoices.ts\`: the drawer shows the raw key.`);
      say(`| \`${parameter.key}\` | ${describeDomain(parameter)} | \`${json(parameter.targets)}\` | ${cell(english?.label ?? "**missing**")} / ${cell(spanish?.label ?? "**missing**")} | ${cell(english?.hint ?? "")} |`);
    }
  }
  say();
  say(`Student faults (at most ${lesson.policy.faults.maxEntries}): rules ${lesson.policy.faults.rules.map(rule => `${rule.point} [${rule.effects.join(", ")}]`).join("; ") || "none"}; scheduled ${lesson.policy.faults.scheduled.join(", ") || "none"}.`);
  if (lesson.policy.architecture) say(`Architecture allowance: \`${json(lesson.policy.architecture)}\``);
  say();

  say("## The run");
  say();
  const milestones = storyMilestones(observations, shown);
  const counts = new Map<string, number>();
  for (const milestone of milestones) counts.set(milestone.kind, (counts.get(milestone.kind) ?? 0) + 1);
  say(`Status ${result.status} at t=${result.time}. ${milestones.length} Story milestones from ${observations.length} recorded observations (${[...counts].map(([kind, count]) => `${kind} ${count}`).join(", ")}).`);
  say();
  if (result.status !== "COMPLETED") findings.push(`The run ended ${result.status}, not COMPLETED.`);
  if (commerce && !counts.get("log")) findings.push("No business log is a Story milestone: the story shows transport and storage records only. Consider a `ctx.log.write` at the decision the lesson is about.");
  say("Story milestones, as the Story table lists them:");
  say();
  say("```text");
  for (const milestone of milestones.slice(0, storyLimit)) {
    const observation = milestone.observation;
    say(`t=${String(observation.time).padStart(3)} ${milestone.shape} ${milestone.lane.padEnd(14)} ${milestone.label}`);
  }
  if (milestones.length > storyLimit) say(`… ${milestones.length - storyLimit} more`);
  say("```");
  say();
  const logs = observations.filter(observation => observation.type === "runtime.log").map(observation => `t=${observation.time} ${observation.source} ${json((observation.data as Record<string, CanonicalValue>).message)} ${json((observation.data as Record<string, CanonicalValue>).data)}`);
  if (logs.length) {
    say("Business logs (the models' own vocabulary):");
    say();
    say("```text");
    for (const line of logs) say(line);
    say("```");
    say();
  }

  say("## Lesson checks");
  say();
  const deadlines: string[] = [];
  say("| Kind | Check | Mode | Verdict | Label (en) | Label (es) |");
  say("| --- | --- | --- | --- | --- | --- |");
  for (const assertion of document.assertions) {
    const check = checks.find(item => item.id === assertion.id);
    const stored = result.results.find(item => item.id === assertion.id);
    const mode = assertion.mode === "always" ? "always" : assertion.mode === "at" ? `at t=${(assertion as { at?: number }).at}` : `${assertion.mode} by t=${(assertion as { deadline?: number }).deadline}`;
    const english = check ? check.label : "(checkout: no classification)";
    const spanish = check ? checkLabel(lesson.id, check.id, check.label, es) : "";
    if (check && spanish === check.label) findings.push(`Check \`${check.id}\` has no Spanish label in \`i18n/es/content.ts\`.`);
    if (check?.kind === "expectation" && stored?.status !== "PASS" && !changed) findings.push(`Scenario expectation \`${check.id}\` is ${stored?.status} in the packaged run: the lesson does not reproduce its own setup.`);
    if (check?.kind === "invariant" && assertion.mode !== "always") deadlines.push(check.id);
    say(`| ${check?.kind ?? "—"} | \`${assertion.id}\` | ${mode} | **${verdict(check?.kind, stored?.status ?? "PENDING")}** at t=${stored?.time} | ${cell(english)} | ${cell(spanish)} |`);
  }
  say();
  const invariants = checks.filter(check => check.kind === "invariant");
  const violated = invariants.filter(check => result.results.find(item => item.id === check.id)?.status === "FAIL");
  if (deadlines.length) {
    say(`Checked once, at a stated time: ${deadlines.map(id => `\`${id}\``).join(", ")}. That is right for a property the design must *reach* (a failed order is cancelled). A property that *forbids* a state (a second charge) must use \`always\`, or a design choice or a student fault can move the violation past the check time (#163).`);
    say();
  }
  say(`Outcome line: ${violated.length ? en.commerceLesson.outcome.violated({ violated: violated.length, total: invariants.length }) : invariants.length ? en.commerceLesson.outcome.allHold(invariants.length) : "(no classified invariants)"}`);
  say();

  // Times the copy names, against times the run recorded.
  const times = new Set(observations.map(observation => Number(observation.time)));
  const copy = [lessonDescription(lesson, en), ...checks.map(check => check.label)].join(" ");
  const named = [...new Set([...copy.matchAll(/\bt=(\d+)/g)].map(match => Number(match[1])))];
  const unrecorded = named.filter(time => !times.has(time));
  if (unrecorded.length && !changed) findings.push(`The description or a check label names ${unrecorded.map(time => `t=${time}`).join(", ")}, and the packaged run records nothing at ${unrecorded.length > 1 ? "those times" : "that time"}. Check each by hand: a check time is legitimate, a stale number is not.`);

  const partner = scenarios.find(item => item.id === lesson.compare);
  if (partner) {
    say(`## Against its Compare partner, \`${partner.id}\``);
    say();
    const strip = (scenario: unknown) => { const { name: _name, assertions: _assertions, ...rest } = scenario as Record<string, unknown>; return rest; };
    const delta = differences(strip(lesson.scenario), strip(partner.scenario));
    say("Differences in the documents, leaving out the name and the assertions:");
    say();
    for (const line of delta) say(`- \`${line}\``);
    if (!delta.length) { say("- none"); findings.push(`The document equals \`${partner.id}\` apart from name and assertions: the pair compares nothing.`); }
    if (commerce && delta.some(line => line.startsWith("/faults") || line.startsWith("/actions") || line.startsWith("/seed"))) findings.push(`The pair differs in faults, workload, or seed. A pair should differ only in the design it compares, or the comparison is not fair.`);
    say();
    const other = await run(partner, []);
    const partnerChecks = partner.family === "commerce" ? partner.checks : [];
    say("| Invariant | This lesson | Partner |");
    say("| --- | --- | --- |");
    let contrast = false;
    for (const check of invariants) {
      const mine = verdict("invariant", result.results.find(item => item.id === check.id)?.status ?? "PENDING");
      const theirs = partnerChecks.some(item => item.id === check.id) ? verdict("invariant", other.result.results.find(item => item.id === check.id)?.status ?? "PENDING") : "(not stated)";
      if (mine !== theirs) contrast = true;
      say(`| \`${check.id}\` | ${mine} | ${theirs} |`);
    }
    say();
    if (commerce && !contrast && !changed) findings.push(`No invariant reads differently in \`${partner.id}\`: Compare shows no VIOLATED → HOLDS contrast.`);
  }

  if (args.includes("--matrix")) {
    say("## Design-choice matrix");
    say();
    const parameters = lesson.policy.parameters;
    let combinations: { key: string; value: CanonicalValue }[][] = [[]];
    for (const parameter of parameters) combinations = combinations.flatMap(combination => edges(parameter).map(value => [...combination, { key: parameter.key, value }]));
    if (!parameters.length) say("The lesson declares no design choices.");
    else if (combinations.length > 64) say(`${combinations.length} combinations: too many to print. Use \`--set\` for the ones you care about.`);
    else {
      say(`| ${parameters.map(parameter => `\`${parameter.key}\``).join(" | ")} | End | ${invariants.map(check => `\`${check.id}\``).join(" | ")} | Setup reproduced |`);
      say(`| ${parameters.map(() => "---").join(" | ")} | --- | ${invariants.map(() => "---").join(" | ")} | --- |`);
      const outcomes = new Set<string>();
      for (const combination of combinations) {
        const defaults = combination.filter(item => item.value !== parameters.find(parameter => parameter.key === item.key)!.domain.default);
        const outcome = await run(lesson, defaults);
        const cells = invariants.map(check => verdict("invariant", outcome.result.results.find(item => item.id === check.id)?.status ?? "PENDING"));
        const expectations = checks.filter(check => check.kind === "expectation");
        const reproduced = expectations.filter(check => outcome.result.results.find(item => item.id === check.id)?.status === "PASS").length;
        outcomes.add(cells.join());
        say(`| ${combination.map(item => String(item.value)).join(" | ")} | ${outcome.result.status} t=${outcome.result.time} | ${cells.join(" | ")} | ${reproduced} of ${expectations.length} |`);
      }
      say();
      if (outcomes.size === 1) findings.push("Every combination of design choices gives the same invariant verdicts: no choice changes what the student finds.");
    }
    say();
  }

  const sweepKey = option("--sweep");
  if (sweepKey !== undefined) {
    say(`## Sweep of \`${sweepKey}\``);
    say();
    const parameter = lesson.policy.parameters.find(item => item.key === sweepKey);
    if (!parameter || parameter.domain.type !== "integer") say(`\`${sweepKey}\` is not an integer design choice of this lesson.`);
    else {
      const { minimum, maximum } = parameter.domain;
      const fixed = overrides.filter(item => item.key !== sweepKey);
      say(`Every value from ${minimum} to ${maximum}${fixed.length ? `, with ${fixed.map(item => `${item.key}=${item.value}`).join(", ")}` : ""}. A row is a range of values with the same end status and verdicts; the end time is that of the range's first value.`);
      say();
      say(`| \`${sweepKey}\` | End | ${invariants.map(check => `\`${check.id}\``).join(" | ")} | Setup reproduced |`);
      say(`| --- | --- | ${invariants.map(() => "---").join(" | ")} | --- |`);
      const expectations = checks.filter(check => check.kind === "expectation");
      let range: { from: number; to: number; key: string; row: string } | undefined;
      const flush = () => { if (range) say(`| ${range.from === range.to ? range.from : `${range.from}–${range.to}`}${range.from <= Number(parameter.domain.default) && Number(parameter.domain.default) <= range.to ? " (default)" : ""} | ${range.row} |`); };
      for (let value = minimum; value <= maximum; value++) {
        const outcome = await run(lesson, value === parameter.domain.default ? fixed : [...fixed, { key: sweepKey, value }], student);
        const cells = invariants.map(check => verdict("invariant", outcome.result.results.find(item => item.id === check.id)?.status ?? "PENDING"));
        const reproduced = expectations.filter(check => outcome.result.results.find(item => item.id === check.id)?.status === "PASS").length;
        const key = [outcome.result.status, ...cells, reproduced].join();
        if (range && range.key === key) range.to = value;
        else { flush(); range = { from: value, to: value, key, row: `${outcome.result.status} t=${outcome.result.time} | ${cells.join(" | ")} | ${reproduced} of ${expectations.length}` }; }
      }
      flush();
    }
    say();
  }

  say("## Findings to check");
  say();
  if (!commerce) say("A checkout lesson follows `docs/spec/mvp-catalog-scenario.md`: its checks carry no invariant/expectation classification, and its pair compares a fault with no fault, so the pair and log checks are not applied.\n");
  if (!findings.length) say("None from the automatic checks. They cover wiring and consistency only; the teaching review is yours.");
  for (const finding of findings) say(`- ${finding}`);
  console.log(out.join("\n"));
}
