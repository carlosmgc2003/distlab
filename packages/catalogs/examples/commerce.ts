import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { commerceAssessment, commerceCatalog, commerceLessonNames, commerceScenario } from "@distlab/catalogs";
import type { CommerceLessonName } from "@distlab/catalogs";
import { compareExports, DeterministicScenarioEngine, openHarness } from "@distlab/scenario";

const [name, ...flags] = process.argv.slice(2);
if (!commerceLessonNames.includes(name as CommerceLessonName) || flags.some(flag => !["--json", "--step", "--replay"].includes(flag)) || (flags.includes("--json") && flags.includes("--step"))) {
  console.error(`Usage: npm run lesson -- <name> [--json | --step] [--replay]\nLessons:\n${commerceLessonNames.join("\n")}`);
  process.exitCode = 1;
} else {
  const engine = new DeterministicScenarioEngine({ catalog: commerceCatalog, assessment: commerceAssessment });
  const session = openHarness(engine.create(commerceScenario(name as CommerceLessonName)));
  let cursor = 0;
  const timeline = () => {
    const history = session.inspect().history.observations;
    for (const event of history.slice(cursor)) {
      if (event.type === "runtime.log" || /fault\.|network\.(request.sent|request.timedout|response.dropped)|message\.(published|delivered)|database.transaction.committed|external.effect.committed/.test(event.type)) {
        console.log(`t=${event.time} ${event.source} ${event.type} ${JSON.stringify(event.data)}`);
      }
    }
    cursor = history.length;
  };
  if (flags.includes("--step")) {
    const terminal = createInterface({ input: stdin, output: stdout });
    try {
      while (session.inspect().status !== "COMPLETED") {
        const command = (await terminal.question("[enter] step | run | state | reset | quit > ")).trim();
        if (command === "quit") break;
        if (command === "state") { console.log(JSON.stringify(session.inspect().state, null, 2)); continue; }
        if (command === "reset") { await session.reset(); cursor = 0; continue; }
        if (command === "run") await session.run();
        else if (command === "") await session.step();
        else continue;
        timeline();
      }
    } finally { terminal.close(); }
  } else {
    await session.run();
    if (!flags.includes("--json")) timeline();
  }
  const result = session.inspect();
  if (flags.includes("--replay") && result.status === "COMPLETED") {
    await session.reset();
    await session.run();
    if (!compareExports(result, session.inspect())) throw new Error("Replay mismatch");
    if (!flags.includes("--json")) console.log(`Replay verified: ${result.digest}`);
  }
  console.log(JSON.stringify(flags.includes("--json") ? result : { status: result.status, time: result.time, state: result.state, results: result.results, digest: result.digest }, null, 2));
  if (result.status === "FAILED" || result.results.some(r => r.status === "FAIL")) process.exitCode = 1;
}
