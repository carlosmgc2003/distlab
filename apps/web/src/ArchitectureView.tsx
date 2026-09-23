import { memo, useCallback, useMemo, useState } from "react";
import { Background, Controls, Handle, Panel, Position, ReactFlow, useReactFlow } from "@xyflow/react";
import type { NodeChange, NodeProps } from "@xyflow/react";
import type { ArchitectureDefinition, ArchitectureProjection } from "@distlab/contracts";
import { categoryLabels, mapArchitecture } from "./architecture-view.ts";
import type { ArchitectureNode } from "./architecture-view.ts";
import { ComponentInspector } from "./ComponentInspector.tsx";
import "@xyflow/react/dist/style.css";
import "./architecture.css";

const ComponentNode = memo(function ComponentNode({ data }: NodeProps<ArchitectureNode>) {
  return <>
    <Handle id="top" type="target" position={Position.Top} />
    <Handle id="left" type="target" position={Position.Left} />
    <span className="category-label">{categoryLabels[data.component.kind]}</span>
    <strong>{data.title}</strong>
    <Handle id="right" type="source" position={Position.Right} />
    <Handle id="bottom" type="source" position={Position.Bottom} />
  </>;
});
const nodeTypes = { component: ComponentNode };
const ariaLabelConfig = {
  "node.a11yDescription.default": "Press Enter or Space to inspect this component. Press Escape to clear selection.",
  "node.a11yDescription.keyboardDisabled": "Press Enter or Space to inspect this component. Press Escape to clear selection.",
};
const fitViewOptions = { padding: 0.18, maxZoom: 1 };

function PanControls() {
  const { getViewport, setViewport } = useReactFlow();
  const pan = (x: number, y: number) => {
    const viewport = getViewport();
    void setViewport({ ...viewport, x: viewport.x + x, y: viewport.y + y });
  };
  return <Panel position="top-right" className="pan-controls" role="group" aria-label="Pan view">
    <button type="button" aria-label="Pan left" onClick={() => pan(80, 0)}><span aria-hidden="true">←</span></button>
    <button type="button" aria-label="Pan up" onClick={() => pan(0, 80)}><span aria-hidden="true">↑</span></button>
    <button type="button" aria-label="Pan down" onClick={() => pan(0, -80)}><span aria-hidden="true">↓</span></button>
    <button type="button" aria-label="Pan right" onClick={() => pan(-80, 0)}><span aria-hidden="true">→</span></button>
  </Panel>;
}

export function ArchitectureView({ architecture, metadata, scenarioName }: {
  readonly architecture: ArchitectureProjection;
  readonly metadata?: ArchitectureDefinition;
  readonly scenarioName?: string;
}) {
  const graph = useMemo(() => mapArchitecture(architecture, metadata, scenarioName), [architecture, metadata, scenarioName]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const nodes = useMemo(() => graph.nodes.map(node => ({
    ...node, selected: node.id === selectedId,
    domAttributes: { "aria-pressed": node.id === selectedId, "aria-controls": "component-inspector" },
  })), [graph.nodes, selectedId]);
  // Accept only selection changes. Positions and graph structure are immutable presentation inputs.
  const onNodesChange = useCallback((changes: NodeChange<ArchitectureNode>[]) => {
    setSelectedId(previous => {
      let next = previous;
      for (const change of changes) {
        if (change.type === "select") {
          if (change.selected) next = change.id;
          else if (change.id === next) next = null;
        }
      }
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedId(null), []);

  if (graph.error) return <p role="alert">{graph.error}</p>;
  if (!nodes.length) return <p>No architecture components to display.</p>;
  return <>
    <p className="graph-help">Select a component to inspect it. Tab to a component, then press Enter or Space. Drag the canvas or use the arrow buttons to pan; use the zoom buttons to change the view.</p>
    <a className="inspector-link" href="#component-inspector">Skip to component inspector</a>
    <div className="architecture-layout">
      <div className="graph-canvas" aria-label="Architecture graph" onKeyDownCapture={event => {
        if (!(event.target instanceof Element) || !event.target.closest(".react-flow__node")) return;
        if (event.key === " " || event.key === "Enter") event.preventDefault();
        if (event.key === "Escape") {
          event.preventDefault(); event.stopPropagation(); clearSelection();
        }
      }}>
        <ReactFlow aria-label="Architecture graph" nodes={nodes} edges={graph.edges} nodeTypes={nodeTypes}
          onNodesChange={onNodesChange} onPaneClick={clearSelection}
          nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false}
          nodesFocusable edgesFocusable={false} deleteKeyCode={null}
          selectionKeyCode={null} multiSelectionKeyCode={null} panActivationKeyCode={null}
          fitView fitViewOptions={fitViewOptions} minZoom={0.3} maxZoom={1.8}
          ariaLabelConfig={ariaLabelConfig}>
          <Background gap={24} color="#cbd5e1" />
          <Controls showInteractive={false} />
          <PanControls />
        </ReactFlow>
      </div>
      <ComponentInspector node={graph.nodes.find(node => node.id === selectedId)} />
    </div>
    <div className="graph-legend" aria-label="Architecture legend">
      <p><span className="line-sample request" aria-hidden="true" /> Solid arrow: request link</p>
      <p><span className="line-sample publication" aria-hidden="true" /> Dotted arrow: MessageBus publication</p>
      <p><span className="line-sample subscription" aria-hidden="true" /> Dashed arrow: MessageBus subscription</p>
    </div>
    <details className="connections">
      <summary>Connections ({graph.edges.length})</summary>
      <ul>{graph.edges.map(edge => <li key={edge.id}>{edge.source} → {edge.target}: {String(edge.label)}</li>)}</ul>
    </details>
  </>;
}
