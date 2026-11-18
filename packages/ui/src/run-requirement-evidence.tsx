/**
 * The **Evidence for each requirement** section of Run details (#3011): each job requirement of
 * the run with the sources that may support it. Scores, how each source matched and the grader's
 * verdicts sit under Advanced options. The section is folded by default and absent for a run with
 * no map, a host without the read or a read that fails: the run's review never depends on it.
 */
import { plural, t } from "@lingui/core/macro";
import { type JSX, useEffect, useState } from "react";
import { AdvancedOptions } from "./advanced-options.js";
import type {
  RequirementEvidenceCandidateView,
  RequirementEvidenceGrade,
  RequirementEvidenceOrigin,
  RunRequirementEvidenceView,
} from "./run-requirement-evidence-contract.js";
import {
  candidateLines,
  type RequirementEvidenceDisplay,
  type RequirementEvidenceSourceLine,
  requirementEvidenceDisplay,
} from "./run-requirement-evidence-model.js";

/** Reads one run's map; Run details passes it only on a host that offers the read. */
export type LoadRunRequirementEvidence = (
  runId: string,
) => Promise<RunRequirementEvidenceView | null>;

function sourceLabel(entry: RequirementEvidenceSourceLine): string {
  const name = entry.source ?? t`unnamed source`;
  return entry.lines === null ? name : t`${name}, lines ${entry.lines}`;
}

function originLabel(origin: RequirementEvidenceOrigin): string {
  switch (origin) {
    case "semantic":
      return t`meaning`;
    case "keyword":
      return t`keywords`;
    default:
      return t`meaning and keywords`;
  }
}

function gradeLabel(grade: RequirementEvidenceGrade | undefined): string {
  switch (grade) {
    case "supports":
      return t`supports`;
    case "partly-supports":
      return t`partly supports`;
    case "does-not-support":
      return t`does not support`;
    default:
      return t`not graded`;
  }
}

function matchedBy(view: RunRequirementEvidenceView): string {
  if (view.mode === "semantic") {
    return view.modelId === undefined
      ? t`Ranked by meaning with the local model, then by keywords.`
      : t`Ranked by meaning with ${view.modelId}, then by keywords.`;
  }
  return view.reason === undefined
    ? t`Ranked by keywords only.`
    : t`Ranked by keywords only (${view.reason}).`;
}

function gradingNote(view: RunRequirementEvidenceView): string {
  switch (view.grading) {
    case "graded":
      return t`The critic model graded each source; sources it found unsupportive are left out above.`;
    case "failed":
      return t`Grading was attempted but failed, so no source was left out.`;
    default:
      return t`This run did not grade the sources.`;
  }
}

function CandidateRow({
  candidate,
}: {
  readonly candidate: RequirementEvidenceCandidateView;
}): JSX.Element {
  return (
    <li className="requirement-evidence-candidate">
      <span>
        {sourceLabel({ source: candidate.source ?? null, lines: candidateLines(candidate) })}
      </span>
      <span>{t`matched by ${originLabel(candidate.origin)}`}</span>
      {candidate.score === undefined ? null : (
        <span className="numeric">{t`score ${candidate.score.toFixed(2)}`}</span>
      )}
      <span>{gradeLabel(candidate.grade)}</span>
    </li>
  );
}

/** The folded section itself; nothing for a map with no requirement. */
export function RequirementEvidenceList({
  view,
}: {
  readonly view: RunRequirementEvidenceView;
}): JSX.Element | null {
  const display: RequirementEvidenceDisplay = requirementEvidenceDisplay(view);
  if (display.rows.length === 0) return null;
  const total = display.rows.length;
  const supported = display.supportedCount;
  return (
    <details className="run-steps requirement-evidence">
      <summary>
        <span className="run-steps-title">{t`Evidence for each requirement`}</span>{" "}
        <span className="run-steps-summary">
          {t`${supported} of ${plural(total, { one: "# requirement", other: "# requirements" })} with evidence`}
        </span>
      </summary>
      <p className="setup-note">{t`The sources the writer and critic were pointed to for each job requirement. A requirement with no source may still be covered elsewhere in your evidence.`}</p>
      <ol className="requirement-evidence-list">
        {display.rows.map((row, index) => (
          <li key={row.requirementId}>
            <strong>{row.text ?? t`Requirement ${index + 1}`}</strong>
            {row.sources.length === 0 ? (
              <p className="setup-note">{t`No evidence found`}</p>
            ) : (
              <ul>
                {row.sources.map((entry) => (
                  <li key={`${entry.source ?? ""}:${entry.lines ?? ""}`}>{sourceLabel(entry)}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      <AdvancedOptions>
        <p className="setup-note">{matchedBy(view)}</p>
        <p className="setup-note">{gradingNote(view)}</p>
        <ol className="requirement-evidence-list">
          {display.rows.map((row, index) => (
            <li key={row.requirementId}>
              <strong>{row.text ?? t`Requirement ${index + 1}`}</strong>
              {row.candidates.length === 0 ? (
                <p className="setup-note">{t`No candidate`}</p>
              ) : (
                <ul>
                  {row.candidates.map((candidate) => (
                    <CandidateRow key={candidate.chunkId} candidate={candidate} />
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </AdvancedOptions>
    </details>
  );
}

/**
 * Loads the run's map while Run details is open and shows it. A read that fails shows nothing:
 * the map is extra detail, and the drawer's other facts stand without it.
 */
export function RunRequirementEvidence({
  runId,
  active,
  load,
}: {
  readonly runId: string;
  /** True while the drawer is open on a run that is not executing. */
  readonly active: boolean;
  readonly load: LoadRunRequirementEvidence;
}): JSX.Element | null {
  const [loaded, setLoaded] = useState<{
    readonly runId: string;
    readonly view: RunRequirementEvidenceView;
  } | null>(null);
  useEffect(() => {
    if (!active) return;
    let current = true;
    load(runId).then(
      (view) => {
        if (current) setLoaded(view === null ? null : { runId, view });
      },
      () => {
        if (current) setLoaded(null);
      },
    );
    return () => {
      current = false;
    };
  }, [active, runId, load]);
  if (loaded === null || loaded.runId !== runId) return null;
  return <RequirementEvidenceList view={loaded.view} />;
}
