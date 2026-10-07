/**
 * The review panel's requirement coverage: one row per requirement with its status, how it was
 * assessed, the critic's rationale, and the draft blocks it cites.
 *
 * It renders the same application data the CLI `status` command prints. Status is spelled out in
 * words so it never rests on colour alone, and a cited block that exists in the draft becomes a
 * button that jumps to it.
 */
import type { JSX } from "react";

import {
  type CoverageSummaryView,
  coverageBasisLabels,
  coverageStatusLabels,
  type ReviewCoverageView,
} from "./coverage-contract.js";
import type { ReviewSection } from "./model.js";
import { PanelToggle } from "./review-panels.js";

/** "3 judged · 2 satisfied · 1 not satisfied"; null when the critic judged nothing. */
export function coverageSummaryLine(coverage: ReviewCoverageView): string | null {
  const { summary } = coverage;
  const parts = coverageSummaryParts(summary);
  if (parts.length === 0) return null;
  const line = parts.join(" · ");
  return coverage.instructionsVersion === null
    ? line
    : `${line} · instructions ${coverage.instructionsVersion}`;
}

function coverageSummaryParts(summary: CoverageSummaryView): readonly string[] {
  if (summary.judged === 0 && summary.invalid === 0 && summary.unanswered === 0) return [];
  return [
    `${summary.judged} judged`,
    `${summary.satisfied} satisfied`,
    `${summary.notSatisfied} not satisfied`,
    ...(summary.invalid > 0 ? [`${summary.invalid} invalid`] : []),
    ...(summary.unanswered > 0 ? [`${summary.unanswered} unanswered`] : []),
  ];
}

function sectionTitlesByBlockId(sections: readonly ReviewSection[]): ReadonlyMap<string, string> {
  const titles = new Map<string, string>();
  for (const section of sections) {
    for (const block of section.blocks) titles.set(block.id, section.title);
  }
  return titles;
}

export function RequirementCoveragePanel({
  coverage,
  sections,
  collapsed,
  onToggle,
  onLocateBlock,
}: {
  readonly coverage: ReviewCoverageView;
  readonly sections: readonly ReviewSection[];
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly onLocateBlock: (blockId: string) => void;
}): JSX.Element {
  const titles = sectionTitlesByBlockId(sections);
  const summaryLine = coverageSummaryLine(coverage);
  return (
    <section className="panel coverage-panel" aria-label="requirement coverage">
      <div className="section-heading compact">
        <div>
          <PanelToggle
            label="Coverage"
            collapsed={collapsed}
            controls="coverage-panel-body"
            onToggle={onToggle}
          />
          <h2>Requirement coverage</h2>
          {summaryLine === null ? null : <p className="coverage-summary">{summaryLine}</p>}
        </div>
      </div>
      <div id="coverage-panel-body" hidden={collapsed}>
        <ul className="coverage-list" aria-label="Requirement coverage assessments">
          {coverage.assessments.map((assessment) => (
            <li
              className={`coverage-row coverage-status-${assessment.status}`}
              key={assessment.requirementId}
            >
              <div className="coverage-row-heading">
                <strong className="coverage-requirement">{assessment.requirementId}</strong>
                <span className="status-tag coverage-status">
                  {coverageStatusLabels[assessment.status]}
                </span>
              </div>
              <span className="coverage-basis">
                Assessed by {coverageBasisLabels[assessment.basis]}
              </span>
              <p className="coverage-rationale">{assessment.rationale}</p>
              {assessment.evidence.length === 0 ? null : (
                <ul
                  className="coverage-evidence"
                  aria-label={`Draft blocks cited for ${assessment.requirementId}`}
                >
                  {assessment.evidence.map((item) => {
                    const title = titles.get(item.blockId);
                    return (
                      <li key={item.blockId}>
                        {title === undefined ? (
                          <span className="coverage-block">{item.blockId}</span>
                        ) : (
                          <button
                            className="coverage-block coverage-block-link"
                            type="button"
                            title="Show this block in the draft"
                            onClick={() => onLocateBlock(item.blockId)}
                          >
                            {title}
                            <span className="coverage-block-id"> · {item.blockId}</span>
                            <span className="sr-only">, show in the draft</span>
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
