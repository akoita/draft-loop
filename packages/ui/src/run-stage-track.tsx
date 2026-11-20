import { t } from "@lingui/core/macro";
import type { JSX } from "react";
import { countedNouns } from "./counted-nouns.js";
import type { ReviewScreenState } from "./model.js";
import { recordedRunModels, shortModelName } from "./run-details.js";
import {
  runStageTrack,
  type StageActor,
  type StageKind,
  type StageRound,
  type StageStatus,
  type StageStep,
  type StageTrack,
} from "./run-stage-track-model.js";

/**
 * The run header's stage track (#3214): which agent works each step, round by round.
 *
 * Wide, it shows the cast (author and critic with their models), a sentence on what happens now,
 * and one box per round with each step tagged by its actor; the person's approval gate follows.
 * Rounds before the last two fold into a disclosure. Narrow, only the sentence and a bar coloured
 * by actor show, and the same rounds open as a list under it. Both are native `details`, so they
 * work with the keyboard and screen readers without script.
 */
export function RunStageTrack({
  state,
}: {
  readonly state: Pick<
    ReviewScreenState,
    | "state"
    | "execution"
    | "round"
    | "reviewComplete"
    | "criticFallback"
    | "runId"
    | "applicationRuns"
  >;
}): JSX.Element {
  const track = runStageTrack({ ...state, models: recordedRunModels(state) });
  const now = nowSentence(track);
  const folded = track.rounds.slice(0, track.foldedRounds);
  const open = track.rounds.slice(track.foldedRounds);
  return (
    <div className="stage-track">
      <div className="stage-track-wide">
        <p className="stage-cast">
          <CastMember actor="author" model={track.cast.author} />
          <CastMember actor="critic" model={track.cast.critic} />
          <span className="stage-cast-member">
            <ActorBadge actor="you" />
            <strong>{t`You`}</strong> {t`approve`}
          </span>
        </p>
        <p className="stage-now">
          <NowMark track={track} />
          {now}
        </p>
        <ol className="stage-rounds" aria-label={t`Rounds and who works each step`}>
          {folded.length === 0 ? null : (
            <li className="stage-round stage-round-folded">
              <details>
                <summary>
                  <span className="stage-round-label">
                    {folded.length === 1 ? t`Round 1` : t`Rounds 1–${folded.length}`}
                  </span>
                  <span className="stage-dots" aria-hidden="true">
                    {folded.map((round) => (
                      <span key={round.number}>
                        <span className="stage-dot stage-dot-author" />
                        <span className="stage-dot stage-dot-critic" />
                      </span>
                    ))}
                  </span>
                  <span className="stage-fold-hint">{t`Show`}</span>
                </summary>
                <ol className="stage-rounds stage-rounds-nested">
                  {folded.map((round) => (
                    <RoundBox key={round.number} round={round} current={false} />
                  ))}
                </ol>
              </details>
            </li>
          )}
          {open.map((round) => (
            <RoundBox
              key={round.number}
              round={round}
              current={round.number === track.round && track.gate === "waiting"}
            />
          ))}
          <li
            className={`stage-round stage-gate${track.gate === "active" ? " stage-round-current" : ""}`}
          >
            <span className="stage-round-label">
              {track.gate === "active" ? t`Your gate · now` : t`Your gate`}
            </span>
            <span className="stage-steps">
              <span
                className={`stage-step stage-step-you stage-step-${track.gate}`}
                {...(track.gate === "active" ? { "aria-current": "step" as const } : {})}
              >
                <ActorBadge actor="you" />
                <span className="stage-step-label">{t`Approve`}</span>
                <StatusText status={track.gate} />
              </span>
            </span>
          </li>
        </ol>
      </div>
      <details className="stage-track-narrow">
        <summary>
          <span className="stage-now">
            <NowMark track={track} />
            {now}
          </span>
          <span className="stage-bar" aria-hidden="true">
            {track.rounds.map((round) => (
              <span className="stage-bar-round" key={round.number}>
                {round.steps.map((step) => (
                  <span
                    key={step.kind}
                    className={`stage-bar-seg stage-bar-${step.actor} stage-bar-${step.status}`}
                  />
                ))}
              </span>
            ))}
            <span className={`stage-bar-seg stage-bar-gate stage-bar-${track.gate}`} />
          </span>
        </summary>
        <p className="stage-cast">
          <CastMember actor="author" model={track.cast.author} />
          <CastMember actor="critic" model={track.cast.critic} />
        </p>
        <ol className="stage-timeline">
          {track.rounds.map((round) => (
            <li key={round.number}>
              <span className="stage-round-label">
                {t`Round ${round.number}`}
                {round.criticChanged ? ` · ${t`critic changed`}` : ""}
              </span>
              <ul>
                {round.steps.map((step) => (
                  <li key={step.kind} className={`stage-step-${step.status}`}>
                    <ActorBadge actor={step.actor} />
                    <span className="stage-step-label">{stepLabel(step.kind)}</span>
                    {step.model === null ? null : (
                      <span className="stage-step-model">{shortModelName(step.model)}</span>
                    )}
                    <StatusText status={step.status} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
          <li>
            <span className="stage-round-label">{t`Your gate`}</span>
            <ul>
              <li className={`stage-step-${track.gate}`}>
                <ActorBadge actor="you" />
                <span className="stage-step-label">{t`Approve`}</span>
                <StatusText status={track.gate} />
              </li>
            </ul>
          </li>
        </ol>
      </details>
    </div>
  );
}

function RoundBox({
  round,
  current,
}: {
  readonly round: StageRound;
  readonly current: boolean;
}): JSX.Element {
  return (
    <li className={`stage-round${current ? " stage-round-current" : ""}`}>
      <span className="stage-round-label">
        {current ? t`Round ${round.number} · now` : t`Round ${round.number}`}
        {round.criticChanged ? (
          <span className="stage-round-changed"> · {t`critic changed`}</span>
        ) : null}
      </span>
      <span className="stage-steps">
        {round.steps.map((step) => (
          <StepChip key={step.kind} step={step} />
        ))}
      </span>
    </li>
  );
}

function StepChip({ step }: { readonly step: StageStep }): JSX.Element {
  return (
    <span
      className={`stage-step stage-step-${step.actor} stage-step-${step.status}`}
      {...(step.status === "active" ? { "aria-current": "step" as const } : {})}
    >
      <ActorBadge actor={step.actor} />
      <span className="stage-step-label">{stepLabel(step.kind)}</span>
      {step.model === null ? null : (
        <span className="stage-step-model">{shortModelName(step.model)}</span>
      )}
      <StatusText status={step.status} />
    </span>
  );
}

function CastMember({
  actor,
  model,
}: {
  readonly actor: "author" | "critic";
  readonly model: string;
}): JSX.Element {
  return (
    <span className="stage-cast-member">
      <ActorBadge actor={actor} />
      <strong>{actorName(actor)}</strong>
      {model === "" ? null : <span className="stage-cast-model">{shortModelName(model)}</span>}
    </span>
  );
}

/** A role badge: a letter on the role's colour, so colour is never the only cue. */
function ActorBadge({ actor }: { readonly actor: StageActor }): JSX.Element {
  return (
    <span className={`stage-badge stage-badge-${actor}`} aria-hidden="true">
      {actor === "author" ? t`A` : actor === "critic" ? t`C` : t`Y`}
    </span>
  );
}

/** The step's state, spoken in full and shown as a mark. */
function StatusText({ status }: { readonly status: StageStatus }): JSX.Element {
  if (status === "done") {
    return (
      <span className="stage-step-status">
        <span aria-hidden="true">✓</span>
        <span className="sr-only">{t`done`}</span>
      </span>
    );
  }
  if (status === "active") return <span className="sr-only">{t`now`}</span>;
  return <span className="sr-only">{t`next`}</span>;
}

function NowMark({ track }: { readonly track: StageTrack }): JSX.Element | null {
  const now = track.now;
  if (now.kind === "working") {
    return <span className={`stage-pulse stage-pulse-${now.actor}`} aria-hidden="true" />;
  }
  if (now.kind === "stalled") return <ActorBadge actor={now.actor} />;
  if (now.kind === "deciding") return <ActorBadge actor="you" />;
  return null;
}

function actorName(actor: StageActor): string {
  if (actor === "author") return t`Author`;
  if (actor === "critic") return t`Critic`;
  return t`You`;
}

function stepLabel(kind: StageKind): string {
  if (kind === "draft") return t`Draft`;
  if (kind === "critique") return t`Critique`;
  return t`Revise`;
}

/** One sentence on what happens now, naming the actor and its model. */
export function nowSentence(track: StageTrack): string {
  const now = track.now;
  const round = track.round;
  switch (now.kind) {
    case "collecting":
      return t`Waiting for the first draft`;
    case "deciding":
      return t`Your turn: review the findings, then approve`;
    case "approved":
      return t`Approved after ${countedNouns.round(round)}`;
    case "working":
    case "stalled": {
      const model = now.actor === "author" ? track.cast.author : track.cast.critic;
      const who =
        model === "" ? actorName(now.actor) : `${actorName(now.actor)} (${shortModelName(model)})`;
      if (now.kind === "stalled") {
        return now.step === "critique"
          ? t`${who} stopped while critiquing · round ${round}`
          : now.step === "draft"
            ? t`${who} stopped while drafting · round ${round}`
            : t`${who} stopped while revising · round ${round}`;
      }
      return now.step === "critique"
        ? t`${who} is critiquing the draft · round ${round}`
        : now.step === "draft"
          ? t`${who} is drafting · round ${round}`
          : t`${who} is revising the draft · round ${round}`;
    }
  }
}
