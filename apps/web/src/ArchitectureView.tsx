import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { Background, BaseEdge, Controls, Handle, Panel, Position, ReactFlow, getSmoothStepPath, useReactFlow, useStore } from "@xyflow/react";
import type { EdgeProps, NodeChange, NodeProps } from "@xyflow/react";
import type { ArchitectureDefinition, ArchitectureProjection } from "@distlab/contracts";
import { flightTokenStyle, mapArchitecture, resourceLabels, symbolLabels, type NodeSymbol } from "./architecture-view.ts";
import type { ArchitectureEdge, ArchitectureNode, OwnershipEdge, ResourceNode } from "./architecture-view.ts";
import { FlightNarration, FlightReadout } from "./ArchitecturePlayback.tsx";
import type { FlightPlayback } from "./flight-playback.ts";
import { flightDelayMs, FLIGHT_LEGEND } from "./flight.ts";
import { ComponentInspector } from "./ComponentInspector.tsx";
import { HelpHint } from "./ui-hint.tsx";
import { movementPulseClass } from "./timeline.ts";
import type { GraphEmphasis } from "./timeline.ts";
import "@xyflow/react/dist/style.css";
import "./architecture.css";

function SymbolShape({ symbol }: { readonly symbol: NodeSymbol }) {
  switch (symbol) {
    case "client":
      return <rect x="1" y="1" width="213" height="88" rx="44" ry="44" className="shape-fill shape-stroke" />;
    case "service":
      return <>
        <rect x="1" y="1" width="213" height="88" rx="6" ry="6" className="shape-fill shape-stroke" />
        <rect x="-5" y="26" width="14" height="12" rx="2" className="shape-fill shape-stroke" />
        <rect x="-5" y="52" width="14" height="12" rx="2" className="shape-fill shape-stroke" />
      </>;
    case "external":
      return <polygon points="22,1 193,1 214,45 193,89 22,89 1,45" className="shape-fill shape-stroke" />;
    case "topic":
      return <>
        <rect x="1" y="26" width="213" height="38" rx="8" ry="8" className="shape-fill shape-stroke" />
        <line x1="45" y1="26" x2="45" y2="10" className="shape-stroke" />
        <line x1="107" y1="26" x2="107" y2="10" className="shape-stroke" />
        <line x1="170" y1="26" x2="170" y2="10" className="shape-stroke" />
        <line x1="45" y1="64" x2="45" y2="80" className="shape-stroke" />
        <line x1="107" y1="64" x2="107" y2="80" className="shape-stroke" />
        <line x1="170" y1="64" x2="170" y2="80" className="shape-stroke" />
      </>;
    case "queue":
      return <>
        <rect x="8" y="8" width="30" height="74" rx="6" ry="6" className="shape-fill shape-stroke" />
        <line x1="38" y1="25" x2="52" y2="25" className="shape-stroke" />
        <line x1="38" y1="45" x2="52" y2="45" className="shape-stroke" />
        <line x1="38" y1="65" x2="52" y2="65" className="shape-stroke" />
      </>;
  }
}

function SymbolGlyph({ symbol }: { readonly symbol: NodeSymbol }) {
  switch (symbol) {
    case "client":
      return <svg viewBox="0 0 20 18" aria-hidden="true">
        <rect x="2" y="2" width="16" height="11" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <line x1="10" y1="13" x2="10" y2="16" stroke="currentColor" strokeWidth="1.6" />
        <line x1="6" y1="16" x2="14" y2="16" stroke="currentColor" strokeWidth="1.6" />
      </svg>;
    case "service":
      return <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="5" y="2" width="13" height="16" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <rect x="1" y="5" width="6" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <rect x="1" y="11" width="6" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>;
    case "external":
      return <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <ellipse cx="10" cy="10" rx="3" ry="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <line x1="10" y1="3" x2="10" y2="17" stroke="currentColor" strokeWidth="1.6" />
        <line x1="3" y1="10" x2="17" y2="10" stroke="currentColor" strokeWidth="1.6" />
      </svg>;
    case "topic":
      return <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="16" r="1.8" fill="currentColor" />
        <path d="M6 12 Q10 8 14 12" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M4 9 Q10 4 16 9" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M2 6 Q10 0 18 6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>;
    case "queue":
      return <svg viewBox="0 0 20 20" aria-hidden="true">
        <line x1="2" y1="6" x2="13" y2="6" stroke="currentColor" strokeWidth="1.6" />
        <line x1="2" y1="10" x2="13" y2="10" stroke="currentColor" strokeWidth="1.6" />
        <line x1="2" y1="14" x2="13" y2="14" stroke="currentColor" strokeWidth="1.6" />
        <polyline points="14,4 18,10 14,16" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>;
  }
}

