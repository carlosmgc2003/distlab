import { Fragment, type ReactNode } from "react";
import { HelpHint } from "./ui-hint.tsx";
import { faultStatusLabel } from "./fault-inspection.ts";
import type { DeliveryFact, FaultReport, RowFact, ServiceSnapshot } from "./fault-inspection.ts";
import { useMessages } from "./i18n/react.tsx";
import { Rich } from "./i18n/rich.tsx";

function Rows({ rows }: { readonly rows: readonly RowFact[] }) {
  const m = useMessages();
  if (!rows.length) return <p>{m.faultInspection.view.noCommittedRows}</p>;
  return <ul className="fact-list">{rows.map(row => <li key={`${row.table}:${row.key}`}>
    <span>{row.table} / {row.key}</span>
    {row.fields.length ? <dl>{row.fields.map(field => <Fragment key={field.name}><dt>{field.name}</dt><dd>{field.value}</dd></Fragment>)}</dl> : null}
  </li>)}</ul>;
}

function stateClass(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes("unknown") || normalized.includes("uncertain")) return "semantic-state is-uncertain";
  if (normalized.includes("timeout") || normalized.includes("fault") || normalized.includes("failed")) return "semantic-state is-warning";
  if (normalized.includes("approved") || normalized.includes("authorized") || normalized.includes("committed") || normalized.includes("success")) return "semantic-state is-approved";
  return "semantic-state";
}

function ServiceFacts({ title, service, stagedNote }: {
  readonly title: string;
  readonly service: ServiceSnapshot | null;
  readonly stagedNote: string;
}) {
  const m = useMessages();
  const v = m.faultInspection.view;
  return <>
    <h4>{title}</h4>
    {service ? <>
      <dl>
        <dt>{v.lifecycle}</dt><dd>{service.lifecycle}</dd>
        <dt>{v.processGeneration}</dt><dd>{service.processGeneration}</dd>
        <dt>{v.committedRevision}</dt><dd>{service.revision}</dd>
      </dl>
      <details className="raw-state">
        <summary>{v.stateDetails(service.rows.length)}</summary>
        <p>{stagedNote}</p>
        <Rows rows={service.rows} />
      </details>
    </> : <p>{v.serviceNotProjected}</p>}
  </>;
}

function DeliveryList({ deliveries }: { readonly deliveries: readonly DeliveryFact[] }) {
  const v = useMessages().faultInspection.view;
  if (!deliveries.length) return <p>{v.noBusDelivery}</p>;
  return <ul className="fact-list">{deliveries.map(delivery => <li key={delivery.messageId}>
    {delivery.consumer
      ? v.deliveryConsumer({ destination: delivery.destination, state: delivery.state, attempt: delivery.attempt, consumer: delivery.consumer, messageId: delivery.messageId })
      : v.delivery({ destination: delivery.destination, state: delivery.state, attempt: delivery.attempt, messageId: delivery.messageId })}
  </li>)}</ul>;
}

