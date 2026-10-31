import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { Background, BaseEdge, ControlButton, Controls, Handle, Panel, Position, ReactFlow, getSmoothStepPath, useReactFlow, useStore } from "@xyflow/react";
import type { EdgeProps, FitViewOptions, NodeChange, NodeProps } from "@xyflow/react";
import type { ArchitectureDefinition, ArchitectureProjection } from "@distlab/contracts";
import { flightTokenStyle, mapArchitecture, resourceLabels, symbolLabels, type NodeSymbol } from "./architecture-view.ts";
import type { ArchitectureEdge, ArchitectureNode, OwnershipEdge, ResourceNode } from "./architecture-view.ts";
import { FlightNarration, FlightReadout } from "./ArchitecturePlayback.tsx";
import type { FlightPlayback } from "./flight-playback.ts";
import { flightDelayMs, FLIGHT_LEGEND } from "./flight.ts";
import { ACTIVITY_SYMBOLS, activityOf } from "./activity.ts";
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

const legendSymbols: readonly NodeSymbol[] = ["client", "service", "external", "topic", "queue"];

function ResourceSample({ kind, label }: { readonly kind: "database" | "kvstore"; readonly label: string }) {
  return <svg className={`resource-sample resource-sample-${kind}`} viewBox="0 0 40 24" role="img" aria-label={label}>
    {kind === "database" ? <>
      <path d="M3 5a17 3 0 1 0 34 0a17 3 0 1 0-34 0 M3 5v14a17 3 0 0 0 34 0V5" />
      <path d="M3 12a17 3 0 0 0 34 0" />
    </> : <>
      <path d="M3 5 20 2l17 3-17 3z M3 5v14l17 3 17-3V5 M3 11l17 3 17-3 M3 16l17 3 17-3" />
      <circle cx="20" cy="12" r="2" />
    </>}
  </svg>;
}

function EdgeSample({ relationship, label }: { readonly relationship: "request" | "subscription" | "publication" | "ownership"; readonly label: string }) {
  return <svg className={`edge-sample ${relationship}`} viewBox="0 0 56 14" role="img" aria-label={label}>
    <line x1="1" y1="7" x2={relationship === "ownership" ? "55" : "48"} y2="7" />
    {relationship === "ownership" ? null : relationship === "subscription"
      ? <path d="M47 3 L53 7 L47 11" />
      : <path d={relationship === "publication" ? "M48 4 L54 7 L48 10 Z" : "M46 2 L54 7 L46 12 Z"} />}
  </svg>;
}

