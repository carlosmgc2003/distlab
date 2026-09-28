import type { ScenarioAssessment, ScenarioCatalog } from "@distlab/scenario";
import { clientModel, record, text } from "./common.js";
import { retryModel } from "./retry.js";
import { carrierModel, sagaModel, sagaResourceModel } from "./saga.js";
import { notificationModel, outboxModel } from "./outbox.js";
import { orderReadModel, orderWriteModel } from "./cqrs.js";
import { dependencyModel, riskModel } from "./circuit.js";
export { commerceScenario, commerceLessonNames } from "./scenarios.js";
export type { CommerceLessonName } from "./scenarios.js";

const models = [clientModel, retryModel, carrierModel, sagaModel, sagaResourceModel, notificationModel, outboxModel, orderReadModel, orderWriteModel, dependencyModel, riskModel];
export const commerceCatalog: ScenarioCatalog = {
  id: "commerce.lessons", version: "1.0.0",
  find: (name, version) => models.find(model => model.model === name && model.version === version),
  versions: name => models.filter(model => model.model === name).map(model => model.version),
};
export const commerceAssessment: ScenarioAssessment = {
  version: "1.0.0",
  find: id => !["commerce.rows", "commerce.metrics"].includes(id) ? undefined : {
    id, version: "1.0.0", evaluate({ parameters, projection }) {
      const p = record(parameters);
      if (id === "commerce.metrics") {
        const entries = record(projection.stores)[text(p.owner)];
        const entry = Array.isArray(entries) ? entries.find(item => record(item).key === "dependency") : undefined;
        const actual = entry ? record(record(entry).value!) : {};
        const pass = Object.entries(record(p.expected!)).every(([key, value]) => actual[key] === value);
        return { pass, evidence: actual };
      }
      const db = record(record(projection.databases)[text(p.owner)]!);
      const rows = record(record(db.tables!)[text(p.table)]!);
      const expected = record(p.expected!);
      const row = rows[text(p.key)] ?? {};
      const pass = Object.keys(rows).length === p.count && Object.entries(expected).every(([key, value]) => record(row)[key] === value);
      return { pass, evidence: rows };
    },
  },
};
