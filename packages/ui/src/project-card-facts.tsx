import { t } from "@lingui/core/macro";

/**
 * A project card's own facts in the Work journal review (#2895): what an agent counted from git
 * about one repository, shown so the candidate checks every number and highlight before
 * approving. It only arranges what the API returns.
 */

export type ProjectCardRole = "sole-author" | "lead" | "contributor";

/** A card's details as the API returns them on a stored note. */
export interface ProjectCardView {
  readonly purpose: string;
  readonly role: ProjectCardRole;
  readonly contribution: {
    readonly own_commits: number;
    readonly total_commits: number;
    readonly first_commit: string;
    readonly last_commit: string;
    readonly merged_pull_requests?: number | undefined;
    readonly other_contributors: number;
  };
  readonly scale: {
    readonly releases?: number | undefined;
    readonly stars?: number | undefined;
    readonly continuous_integration?: boolean | undefined;
    readonly automated_tests?: boolean | undefined;
  };
  readonly highlights: readonly { readonly text: string; readonly source: string }[];
}

export function projectCardRoleLabel(role: ProjectCardRole): string {
  switch (role) {
    case "sole-author":
      return t`Sole author`;
    case "lead":
      return t`Lead developer`;
    case "contributor":
      return t`Contributor`;
  }
}

/** The counted facts, one line each, in the order the source renders them. */
export function projectCardFactLines(card: ProjectCardView): string[] {
  const { contribution, scale } = card;
  const own = contribution.own_commits;
  const total = contribution.total_commits;
  const share = Math.round((own / total) * 100);
  const first = contribution.first_commit;
  const last = contribution.last_commit;
  const others = contribution.other_contributors;
  const lines = [
    t`${own} of ${total} commits (${share}%), ${first} to ${last}`,
    t`Other contributors: ${others}`,
  ];
  const merged = contribution.merged_pull_requests;
  if (merged !== undefined) lines.push(t`Merged pull requests: ${merged}`);
  const releases = scale.releases;
  if (releases !== undefined) lines.push(t`Releases: ${releases}`);
  const stars = scale.stars;
  if (stars !== undefined) lines.push(t`Stars: ${stars}`);
  if (scale.continuous_integration === true) lines.push(t`Has continuous integration`);
  if (scale.automated_tests === true) lines.push(t`Has automated tests`);
  return lines;
}

export function ProjectCardFacts({ card }: { readonly card: ProjectCardView }) {
  return (
    <div className="project-card-facts">
      <p>
        <strong>{t`Code project`}</strong> · {projectCardRoleLabel(card.role)} · {card.purpose}
      </p>
      <ul>
        {projectCardFactLines(card).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {card.highlights.length === 0 ? null : (
        <>
          <p className="muted">{t`Highlights, each with where the agent read it:`}</p>
          <ul>
            {card.highlights.map((highlight) => (
              <li key={`${highlight.text}|${highlight.source}`}>
                {highlight.text} <span className="muted">({highlight.source})</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
