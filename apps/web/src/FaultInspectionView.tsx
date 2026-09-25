import { Fragment, type ReactNode } from "react";
import type { DeliveryFact, FaultReport, RowFact, ServiceSnapshot } from "./fault-inspection.ts";

function Rows({ rows }: { readonly rows: readonly RowFact[] }) {
  if (!rows.length) return <p>No committed rows.</p>;
  return <ul className="fact-list">{rows.map(row => <li key={`${row.table}:${row.key}`}>
    <span>{row.table} / {row.key}</span>
    {row.fields.length ? <dl>{row.fields.map(field => <Fragment key={field.name}><dt>{field.name}</dt><dd>{field.value}</dd></Fragment>)}</dl> : null}
  </li>)}</ul>;
}

function ServiceFacts({ title, service, stagedNote }: {
  readonly title: string;
  readonly service: ServiceSnapshot | null;
  readonly stagedNote: string;
}) {
  return <>
    <h4>{title}</h4>
    {service ? <>
      <dl>
        <dt>Lifecycle</dt><dd>{service.lifecycle}</dd>
        <dt>Process generation</dt><dd>{service.processGeneration}</dd>
        <dt>Committed revision</dt><dd>{service.revision}</dd>
      </dl>
      <p>{stagedNote}</p>
      <Rows rows={service.rows} />
    </> : <p>Service state was not projected.</p>}
  </>;
}

function DeliveryList({ deliveries }: { readonly deliveries: readonly DeliveryFact[] }) {
  if (!deliveries.length) return <p>No bus delivery is recorded.</p>;
  return <ul className="fact-list">{deliveries.map(delivery => <li key={delivery.messageId}>
    {delivery.destination} state {delivery.state}, attempt {delivery.attempt}
    {delivery.consumer ? `, consumer ${delivery.consumer}` : ""}. Message {delivery.messageId}.
  </li>)}</ul>;
}

export function DistributedState({ report, onShowEvidence }: {
  readonly report: FaultReport;
  readonly onShowEvidence: (observationId: string) => void;
}) {
  return <section className="state-inspection" aria-labelledby="distributed-state-heading">
    <h3 id="distributed-state-heading">Distributed state</h3>
    <p>This session was constructed from the recorded scenario input. Changing the experiment loads a new session.</p>
    <dl>
      <dt>Scenario</dt><dd>{report.scenarioName}</dd>
      <dt>Seed</dt><dd>{report.seed}</dd>
      <dt>Fault status</dt><dd>Status: {report.faultStatus}</dd>
    </dl>
    {report.faults.length ? <ul className="fact-list">{report.faults.map(fault => <li key={fault.id}>
      Fault {fault.id} on {fault.point}
      {fault.source ? ` from ${fault.source}` : ""}
      {fault.target ? ` to ${fault.target}` : ""}
      {fault.name ? ` for ${fault.name}` : ""}, effect {fault.effect}. Status: {fault.status}.
    </li>)}</ul> : <p>No fault rule is recorded.</p>}
    {report.lesson ? <p>{report.lesson}</p> : null}
    <h4>Local and remote knowledge</h4>
    <p className="knowledge-boundary">{report.knowledge}</p>
    <h4>Customer App observed outcome</h4>
    <dl>
      <dt>Request</dt><dd>{report.clientRequest}</dd>
      <dt>Outcome</dt><dd>{report.clientOutcome}</dd>
    </dl>
    <ServiceFacts title="Orders committed state" service={report.orders} stagedNote={report.stagedNote} />
    <ServiceFacts title="Payments committed state" service={report.paymentsService} stagedNote={report.stagedNote} />
    <h4>Payment Processor visible authorizations</h4>
    {report.authorizations.length ? <ul className="fact-list">{report.authorizations.map(item => <li key={item.authorizationId}>
      {item.authorizationId} status {item.status}, amount {item.amount}, order {item.orderId}, payment {item.paymentId}.
    </li>)}</ul> : <p>No visible authorization is declared.</p>}
    <h4>Bus delivery</h4>
    <DeliveryList deliveries={report.deliveries} />
    <h4>Linked observations</h4>
    {report.evidence.length ? <div className="evidence-links">{report.evidence.map(item =>
      <button key={item.observationId} type="button" aria-controls="timeline-rows" onClick={() => onShowEvidence(item.observationId)}>{item.label}</button>)}</div>
      : <p>No fault, timeout, authorization, or delivery observation has been recorded yet.</p>}
  </section>;
}

export function ComponentRuntimeFacts({ report, componentId }: {
  readonly report: FaultReport;
  readonly componentId: string;
}): ReactNode {
  if (!report.studentFactsPresent) return <p>No student-visible state is projected for this component.</p>;
  if (componentId === "orders") return <ServiceFacts title="Runtime facts" service={report.orders} stagedNote={report.stagedNote} />;
  if (componentId === "payments") return <ServiceFacts title="Runtime facts" service={report.paymentsService} stagedNote={report.stagedNote} />;
  if (componentId === "payment-processor") return <>
    <h4>Runtime facts</h4>
    <p>Declared visible authorizations. Provider counters stay hidden.</p>
    {report.authorizations.length ? <ul className="fact-list">{report.authorizations.map(item => <li key={item.authorizationId}>
      {item.authorizationId} status {item.status}, amount {item.amount}, order {item.orderId}.
    </li>)}</ul> : <p>No visible authorization is declared.</p>}
  </>;
  if (componentId === "OrderCreated") return <>
    <h4>Runtime facts</h4>
    <DeliveryList deliveries={report.deliveries} />
  </>;
  if (componentId === "customer-app") return <>
    <h4>Runtime facts</h4>
    <p>Client-observed checkout request and outcome.</p>
    <dl>
      <dt>Request</dt><dd>{report.clientRequest}</dd>
      <dt>Outcome</dt><dd>{report.clientOutcome}</dd>
    </dl>
  </>;
  return <p>No student-visible state is projected for this component.</p>;
}
