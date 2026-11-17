import { type ProjectCardDetails, projectCardCommitShare } from "@draft-loop/schemas/project-card";
import type { WorkJournalStoredNote } from "@draft-loop/schemas/work-journal";

/**
 * An approved project card as career evidence (#2894): the Markdown sections of a `project`
 * source. Every number is written exactly as the card counted it, so extraction and validation
 * can match a CV claim against it. The `Project and links` section stays last, so the sensitivity
 * rule that hides a private repository's links covers it alone.
 */

const roleLabels: Readonly<Record<ProjectCardDetails["role"], string>> = {
  "sole-author": "Sole author",
  lead: "Lead developer",
  contributor: "Contributor",
};

export interface ProjectCardRenderParts {
  readonly heading: string;
  readonly plain: (value: string) => string;
  readonly bullet: (value: string) => string;
  /** The rendered `Project and links` list. */
  readonly project: string;
}

function yesNo(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : value ? "yes" : "no";
}

export function renderProjectCardSections(
  note: WorkJournalStoredNote,
  card: ProjectCardDetails,
  parts: ProjectCardRenderParts,
): string[] {
  const { content } = note;
  const { plain, bullet } = parts;
  const contribution = card.contribution;
  const counted = [
    `Own commits: ${contribution.own_commits} of ${contribution.total_commits} (${projectCardCommitShare(contribution)}%)`,
    `First commit: ${contribution.first_commit}`,
    `Last commit: ${contribution.last_commit}`,
    ...(contribution.merged_pull_requests === undefined
      ? []
      : [`Merged pull requests: ${contribution.merged_pull_requests}`]),
    `Other contributors: ${contribution.other_contributors}`,
  ];
  const scale = [
    ...(card.scale.releases === undefined ? [] : [`Releases: ${card.scale.releases}`]),
    ...(card.scale.stars === undefined ? [] : [`Stars: ${card.scale.stars}`]),
    ...(yesNo(card.scale.continuous_integration) === undefined
      ? []
      : [`Continuous integration: ${yesNo(card.scale.continuous_integration)}`]),
    ...(yesNo(card.scale.automated_tests) === undefined
      ? []
      : [`Automated tests: ${yesNo(card.scale.automated_tests)}`]),
  ];
  return [
    `# ${parts.heading}`,
    "Candidate-provided evidence: a project card about one code repository, counted from git by the candidate's agent and approved by the candidate.",
    "## Purpose",
    plain(card.purpose),
    "## Summary",
    plain(content.summary),
    "## Role",
    bullet(roleLabels[card.role]),
    "## Stack",
    content.technologies.map(bullet).join("\n"),
    "## Contribution",
    counted.map(bullet).join("\n"),
    "## Scale",
    scale.length === 0 ? "None recorded." : scale.map(bullet).join("\n"),
    "## Highlights",
    card.highlights.length === 0
      ? "None recorded."
      : card.highlights.map((item) => bullet(`${item.text} (source: ${item.source})`)).join("\n"),
    "## Project and links",
    parts.project,
  ];
}
