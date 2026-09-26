import type { ReactNode } from "react";
import type { ArchitectureNode } from "./architecture-view.ts";
import { categoryLabels } from "./architecture-view.ts";

export function ComponentInspector({ node, children }: {
  readonly node: ArchitectureNode | undefined;
  readonly children?: ReactNode;
}) {
  return <aside id="component-inspector" className="inspector" aria-labelledby="inspector-heading" tabIndex={0}>
    <h3 id="inspector-heading">Component inspector</h3>
    {node ? <>
      <h4>{node.data.title}</h4>
      {children}
      <details className="inspector-metadata">
        <summary>Static architecture metadata</summary>
      <dl>
        <dt>Component ID</dt><dd>{node.id}</dd>
        <dt>Category</dt><dd>{categoryLabels[node.data.component.kind]}</dd>
        <dt>Model</dt><dd>{node.data.component.model ?? "Not declared"}</dd>
        <dt>Version</dt><dd>{node.data.component.version ?? "Not declared"}</dd>
      </dl>
      <h4>Configuration</h4>
      {node.data.configuration === undefined ? <p>Not declared in packaged metadata.</p> : <pre>{JSON.stringify(node.data.configuration, null, 2)}</pre>}
      <h4>Resource ownership</h4>
      {node.data.resources.length ? <ul>{node.data.resources.map(resource => <li key={resource}>{resource}</li>)}</ul> : <p>No database or store declared for this component.</p>}
      </details>
    </> : <p>Select a component to inspect its metadata.</p>}
  </aside>;
}