const ComponentNode = memo(function ComponentNode({ data }: NodeProps<ArchitectureNode>) {
  return <>
    <Handle id="top" type="target" position={Position.Top} />
    <Handle id="left" type="target" position={Position.Left} />
    <div className="node-body">
      <div className="node-shape" aria-hidden="true">
        <svg viewBox="0 0 215 90" preserveAspectRatio="none" className="shape-svg">
          <SymbolShape symbol={data.symbol} />
        </svg>
        <span className="node-glyph"><SymbolGlyph symbol={data.symbol} /></span>
      </div>
      <div className="node-content">
        <span className="category-label">{symbolLabels[data.symbol]}</span>
        <strong>{data.title}</strong>
        {data.roleLabel ? <span className={`role-badge role-${data.role ?? "sending"}`}>{data.roleLabel}</span> : null}
      </div>
    </div>
    <Handle id="right" type="source" position={Position.Right} />
    <Handle id="bottom" type="source" position={Position.Bottom} />
  </>;
});
const ResourceNodeView = memo(function ResourceNodeView({ data }: NodeProps<ResourceNode>) {
  return <>
    <span className="target resource-anchor" data-handleid="top" data-handlepos="top" aria-hidden="true" />
    <div className={`resource-body resource-body-${data.kind}`}>
    {data.kind === "database" ? <svg viewBox="0 0 115 56" aria-hidden="true">
      <path d="M2 9a55.5 7 0 1 0 111 0a55.5 7 0 1 0-111 0 M2 9v38a55.5 7 0 0 0 111 0V9" />
      <path d="M2 28a55.5 7 0 0 0 111 0" />
    </svg> : <svg viewBox="0 0 115 56" aria-hidden="true">
      <path d="M8 11l49-8 50 8-50 9z M8 11v34l49 8 50-8V11 M8 24l49 9 50-9 M8 36l49 9 50-9" />
    </svg>}
    <span className="resource-glyph" aria-hidden="true">{data.kind === "database" ? "▤" : "⚿"}</span>
    <span className="resource-title">{resourceLabels[data.kind]} owned by {data.owner}</span>
    </div>
  </>;
});
/** The token follows the measured link path, so the link is drawn here instead of by a built-in edge. */
const LinkEdge = memo(function LinkEdge(props: EdgeProps<ArchitectureEdge>) {
  const { id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
    markerEnd, markerStart, style, label, labelStyle, labelShowBg, labelBgStyle, labelBgPadding, labelBgBorderRadius, pathOptions, data } = props;
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
    borderRadius: pathOptions?.borderRadius, offset: pathOptions?.offset, stepPosition: pathOptions?.stepPosition,
  });
  const flight = data?.flight;
  // The token is drawn in graph coordinates, so it is scaled back against the
  // canvas zoom to stay the same readable size at any zoom level.
  const zoom = useStore(state => state.transform[2]);
  const readable = Math.min(Math.max(1 / (zoom || 1), 1), 2.6);
  return <>
    <BaseEdge id={id} path={path} labelX={labelX} labelY={labelY}
      {...(label !== undefined ? { label } : {})} {...(labelStyle !== undefined ? { labelStyle } : {})}
      {...(labelShowBg !== undefined ? { labelShowBg } : {})} {...(labelBgStyle !== undefined ? { labelBgStyle } : {})}
      {...(labelBgPadding !== undefined ? { labelBgPadding } : {})}
      {...(labelBgBorderRadius !== undefined ? { labelBgBorderRadius } : {})}
      {...(style !== undefined ? { style } : {})}
      {...(markerEnd !== undefined ? { markerEnd } : {})} {...(markerStart !== undefined ? { markerStart } : {})} />
    {flight ? <g className={`flight-token flight-${flight.kind} shape-${flight.shape}`} aria-hidden="true"
      data-flight-token={flight.observationId}
      style={flightTokenStyle(flight, path, Math.round(flightDelayMs(data?.pace ?? "slow") * 0.62)) as CSSProperties}>
      <g transform={`scale(${readable})`}>
        <circle className="flight-token-halo" r={13} />
        <circle className="flight-token-core" r={7} />
        <text className="flight-token-glyph" dy="4">{flight.glyph}</text>
      </g>
    </g> : null}
  </>;
});
const nodeTypes = { component: ComponentNode, database: ResourceNodeView, kvstore: ResourceNodeView };
const edgeTypes = { link: LinkEdge };
const ariaLabelConfig = {
  "node.a11yDescription.default": "Press Enter or Space to inspect this component. Press Escape to clear selection.",
  "node.a11yDescription.keyboardDisabled": "Press Enter or Space to inspect this component. Press Escape to clear selection.",
};
// Let fitView choose a scale for each measured canvas, including narrow workspaces.
const fitViewOptions = { padding: 0.18 };
/** Small enough that the default fit never has to clip the checkout graph on a narrow canvas. */
const minZoom = 0.15;

