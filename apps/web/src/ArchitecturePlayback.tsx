import { ACTIVITY_SYMBOLS, activityDescription } from "./activity.ts";
import type { ComponentActivity } from "./activity.ts";
import { FLIGHT_PACES, flightPaceText } from "./flight.ts";
import { useMessages } from "./i18n/react.tsx";
import type { ComponentNames } from "./component-display.ts";
import type { PlaybackSettings } from "./flight-playback.ts";
import type { FlightPace } from "./flight.ts";
import { recordStepText, travelsLink } from "./playhead-steps.ts";
import type { PlayheadStep, RecordStep } from "./playhead-steps.ts";

/**
 * The playback settings (RFC 0002 P3): one slim row above the graph, where the Replay toolbar was.
 * **Animation** decides whether `Run` plays the run or shows its end; **Speed** is the pace of
 * play. Both are UI state and change nothing in the run.
 */
export function PlaybackSettingsBar({ settings }: { readonly settings: PlaybackSettings }) {
  const m = useMessages();
  const copy = m.playback.settings;
  return <div className="playback-settings" role="group" aria-label={copy.group} aria-describedby="playback-settings-help">
    <label className="playback-animation">
      <input type="checkbox" role="switch" checked={settings.animation} onChange={event => settings.setAnimation(event.target.checked)} />
      {copy.animation}
    </label>
    <div className="flight-pace">
      <label htmlFor="flight-pace">{copy.speed}</label>
      <select id="flight-pace" value={settings.pace} disabled={!settings.animation}
        aria-describedby="flight-pace-help" onChange={event => settings.setPace(event.target.value as FlightPace)}>
        {FLIGHT_PACES.map(item => <option key={item.id} value={item.id} title={flightPaceText(item.id, m).note}>{flightPaceText(item.id, m).label}</option>)}
      </select>
    </div>
    <p id="playback-settings-help" className="sr-only">{copy.help}</p>
  </div>;
}

/**
 * The narration for the milestone under the playhead, in three levels (RFC 0002): what was
 * recorded and where, then the one question to keep in mind, then everything else the record
 * stores, folded under **Recorded details**. A reader stepping through a run reads two short
 * lines per milestone and opens the rest when a milestone deserves it. A milestone that travels
 * no link is narrated the same way, at its component.
 *
 * Every line is a presentation mapping over stored observation fields, plus one pattern question.
 */
export function FlightNarration({ step, activity, changes, names, detailsOpen, onDetailsToggle, inTransit, jump }: {
  /** One sentence naming the virtual-time jump into this milestone, when time advanced since the previous one. */
  readonly jump?: string;
  /** One sentence naming the hops still in transit at the cursor, when there are any. */
  readonly inTransit?: string;
  readonly step: PlayheadStep;
  /** The session's component display names (#103), for the activity lines. */
  readonly names?: ComponentNames;
  /** Activity at the cursor, read from records at or before it. */
  readonly activity: ReadonlyMap<string, ComponentActivity>;
  /** Activity that changed since the previous movement. */
  readonly changes: readonly string[];
  /** Whether Recorded details is open. The caller keeps it, so it stays as chosen from movement to movement. */
  readonly detailsOpen: boolean;
  readonly onDetailsToggle: (open: boolean) => void;
}) {
  const m = useMessages();
  const busy = [...activity.values()].filter(item => item.state !== "idle" || item.timedOut !== undefined);
  const movement = travelsLink(step) ? step : undefined;
  const text = movement ?? recordStepText(step as RecordStep, m, names);
  const kind = movement ? `flight-${movement.kind} shape-${movement.shape}` : `flight-record record-${(step as RecordStep).recordKind}`;
  return <article className={`flight-narration ${kind}`}
    aria-label={m.playback.narration.region} data-flight={step.observationId}>
    {/* The graph's movement region. It restates the heading and the route for assistive
        technology rather than printing the same fact twice, then names what changed. */}
    <p id="movement-cue" className="sr-only" role="status" aria-label={m.architecture.view.movementRegion}>
      {[text.announcement, ...changes].join(" ")}
    </p>
    {/* Level 1: what was recorded, and between which components. */}
    <h4><span className="flight-glyph" aria-hidden="true">{text.glyph}</span> {step.headline}</h4>
    <p className="flight-route">{text.route}</p>
    {/* What a key-value record did, read from its stored fields. */}
    {!movement && (step as RecordStep).sentence !== undefined ? <p className="flight-sentence">{(step as RecordStep).sentence}</p> : null}
    {/* A jump names two recorded times. The playhead never paints the interval as a duration. */}
    {jump !== undefined ? <p className="flight-jump"><span aria-hidden="true">⤼</span> {jump}</p> : null}
    {/* The playhead shows one record at a time, so what left earlier and has not arrived is said here and drawn on its link. */}
    {inTransit !== undefined ? <p className="flight-in-transit">{inTransit}</p> : null}
    {/* Level 2: the question, and for a movement that did not arrive, what the record does not say. */}
    <p className="flight-pattern"><strong>{m.playback.narration.lookFor}</strong> {step.pattern}</p>
    {movement?.leg === "timeout"
      ? <p className="flight-interrupted">{m.playback.narration.timeoutRests}</p>
      : movement?.interrupted ? <p className="flight-interrupted">{m.playback.narration.interrupted}</p> : null}
    {/* Level 3: the rest of the record. The graph already shows component activity as badges. */}
    <details className="flight-details" open={detailsOpen} onToggle={event => onDetailsToggle(event.currentTarget.open)}>
      <summary>{m.playback.narration.details}</summary>
      <p className="flight-transit">{text.transit}</p>
      {step.facts.length > 0 ? <dl className="flight-facts">
        {step.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
      </dl> : <p className="flight-facts-empty">{m.playback.narration.noFields}</p>}
      {movement?.traceId !== undefined ? <p className="flight-trace">{m.playback.narration.trace(movement.traceId)}</p> : null}
      <section className="flight-activity" aria-label={m.playback.narration.activityRegion}>
        <strong>{m.playback.narration.activityHeading}</strong>
        {busy.length > 0 ? <ul>{busy.map(item => <li key={item.componentId} className={`activity-${item.state}`}>
          <span className="activity-symbol" aria-hidden="true">{ACTIVITY_SYMBOLS[item.state]}</span> {activityDescription(item, m, names)}
        </li>)}</ul> : <p>{m.playback.narration.allIdle}</p>}
      </section>
    </details>
  </article>;
}
