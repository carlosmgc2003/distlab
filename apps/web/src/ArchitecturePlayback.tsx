import { FLIGHT_PACES } from "./flight.ts";
import type { FlightPlayback } from "./flight-playback.ts";
import type { FlightPace, FlightPosition, FlightStep } from "./flight.ts";

const TRANSPORT_HELP = "These controls move a browser cursor over movements the run has already recorded. "
  + "They send no simulation command, do not change virtual time, and do not record observations.";

/**
 * Recorded history navigation for the architecture graph, shown on the command row
 * beside the simulation commands and kept visually apart from them. This group
 * replays movements that are already recorded; it never changes the simulation.
 */
export function FlightControls({ playback }: { readonly playback: FlightPlayback }) {
  const { transport, pace } = playback;
  const control = transport.control;
  return <div className="flight-nav-group">
    <h2 className="control-group-label">Recorded history</h2>
    <div className="control-buttons" role="group" aria-label="Recorded history navigation" aria-describedby="flight-controls-help">
      {playback.phase === "playing" ? <button type="button" onClick={playback.pause}>Pause timeline</button>
        : <button type="button" disabled={control.action === "unavailable"}
          // The label states the action: at the recorded end it promises a restart from the first movement.
          onClick={control.action === "restart" ? playback.restart : playback.play}>{control.label}</button>}
      <button type="button" disabled={!transport.previous} onClick={playback.previous}>Previous observation</button>
      <button type="button" disabled={!transport.next} onClick={playback.next}>Next observation</button>
    </div>
    <div className="flight-pace">
      <label htmlFor="flight-pace">Speed</label>
      <select id="flight-pace" value={pace} disabled={playback.steps.length === 0}
        aria-describedby="flight-pace-help" onChange={event => playback.setPace(event.target.value as FlightPace)}>
        {FLIGHT_PACES.map(item => <option key={item.id} value={item.id} title={item.note}>{item.label}</option>)}
      </select>
    </div>
    <p id="flight-controls-help" className="sr-only">{TRANSPORT_HELP}</p>
  </div>;
}

/** The replay cursor's own position, stated once and kept beside the graph it drives. */
export function FlightReadout({ position }: { readonly position: FlightPosition }) {
  return <div className="flight-readout">
    <p className="flight-position" role="status" aria-label="Architecture playback position" aria-live="polite" aria-atomic="true">{position.text}</p>
    {position.detail ? <p className="flight-boundaries">{position.detail}</p> : null}
  </div>;
}

/**
 * The narration for the movement currently painted on the graph. Every line is a
 * presentation mapping over stored observation fields, plus one pattern question.
 */
export function FlightNarration({ step }: { readonly step: FlightStep }) {
  return <article className={`flight-narration flight-${step.kind} shape-${step.shape}`}
    aria-label="Recorded movement" data-flight={step.observationId}>
    {/* The graph's movement region. It restates the heading and the route for assistive
        technology rather than printing the same fact twice. */}
    <p id="movement-cue" className="sr-only" role="status" aria-label="Request and message movement">{step.announcement}</p>
    <h4><span className="flight-glyph" aria-hidden="true">{step.glyph}</span> {step.headline}</h4>
    <p className="flight-route">{step.route}</p>
    {step.facts.length > 0 ? <dl className="flight-facts">
      {step.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
    </dl> : <p className="flight-facts-empty">This record stores no further fields for narration.</p>}
    <p className="flight-pattern"><strong>What to look for</strong> {step.pattern}</p>
    {step.traceId !== undefined ? <p className="flight-trace">Trace {step.traceId}</p> : null}
    {step.interrupted ? <p className="flight-interrupted">The token stops on this link. This record states that the movement did not arrive; it does not state what either component concluded.</p> : null}
  </article>;
}