/** Fits the whole graph to the measured canvas whenever the canvas or the session changes. */
function FitToCanvas({ container, sessionKey }: {
  readonly container: RefObject<HTMLDivElement | null>;
  readonly sessionKey: string;
}) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let measured = "";
    let queued = 0;
    const apply = () => {
      queued = 0;
      const { width, height } = element.getBoundingClientRect();
      const current = `${Math.round(width)}x${Math.round(height)}`;
      if (current === measured || width < 1 || height < 1) return;
      measured = current;
      void fitView(fitViewOptions);
    };
    // A ResizeObserver sees every layout-driven canvas change: window resizes, panel switches, and the two-column inspector.
    const observer = new ResizeObserver(() => {
      if (queued) return;
      queued = requestAnimationFrame(apply);
    });
    observer.observe(element);
    apply();
    return () => { if (queued) cancelAnimationFrame(queued); observer.disconnect(); };
  }, [container, fitView]);
  // Loading a scenario or resetting the simulation returns the view to the fitted default for the current canvas.
  useEffect(() => { void fitView(fitViewOptions); }, [fitView, sessionKey]);
  return null;
}

function emphasize(edge: ArchitectureEdge, emphasis: GraphEmphasis | undefined): ArchitectureEdge {
  if (!emphasis?.edgeId || edge.id !== emphasis.edgeId) return edge;
  const stroke = emphasis.kind === "message" ? "#6d28d9" : emphasis.kind === "response" ? "#0f766e" : "#1d4ed8";
  const pulse = emphasis.pulseId ? ` ${movementPulseClass(emphasis.pulseId)}` : "";
  return {
    ...edge,
    className: `${emphasis.kind ? `is-movement movement-${emphasis.kind}` : "is-involved-edge"}${pulse}`,
    style: { ...edge.style, stroke, strokeWidth: 3 },
  };
}

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