function ArchitectureLegend({ open, onToggle }: { readonly open: boolean; readonly onToggle: () => void }) {
  return <Panel position="top-left" className={`graph-legend${open ? "" : " is-collapsed"}`} role="region" aria-label="Architecture legend" tabIndex={0}>
    <div className="graph-legend-header">
      <h3>Legend</h3>
      <button type="button" className="graph-legend-toggle" aria-expanded={open} aria-controls="graph-legend-body" onClick={onToggle}>
        {open ? "Hide" : "Show"}<span className="sr-only"> legend</span>
      </button>
    </div>
    <div id="graph-legend-body" hidden={!open}>
    <section aria-labelledby="legend-nodes-heading">
      <h4 id="legend-nodes-heading">Nodes</h4>
      <ul>{legendSymbols.map(symbol => <li key={symbol}>
        <svg className={`legend-node symbol-${symbol}`} viewBox="0 0 215 90" aria-hidden="true"><SymbolShape symbol={symbol} /></svg>
        <span>{symbolLabels[symbol]}</span>
      </li>)}
        <li><ResourceSample kind="database" label="Cylinder" /><span>Database (owned)</span></li>
        <li><ResourceSample kind="kvstore" label="Layered box with key" /><span>KV store (owned)</span></li>
      </ul>
    </section>
    <section aria-labelledby="legend-edges-heading">
      <h4 id="legend-edges-heading">Relationships</h4>
      <ul>
        <li><EdgeSample relationship="request" label="Solid line with filled arrowhead" /><span>Request</span></li>
        <li><EdgeSample relationship="subscription" label="Dashed line with open arrowhead" /><span>MessageBus subscription</span></li>
        <li><EdgeSample relationship="publication" label="Dotted line with small filled arrowhead" /><span>MessageBus publication</span></li>
        <li><EdgeSample relationship="ownership" label="Short thin solid line without arrowhead" /><span>Ownership</span></li>
      </ul>
    </section>
    <section aria-labelledby="legend-movements-heading">
      <h4 id="legend-movements-heading">Recorded movements</h4>
      <ul>{FLIGHT_LEGEND.map(entry => <li key={entry.glyph}>
        <span className={`token-sample shape-${entry.shape}`} aria-hidden="true">{entry.glyph}</span>
        <span>{entry.label}<span className="sr-only">, {entry.detail}</span></span>
      </li>)}</ul>
    </section>
    <section aria-labelledby="legend-activity-heading">
      <h4 id="legend-activity-heading">Component activity</h4>
      <ul>
        <li><span className="activity-sample activity-processing" aria-hidden="true">{ACTIVITY_SYMBOLS.processing}</span><span>Processing<span className="sr-only">: handling a delivered request, an open transaction, or a message delivery</span></span></li>
        <li><span className="activity-sample activity-waiting" aria-hidden="true">{ACTIVITY_SYMBOLS.waiting}</span><span>Waiting<span className="sr-only">: sent a request with no response or timeout recorded yet</span></span></li>
        <li><span className="activity-sample activity-idle" aria-hidden="true">{ACTIVITY_SYMBOLS.idle}</span><span>Idle</span></li>
      </ul>
    </section>
    </div>
  </Panel>;
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
        {data.activity ? <span id={activityBadgeId(data.component.id)} className={`activity-badge activity-${data.activity.state}${data.activity.timedOut ? " has-timeout" : ""}`}>
          <span aria-hidden="true">{ACTIVITY_SYMBOLS[data.activity.state]} </span>{data.activity.label}
          {data.activity.timedOut ? <span className="activity-timeout"> · <span aria-hidden="true">◷</span> timed out t={data.activity.timedOut.time}</span> : null}
          <span className="sr-only">. {data.activity.description}</span>
        </span> : null}
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
/**
 * The token is two layers on the same measured path and the same animation. The
 * label stays upright and direction-neutral; the heading mark turns with the
 * path, so the arrowhead always points the way the token travels on any link
 * orientation.
 */
function FlightToken({ flight, path, readable, durationMs }: {
  readonly flight: NonNullable<NonNullable<ArchitectureEdge["data"]>["flight"]>;
  readonly path: string;
  readonly readable: number;
  readonly durationMs: number;
}) {
  const style = flightTokenStyle(flight, path, durationMs) as CSSProperties;
  const classes = `flight-${flight.kind} shape-${flight.shape} leg-${flight.leg}`;
  return <g aria-hidden="true">
    {flight.heading ? <g className={`flight-heading ${classes}`} data-flight-heading={flight.observationId} style={style}>
      <g transform={`scale(${readable})`}>
        <path className="flight-heading-mark" d="M 19 -7 L 30 0 L 19 7 Z" />
      </g>
    </g> : null}
    <g className={`flight-token ${classes}`} data-flight-token={flight.observationId}
      data-flight-direction={flight.reversed ? "reverse" : "forward"} style={style}>
      <g transform={`scale(${readable})`}>
        <rect className="flight-token-halo" x={-21} y={-13} width={42} height={26} rx={13} />
        <rect className="flight-token-core" x={-16} y={-8} width={32} height={16} rx={8} />
        <text className="flight-token-glyph" dy="3.2">{flight.glyph}</text>
      </g>
    </g>
  </g>;
}

function activityBadgeId(componentId: string): string {
  return `activity-${componentId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

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
    {flight ? <FlightToken flight={flight} path={path} readable={readable} durationMs={Math.round(flightDelayMs(data?.pace ?? "slow") * 0.62)} /> : null}
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
/** Below this canvas width the legend starts collapsed, so it never covers the graph. */
const NARROW_CANVAS = 720;
/** Gap kept between the legend and the nearest node at the fitted view. */
const LEGEND_GAP = 16;

/**
 * The fit for this canvas. An open legend reserves its own column on the left,
 * so no node sits under it at the fitted view; a collapsed legend reserves its
 * header row. The other sides keep the default padding.
 */
function fitOptionsFor(canvas: HTMLElement): FitViewOptions {
  const legend = canvas.querySelector<HTMLElement>(".graph-legend");
  if (!legend) return fitViewOptions;
  const area = canvas.getBoundingClientRect();
  const box = legend.getBoundingClientRect();
  if (box.width < 1 || area.width < 1) return fitViewOptions;
  if (legend.classList.contains("is-collapsed")) {
    return { padding: { top: `${Math.ceil(box.bottom - area.top + LEGEND_GAP)}px`, right: 0.18, bottom: 0.18, left: 0.18 } };
  }
  return { padding: { top: 0.18, right: 0.18, bottom: 0.18, left: `${Math.ceil(box.right - area.left + LEGEND_GAP)}px` } };
}
/** Small enough that the default fit never has to clip the checkout graph on a narrow canvas. */
const minZoom = 0.15;

/** Fits the whole graph to the measured canvas whenever the canvas or the session changes. */
function FitToCanvas({ container, sessionKey, legendOpen, onMeasure }: {
  readonly container: RefObject<HTMLDivElement | null>;
  readonly sessionKey: string;
  /** Opening or closing the legend changes the space it reserves. */
  readonly legendOpen: boolean;
  readonly onMeasure: (width: number) => void;
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
      onMeasure(width);
      void fitView(fitOptionsFor(element));
    };
    // A ResizeObserver sees every layout-driven canvas change: window resizes, panel switches, and the two-column inspector.
    const observer = new ResizeObserver(() => {
      if (queued) return;
      queued = requestAnimationFrame(apply);
    });
    observer.observe(element);
    apply();
    return () => { if (queued) cancelAnimationFrame(queued); observer.disconnect(); };
  }, [container, fitView, onMeasure]);
  // Loading a scenario, resetting the simulation, or toggling the legend returns the view to the fitted default.
  useEffect(() => {
    const element = container.current;
    // Measure after the legend has painted at its new size.
    const frame = requestAnimationFrame(() => { void fitView(element ? fitOptionsFor(element) : fitViewOptions); });
    return () => cancelAnimationFrame(frame);
  }, [container, fitView, sessionKey, legendOpen]);
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

/** Fit View with the same legend-aware padding as the default fit, so both give one view. */
function LegendAwareFit({ container }: { readonly container: RefObject<HTMLDivElement | null> }) {
  const { fitView } = useReactFlow();
  return <ControlButton className="react-flow__controls-fitview" aria-label="Fit View" title="Fit View"
    onClick={() => { void fitView(container.current ? fitOptionsFor(container.current) : fitViewOptions); }}>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 30" aria-hidden="true">
      <path d="M3.692 4.63c0-.53.4-.938.939-.938h5.215V0H4.708C2.13 0 0 2.054 0 4.63v5.216h3.692V4.631zM27.354 0h-5.2v3.692h5.17c.53 0 .984.4.984.939v5.215H32V4.631A4.624 4.624 0 0027.354 0zm.954 24.83c0 .532-.4.94-.939.94h-5.215v3.768h5.215c2.577 0 4.631-2.13 4.631-4.707v-5.139h-3.692v5.139zm-23.677.94c-.531 0-.939-.4-.939-.94v-5.138H0v5.139c0 2.577 2.13 4.707 4.708 4.707h5.138V25.77H4.631z" />
    </svg>
  </ControlButton>;
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
    // Activity is shown only while the cursor stands on a record, and only from records at or before it.
    const activity = flight ? activityOf(playback.activity, node.id) : undefined;
    const classes = [node.className ?? "", involved ? `is-involved${pulse}` : "", activity ? `activity-${activity.state}` : ""].filter(Boolean).join(" ");
    return {
      ...node,
      className: classes,
      data: {
        ...node.data,
        ...(role !== undefined && flight !== undefined ? { role, roleLabel: `${flight.glyph} ${role === "sending" ? "sends" : "receives"}` } : {}),
        ...(activity ? { activity } : {}),
      },
      selected: node.id === selectedId,
      domAttributes: {
        "aria-pressed": node.id === selectedId,
        ...(node.id === selectedId ? { "aria-controls": "component-inspector" } : {}),
        ...(activity ? { "aria-describedby": activityBadgeId(node.id) } : {}),
      },
    };
  }), [graph.nodes, selectedId, painted, flight, playback.activity]);
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
  // null keeps the automatic choice: open unless the canvas is narrow. A reader's toggle wins afterwards.
  const [legendChoice, setLegendChoice] = useState<boolean | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const legendOpen = legendChoice ?? (canvasWidth === 0 || canvasWidth >= NARROW_CANVAS);
  const toggleLegend = useCallback(() => setLegendChoice(!legendOpen), [legendOpen]);

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
          minZoom={minZoom} maxZoom={1.8}
          ariaLabelConfig={ariaLabelConfig}>
          <FitToCanvas container={canvas} sessionKey={sessionKey} legendOpen={legendOpen} onMeasure={setCanvasWidth} />
          <Background gap={24} color="#cbd5e1" />
          <Controls showInteractive={false} showFitView={false}>
            <LegendAwareFit container={canvas} />
          </Controls>
          <PanControls />
          <ArchitectureLegend open={legendOpen} onToggle={toggleLegend} />
        </ReactFlow>
      </div>
      {selectedId || flight ? <div className="architecture-side">
        {flight ? <FlightNarration step={flight} activity={playback.activity} changes={playback.activityChanges} /> : null}
        {selectedId ? <ComponentInspector node={graph.nodes.find(node => node.id === selectedId) ?? graph.resourceNodes.find(node => node.id === selectedId)}>
          {graph.nodes.some(node => node.id === selectedId) && inspectorFacts ? inspectorFacts(selectedId) : null}
        </ComponentInspector> : null}
      </div> : null}
    </div>
    <details className="connections">
      <summary>Connections ({graph.edges.length})</summary>
      <ul>{graph.edges.map(edge => <li key={edge.id}>{edge.source} → {edge.target}: {String(edge.label)}</li>)}</ul>
    </details>
  </>;
}
