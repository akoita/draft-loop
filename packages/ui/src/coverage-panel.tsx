/**
 * The review panel's requirement coverage: one row per requirement with its status, how it was
 * assessed, the critic's rationale, and the draft blocks it cites.
 *
 * It renders the same application data the CLI `status` command prints. Status is spelled out in
 * words so it never rests on colour alone, and a cited block that exists in the draft becomes a
 * button that jumps to it. The verdicts never block approval, so the cards fold behind a one-line
 * tally until the reviewer asks for all of them.
 */

import type { JSX } from "react";
import {
  type CoverageSummaryView,
  coverageBasisLabels,
  coverageStatusLabels,
  type ReviewCoverageView,
} from "./coverage-contract.js";
import { COVERAGE_INFORMATION_NOTE } from "./finding-decision-help.js";
import type { ReviewSection } from "./model.js";
import { coverageCollapsedSummary, type ReviewWorkPanelProps } from "./review-work-tabs.js";

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

/** Where a cited block sits and how it starts, so a reader can tell the blocks apart. */
interface CitedBlock {
  readonly title: string;
  readonly opening: string;
}

/** Longest opening of a cited block shown beside its section title. */
export const COVERAGE_BLOCK_OPENING_LENGTH = 72;

/** The block's first words, cut at a word boundary with an ellipsis when it runs longer. */
export function blockOpening(text: string): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  if (flat.length <= COVERAGE_BLOCK_OPENING_LENGTH) return flat;
  const cut = flat.slice(0, COVERAGE_BLOCK_OPENING_LENGTH);
  const space = cut.lastIndexOf(" ");
  return `${(space > COVERAGE_BLOCK_OPENING_LENGTH / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function citedBlocksById(sections: readonly ReviewSection[]): ReadonlyMap<string, CitedBlock> {
  const blocks = new Map<string, CitedBlock>();
  for (const section of sections) {
    for (const block of section.blocks) {
      blocks.set(block.id, { title: section.title, opening: blockOpening(block.text) });
    }
  }
  return blocks;
}

export function RequirementCoveragePanel({
  coverage,
  sections,
  collapsed,
  onToggle,
  onLocateBlock,
  tabPanel = null,
}: {
  readonly coverage: ReviewCoverageView;
  readonly sections: readonly ReviewSection[];
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly onLocateBlock: (blockId: string) => void;
  /** The tabpanel ARIA when the panel sits under the Coverage tab. */
  readonly tabPanel?: ReviewWorkPanelProps | null;
}): JSX.Element {
  const citedBlocks = citedBlocksById(sections);
  const summaryLine = coverageSummaryLine(coverage);
  return (
    <section className="panel coverage-panel" aria-label="requirement coverage" {...tabPanel}>
      <div className="section-heading compact">
        <div>
          <h2>Requirement coverage</h2>
          <p className="coverage-information-note">{COVERAGE_INFORMATION_NOTE}</p>
          {summaryLine === null ? null : <p className="coverage-summary">{summaryLine}</p>}
        </div>
      </div>
      <p className="coverage-fold">
        <span className="coverage-tally">{coverageCollapsedSummary(coverage)}</span>
        {coverage.assessments.length === 0 ? null : (
          <>
            {" · "}
            <button
              className="coverage-fold-toggle"
              type="button"
              aria-expanded={!collapsed}
              aria-controls="coverage-panel-body"
              onClick={onToggle}
            >
              {collapsed ? "show all" : "show summary only"}
            </button>
          </>
        )}
      </p>
      <div id="coverage-panel-body" hidden={collapsed}>
        <ul className="coverage-list" aria-label="Requirement coverage assessments">
          {coverage.assessments.map((assessment) => (
            <li
              className={`coverage-row coverage-status-${assessment.status}`}
              key={assessment.requirementId}
            >
              <div className="coverage-row-heading">
                {/* The requirement as the candidate reviewed it; its id only when no text was
                    recorded, so a row is never left unnamed. */}
                <strong className="coverage-requirement">
                  {assessment.requirementText ?? assessment.requirementId}
                </strong>
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
                  aria-label={`Draft blocks cited for ${assessment.requirementText ?? assessment.requirementId}`}
                >
                  {assessment.evidence.map((item) => {
                    const cited = citedBlocks.get(item.blockId);
                    return (
                      <li key={item.blockId}>
                        {cited === undefined ? (
                          <span className="coverage-block">{item.blockId}</span>
                        ) : (
                          <button
                            className="coverage-block coverage-block-link"
                            type="button"
                            title="Show this block in the draft"
                            onClick={() => onLocateBlock(item.blockId)}
                          >
                            {cited.title}
                            <span className="coverage-block-opening"> · {cited.opening}</span>
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