export function DistributedState({ report, onShowEvidence }: {
  readonly report: FaultReport;
  readonly onShowEvidence: (observationId: string) => void;
}) {
  const m = useMessages();
  const v = m.faultInspection.view;
  return <section className="state-inspection" aria-labelledby="distributed-state-heading">
    <h3 id="distributed-state-heading">{v.distributedState}</h3>
    <HelpHint label={v.aboutSession}>{v.aboutSessionBody}</HelpHint>
    <dl>
      <dt>{v.scenario}</dt><dd>{report.scenarioName}</dd>
      <dt>{v.seed}</dt><dd>{report.seed}</dd>
      <dt>{v.faultStatus}</dt><dd>{v.statusIs(faultStatusLabel(report.faultStatus, m))}</dd>
    </dl>
    {report.faults.length ? <ul className="fact-list">{report.faults.map(fault => <li key={fault.id}>
      {v.fault({
        id: fault.id, point: fault.point, effect: fault.effect, status: faultStatusLabel(fault.status, m),
        ...(fault.source ? { source: fault.source } : {}), ...(fault.target ? { target: fault.target } : {}), ...(fault.name ? { name: fault.name } : {}),
      })}
    </li>)}</ul> : <p>{v.noFaultRule}</p>}
    {report.lesson ? <p>{report.lesson}</p> : null}
    <h4>{v.localVsProcessor}</h4>
    <p className="comparison-note">{v.observedNote}</p>
    <div className="outcome-comparison">
      <section aria-label={v.paymentsKnowledgeRegion}>
        <h5>{v.paymentsKnows}</h5>
        {report.paymentRows.length ? report.paymentRows.map(payment => <p key={payment.paymentId}>
          <span className={stateClass(payment.state)}>{payment.state}</span>
          {payment.outcome ? <> · {payment.outcome}</> : null} · {v.authorizationId(payment.authorizationId ?? m.faultInspection.none)}
        </p>) : <p>{v.noLocalPaymentObserved}</p>}
      </section>
      <section aria-label={v.processorOutcomeRegion}>
        <h5>{v.processorFact}</h5>
        {report.authorizations.length ? report.authorizations.map(item => <p key={item.authorizationId}>
          <span className={stateClass(item.status)}>{item.status}</span> · {item.authorizationId}
        </p>) : <p>{v.noAuthorizationVisible}</p>}
      </section>
    </div>
    <p className="knowledge-boundary">{report.knowledge}</p>
    <h4>{v.customerAppOutcome}</h4>
    <dl>
      <dt>{v.request}</dt><dd>{report.clientRequest}</dd>
      <dt>{v.outcome}</dt><dd><span className={stateClass(report.clientOutcome)}>{report.clientOutcome}</span>
        {report.clientOutcome.toLowerCase().includes("unknown") ? <span className="state-explanation">{" "}{v.clientUncertain}</span> : null}</dd>
    </dl>
    <details className="raw-state">
      <summary>{v.rawRecords}</summary>
      <h4>{v.paymentsLocalOutcomes}</h4>
    {report.paymentRows.length ? <ul className="fact-list">{report.paymentRows.map(payment => <li key={payment.paymentId}>
      <Rich text={v.paymentRow} values={{ payment: payment.paymentId, order: payment.orderId, state: <span className={stateClass(payment.state)}>{payment.state}</span> }} />
      {payment.outcome ? <> · <Rich text={v.paymentRowOutcome} values={{ outcome: <span className={stateClass(payment.outcome)}>{payment.outcome}</span> }} /></> : null}
      {payment.state === "UNKNOWN" ? <span className="state-explanation">{" "}{v.paymentUncertain}</span> : null}
    </li>)}</ul> : <p>{v.noLocalPaymentCommitted}</p>}
    <ServiceFacts title={v.ordersCommitted} service={report.orders} stagedNote={report.stagedNote} />
    <ServiceFacts title={v.paymentsCommitted} service={report.paymentsService} stagedNote={report.stagedNote} />
    <h4>{v.processorAuthorizations}</h4>
    {report.authorizations.length ? <ul className="fact-list">{report.authorizations.map(item => <li key={item.authorizationId}>
      <Rich text={v.authorizationRow} values={{ id: item.authorizationId, status: <span className={stateClass(item.status)}>{item.status}</span>, amount: item.amount, order: item.orderId, payment: item.paymentId }} />
    </li>)}</ul> : <p>{v.noAuthorizationDeclared}</p>}
    <h4>{v.busDelivery}</h4>
    <DeliveryList deliveries={report.deliveries} />
    </details>
    <h4>{v.linkedObservations}</h4>
    {report.evidence.length ? <div className="evidence-links">{report.evidence.map(item =>
      <button key={item.observationId} type="button" aria-controls="timeline-rows" onClick={() => onShowEvidence(item.observationId)}>{item.label}</button>)}</div>
      : <p>{v.noEvidence}</p>}
  </section>;
}

export function ComponentRuntimeFacts({ report, componentId }: {
  readonly report: FaultReport;
  readonly componentId: string;
}): ReactNode {
  const v = useMessages().faultInspection.view;
  if (!report.studentFactsPresent) return <p>{v.noStudentState}</p>;
  // Roles come from the architecture's models, so renamed components show the same facts.
  const { roles } = report;
  if (componentId === roles.orders) return <ServiceFacts title={v.runtimeFacts} service={report.orders} stagedNote={report.stagedNote} />;
  if (componentId === roles.payments) return <ServiceFacts title={v.runtimeFacts} service={report.paymentsService} stagedNote={report.stagedNote} />;
  if (componentId === roles.processor) return <>
    <h4>{v.runtimeFacts}</h4>
    <p>{v.processorFacts}</p>
    {report.authorizations.length ? <ul className="fact-list">{report.authorizations.map(item => <li key={item.authorizationId}>
      {v.processorAuthorizationRow({ id: item.authorizationId, status: item.status, amount: String(item.amount), order: item.orderId })}
    </li>)}</ul> : <p>{v.noAuthorizationDeclared}</p>}
  </>;
  if (roles.destinations.includes(componentId)) return <>
    <h4>{v.runtimeFacts}</h4>
    <DeliveryList deliveries={report.deliveries.filter(delivery => delivery.destination === componentId)} />
  </>;
  if (componentId === roles.client) return <>
    <h4>{v.runtimeFacts}</h4>
    <p>{v.clientFacts}</p>
    <dl>
      <dt>{v.request}</dt><dd>{report.clientRequest}</dd>
      <dt>{v.outcome}</dt><dd>{report.clientOutcome}</dd>
    </dl>
  </>;
  return <p>{v.noStudentState}</p>;
}
