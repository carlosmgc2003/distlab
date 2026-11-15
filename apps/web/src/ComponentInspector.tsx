import type { ReactNode } from "react";
import { useMessages } from "./i18n/react.tsx";
import type { ArchitectureNode, ResourceNode } from "./architecture-view.ts";
import { categoryLabel, resourceTitle, slotModelLabel, symbolLabel } from "./architecture-view.ts";
import type { SlotMark } from "./design-preview.ts";

export function ComponentInspector({ node, children }: {
  readonly node: ArchitectureNode | ResourceNode | undefined;
  readonly children?: ReactNode;
}) {
  const m = useMessages();
  return <aside id="component-inspector" className="inspector" aria-labelledby="inspector-heading" tabIndex={0}>
    <h3 id="inspector-heading">{m.architecture.inspector.heading}</h3>
    {node ? node.type === "component" ? <>
      <h4>{node.data.title}</h4>
      {node.data.emptySlot && !node.data.draft ? <p className="inspector-empty-slot"><strong>{m.designChoices.emptySlot.label}.</strong> {m.designChoices.emptySlot.description}</p> : null}
      {node.data.slot ? <SlotFacts heading={m.architecture.design.filledSlot} slot={node.data.slot} /> : null}
      {node.data.draft ? <SlotFacts heading={m.architecture.design.draftSlot} slot={node.data.draft} draft /> : null}
      {children}<details className="inspector-metadata">
        <summary>{m.architecture.inspector.metadata}</summary>
      <dl>
        <dt>{m.architecture.inspector.componentId}</dt><dd>{node.id}</dd>
        <dt>{m.architecture.inspector.category}</dt><dd>{node.data.symbol === "kvstore" ? symbolLabel("kvstore", m) : categoryLabel(node.data.component.kind, m)}</dd>
        <dt>{m.architecture.inspector.model}</dt><dd>{node.data.component.model ?? m.architecture.inspector.notDeclared}</dd>
        <dt>{m.architecture.inspector.version}</dt><dd>{node.data.component.version ?? m.architecture.inspector.notDeclared}</dd>
      </dl>
      <h4>{m.architecture.inspector.configuration}</h4>
      {node.data.configuration === undefined ? <p>{m.architecture.inspector.configurationNone}</p> : <pre>{JSON.stringify(node.data.configuration, null, 2)}</pre>}
      <h4>{m.architecture.inspector.resources}</h4>
      {node.data.resources.length ? <ul>{node.data.resources.map(resource => <li key={resource}>{resource}</li>)}</ul> : <p>{m.architecture.inspector.resourcesNone}</p>}
      </details>
    </> : <>
      <h4>{resourceTitle(node.data.kind, node.data.ownerName, m)}</h4>
      <ResourceFacts node={node} />
    </> : <p>{m.architecture.inspector.select}</p>}
  </aside>;
}

/**
 * The model that fills a slot (#203): the applied design's, or the draft's. Option keys and values
 * are declared identifiers and data, so they stay as written.
 */
function SlotFacts({ heading, slot, draft = false }: { readonly heading: string; readonly slot: SlotMark; readonly draft?: boolean }) {
  const m = useMessages();
  return <div className={`inspector-slot${draft ? " is-draft" : ""}`}>
    <p><strong>{heading}.</strong> {slot.placeholder ? slotModelLabel(slot, m) : m.architecture.design.filledSlotModel({ model: slot.model, version: slot.version })}</p>
    {slot.options.length ? <dl aria-label={m.architecture.design.options}>
      {slot.options.map(option => <div key={option.key}><dt>{option.key}</dt><dd>{typeof option.value === "string" ? option.value : JSON.stringify(option.value)}</dd></div>)}
    </dl> : null}
  </div>;
}

function ResourceFacts({ node }: { readonly node: ResourceNode }) {
  const m = useMessages();
  const copy = m.architecture.inspector;
  const { ownerName, definition } = node.data;
  const database = "tables" in definition ? definition : undefined;
  const store = "tables" in definition ? undefined : definition;
  return <dl className="resource-facts">
    <dt>{copy.owner}</dt><dd>{ownerName}</dd>
    {database ? <>
      <dt>{copy.tables}</dt><dd>{database.tables.length ? <ul>{database.tables.map(table => <li key={table.name}>{table.name}</li>)}</ul> : copy.noneDeclared}</dd>
      <dt>{copy.initialKeys}</dt><dd>{database.tables.some(table => Object.keys(database.initial[table.name] ?? {}).length > 0)
        ? <ul>{database.tables.flatMap(table => Object.keys(database.initial[table.name] ?? {}).map(key => <li key={`${table.name}:${key}`}>{table.name}: {key}</li>))}</ul>
        : copy.noneDeclared}</dd>
    </> : <>
      <dt>{copy.initialKeys}</dt><dd>{store && store.initial.length ? <ul>{store.initial.map(entry => <li key={entry.key}>{entry.key}</li>)}</ul> : copy.noneDeclared}</dd>
    </>}
  </dl>;
}