export function ArchitectureView({ architecture, metadata, scenarioName, emphasis, movementText, inspectorFacts, sessionKey, playback }: {
  readonly architecture: ArchitectureProjection;
  readonly metadata?: ArchitectureDefinition;
  readonly scenarioName?: string;
  readonly emphasis?: GraphEmphasis;
  readonly movementText?: string;
  readonly inspectorFacts?: (componentId: string) => ReactNode;
  /** Changes when a scenario is loaded or reset; restores the fitted default view. */
  readonly sessionKey: string;
  /** Replay state owned by the shell, so the cursor survives a tab switch. Reads projections only. */
  readonly playback: FlightPlayback;
}) {
  // Boundary projections copy the same architecture on every update; keep React Flow's graph stable while it measures nodes.
  const architectureKey = JSON.stringify(architecture);
  const graph = useMemo(() => mapArchitecture(architecture, metadata, scenarioName), [architectureKey, metadata, scenarioName]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const flight = playback.step;
  const painted: GraphEmphasis | undefined = flight
    ? { nodeIds: flight.nodeIds, ...(flight.edgeId !== undefined ? { edgeId: flight.edgeId } : {}), kind: flight.kind, text: flight.announcement, pulseId: flight.observationId }
    : emphasis;
  const componentNodes = useMemo(() => graph.nodes.map(node => {
    const involved = painted?.nodeIds.includes(node.id) === true;
    const pulse = involved && painted?.pulseId ? ` ${movementPulseClass(painted.pulseId)}` : "";
    const role: "sending" | "receiving" | undefined = flight?.from === node.id ? "sending" : flight?.to === node.id ? "receiving" : undefined;
    return {
      ...node,
      ...(involved ? { className: `${node.className ?? ""} is-involved${pulse}`.trim() } : {}),
      ...(role !== undefined && flight !== undefined
        ? { data: { ...node.data, role, roleLabel: `${flight.glyph} ${role === "sending" ? "sends" : "receives"}` } }
        : {}),
      selected: node.id === selectedId,
      domAttributes: { "aria-pressed": node.id === selectedId, ...(node.id === selectedId ? { "aria-controls": "component-inspector" } : {}) },
    };
  }), [graph.nodes, selectedId, painted, flight]);
  const resourceNodes = useMemo(() => graph.resourceNodes.map(node => ({
    ...node,
    selected: node.id === selectedId,
    domAttributes: { "aria-pressed": node.id === selectedId, ...(node.id === selectedId ? { "aria-controls": "component-inspector" } : {}) },
  })), [graph.resourceNodes, selectedId]);
  const nodes = useMemo(() => [...componentNodes, ...resourceNodes], [componentNodes, resourceNodes]);
  const componentEdges = useMemo<ArchitectureEdge[]>(() => graph.edges.map(edge => {
    const styled = emphasize(edge, painted);
    if (!flight || flight.edgeId === undefined || styled.id !== flight.edgeId) return styled;
    return { ...styled, data: { ...styled.data!, flight, pace: playback.pace } };
  }), [graph.edges, painted, flight, playback.pace]);
  const edges = useMemo<(ArchitectureEdge | OwnershipEdge)[]>(() => [...componentEdges, ...graph.resourceEdges], [componentEdges, graph.resourceEdges]);
  // Accept only selection changes. Positions and graph structure are immutable presentation inputs.
  const onNodesChange = useCallback((changes: NodeChange<ArchitectureNode | ResourceNode>[]) => {
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
  const canvas = useRef<HTMLDivElement | null>(null);

  if (graph.error) return <p role="alert">{graph.error}</p>;
  if (!nodes.length) return <p>No architecture components to display.</p>;
  return <>
    {/* The heading carries both explanations, so the graph area keeps its height. */}
    <div className="panel-heading">
      <h2 id="architecture-heading">Architecture</h2>
      <HelpHint label="Graph controls" bodyId="graph-controls-help">Select a component to inspect it. Tab to a component, then press Enter or Space. Drag the canvas or use the arrow buttons to pan; use the zoom and fit buttons to change the view.</HelpHint>
      <HelpHint label="Playback speed" bodyId="flight-pace-help">Playback speed changes how fast the browser paints recorded movements. It does not change virtual time, the recorded history, or the run. Every movement you see was already recorded before it was painted.</HelpHint>
    </div>
    <FlightReadout position={playback.position} />
    {/* While a movement is painted, the narration carries this region's sentence, so it is stated once. */}
    {flight ? null
      : <p id="movement-cue" className="movement-cue" role="status" aria-label="Request and message movement">{movementText ?? "No request or message movement is highlighted."}</p>}
    {selectedId ? <a className="inspector-link" href="#component-inspector">Skip to component inspector</a> : null}
    <div className={`architecture-layout${selectedId || flight ? " has-selection" : ""}`}>
      <div className="graph-canvas" ref={canvas} aria-label="Architecture graph" aria-describedby="movement-cue" onKeyDownCapture={event => {
        if (!(event.target instanceof Element) || !event.target.closest(".react-flow__node")) return;
        if (event.key === " " || event.key === "Enter") event.preventDefault();
        if (event.key === "Escape") {
          event.preventDefault(); event.stopPropagation(); clearSelection();
        }
      }}>
        <ReactFlow<ArchitectureNode | ResourceNode, ArchitectureEdge | OwnershipEdge> aria-label="Architecture graph" nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          onNodesChange={onNodesChange} onPaneClick={clearSelection}
          nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false}
          nodesFocusable edgesFocusable={false} deleteKeyCode={null}
          selectionKeyCode={null} multiSelectionKeyCode={null} panActivationKeyCode={null}
          fitView fitViewOptions={fitViewOptions} minZoom={minZoom} maxZoom={1.8}
          ariaLabelConfig={ariaLabelConfig}>
          <FitToCanvas container={canvas} sessionKey={sessionKey} />
          <Background gap={24} color="#cbd5e1" />
          <Controls showInteractive={false} fitViewOptions={fitViewOptions} />
          <PanControls />
        </ReactFlow>
      </div>
      {selectedId || flight ? <div className="architecture-side">
        {flight ? <FlightNarration step={flight} /> : null}
        {selectedId ? <ComponentInspector node={graph.nodes.find(node => node.id === selectedId) ?? graph.resourceNodes.find(node => node.id === selectedId)}>
          {graph.nodes.some(node => node.id === selectedId) && inspectorFacts ? inspectorFacts(selectedId) : null}
        </ComponentInspector> : null}
      </div> : null}
    </div>
    <div className="graph-legend" aria-label="Architecture legend">
      <p><span className="line-sample request" aria-hidden="true" /> Solid arrow: request link</p>
      <p><span className="line-sample publication" aria-hidden="true" /> Dotted arrow: MessageBus publication</p>
      <p><span className="line-sample subscription" aria-hidden="true" /> Dashed arrow: MessageBus subscription</p>
      {FLIGHT_LEGEND.map(entry => <p key={entry.glyph}>
        <span className={`token-sample shape-${entry.shape}`} aria-hidden="true">{entry.glyph}</span>
        {entry.label}<span className="sr-only">, {entry.detail}</span>
      </p>)}
    </div>
    <details className="connections">
      <summary>Connections ({graph.edges.length})</summary>
      <ul>{graph.edges.map(edge => <li key={edge.id}>{edge.source} → {edge.target}: {String(edge.label)}</li>)}</ul>
    </details>
  </>;
}
