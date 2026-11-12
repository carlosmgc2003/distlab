import { ACTIVITY_SYMBOLS, activityDescription } from "./activity.ts";
import type { ComponentActivity } from "./activity.ts";
import { FLIGHT_PACES, flightPaceText } from "./flight.ts";
import { useMessages } from "./i18n/react.tsx";
import type { FlightPlayback } from "./flight-playback.ts";
import type { FlightPace, FlightPosition, FlightStep } from "./flight.ts";

/**
 * The **Replay** toolbar (#144): a one-row toolbar inside the Architecture tab, above the graph it
 * drives. It moves a browser cursor over movements the run already recorded and never changes the
 * simulation, so it shares no row or name with **Simulation execution** in the top bar.
 */
export function FlightControls({ playback }: { readonly playback: FlightPlayback }) {
  const m = useMessages();
  const { transport, pace } = playback;
  const control = transport.control;
  return <div className="replay-toolbar">
    {/* The visible group label; the group itself is named "Replay recorded movements". */}
    <span className="control-group-label" aria-hidden="true">{m.playback.toolbar.label}</span>
    <div className="control-buttons" role="group" aria-label={m.playback.toolbar.group} aria-describedby="flight-controls-help">
      {playback.phase === "playing" ? <button type="button" onClick={playback.pause}>{transport.pauseLabel}</button>
        : <button type="button" disabled={control.action === "unavailable"}
          // The label states the action: at the recorded end it promises a restart from the first movement.
          onClick={control.action === "restart" ? playback.restart : playback.play}>{control.label}</button>}
      <button type="button" disabled={!transport.previous} onClick={playback.previous}>{m.playback.toolbar.previous}</button>
      <button type="button" disabled={!transport.next} onClick={playback.next}>{m.playback.toolbar.next}</button>
    </div>
    <div className="flight-pace">
      <label htmlFor="flight-pace">{m.playback.toolbar.speed}</label>
      <select id="flight-pace" value={pace} disabled={playback.steps.length === 0}
        aria-describedby="flight-pace-help" onChange={event => playback.setPace(event.target.value as FlightPace)}>
        {FLIGHT_PACES.map(item => <option key={item.id} value={item.id} title={flightPaceText(item.id, m).note}>{flightPaceText(item.id, m).label}</option>)}
      </select>
    </div>
    <p id="flight-controls-help" className="sr-only">{m.playback.toolbar.help}</p>
  </div>;
}

/** The replay cursor's own position, stated once and kept beside the graph it drives. */
export function FlightReadout({ position }: { readonly position: FlightPosition }) {
  const m = useMessages();
  return <div className="flight-readout">
    <p className="flight-position" role="status" aria-label={m.playback.narration.position} aria-live="polite" aria-atomic="true">
      {position.text}
      {/* A jump names two recorded times. Playback never paints the interval as a duration. */}
      {position.jump ? <span className="flight-jump"> <span aria-hidden="true">⤼</span> {position.jump}</span> : null}
    </p>
    {position.detail ? <p className="flight-boundaries">{position.detail}</p> : null}
  </div>;
}

/**
 * The narration for the movement currently painted on the graph. Every line is a
 * presentation mapping over stored observation fields, plus one pattern question.
 */
export function FlightNarration({ step, activity, changes }: {
  readonly step: FlightStep;
  /** Activity at the cursor, read from records at or before it. */
  readonly activity: ReadonlyMap<string, ComponentActivity>;
  /** Activity that changed since the previous movement. */
  readonly changes: readonly string[];
}) {
  const m = useMessages();
  const busy = [...activity.values()].filter(item => item.state !== "idle" || item.timedOut !== undefined);
  return <article className={`flight-narration flight-${step.kind} shape-${step.shape}`}
    aria-label={m.playback.narration.region} data-flight={step.observationId}>
    {/* The graph's movement region. It restates the heading and the route for assistive
        technology rather than printing the same fact twice, then names what changed. */}
    <p id="movement-cue" className="sr-only" role="status" aria-label={m.architecture.view.movementRegion}>
      {[step.announcement, ...changes].join(" ")}
    </p>
    <h4><span className="flight-glyph" aria-hidden="true">{step.glyph}</span> {step.headline}</h4>
    <p className="flight-route">{step.route}</p>
    <p className="flight-transit">{step.transit}</p>
    {step.facts.length > 0 ? <dl className="flight-facts">
      {step.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
    </dl> : <p className="flight-facts-empty">{m.playback.narration.noFields}</p>}
    <p className="flight-pattern"><strong>{m.playback.narration.lookFor}</strong> {step.pattern}</p>
    {step.traceId !== undefined ? <p className="flight-trace">{m.playback.narration.trace(step.traceId)}</p> : null}
    <section className="flight-activity" aria-label={m.playback.narration.activityRegion}>
      <strong>{m.playback.narration.activityHeading}</strong>
      {busy.length > 0 ? <ul>{busy.map(item => <li key={item.componentId} className={`activity-${item.state}`}>
        <span className="activity-symbol" aria-hidden="true">{ACTIVITY_SYMBOLS[item.state]}</span> {activityDescription(item, m)}
      </li>)}</ul> : <p>{m.playback.narration.allIdle}</p>}
    </section>
    {step.leg === "timeout"
      ? <p className="flight-interrupted">{m.playback.narration.timeoutRests}</p>
      : step.interrupted ? <p className="flight-interrupted">{m.playback.narration.interrupted}</p> : null}
  </article>;
}
