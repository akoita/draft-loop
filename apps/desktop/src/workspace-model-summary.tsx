import type { ModelProfileReferences } from "@draft-loop/application/model-profile-selection";

import {
  modelProfilePresetReferences,
  modelProfilePresets,
  modelProfileReferencesEqual,
} from "./model-profile-picker-state.js";
import {
  modelDisplayName,
  presetDisplayName,
  providerDisplayName,
} from "./model-profile-presentation.js";

export interface WorkspaceModelSummarySide {
  readonly company: string;
  readonly model: string;
}

export interface WorkspaceModelSummaryProps {
  readonly title: string;
  readonly author: WorkspaceModelSummarySide;
  readonly critic: WorkspaceModelSummarySide;
  readonly appliedProfiles?: ModelProfileReferences | null;
  /** Said when the next run would attach no model profiles. */
  readonly profileWarning?: string | null;
  /** One line naming the pair, with the exact ids and profiles behind Details. */
  readonly compact?: boolean;
}

function SummaryRow({
  label,
  side,
}: {
  readonly label: string;
  readonly side: WorkspaceModelSummarySide;
}) {
  return (
    <div className="workspace-model-summary-row">
      <dt>{label}</dt>
      <dd>
        <span className="workspace-model-summary-name">{modelDisplayName(side.model)}</span>
        <span className="workspace-model-summary-provider">
          {providerDisplayName(side.company)}
        </span>
        <code className="workspace-model-summary-id">
          {side.company}/{side.model}
        </code>
      </dd>
    </div>
  );
}

function appliedProfilesLine(applied: ModelProfileReferences) {
  const preset = modelProfilePresets.find((candidate) =>
    modelProfileReferencesEqual(modelProfilePresetReferences(candidate), applied),
  );
  if (preset !== undefined) {
    return (
      <p className="workspace-model-summary-profiles">Preset: {presetDisplayName(preset.label)}</p>
    );
  }
  return (
    <p className="workspace-model-summary-profiles">
      Custom profile pair
      <code className="workspace-model-summary-id">
        {applied.author.id}@{applied.author.version} and {applied.critic.id}@
        {applied.critic.version}
      </code>
    </p>
  );
}

export function WorkspaceModelSummary({
  title,
  author,
  critic,
  appliedProfiles = null,
  profileWarning = null,
  compact = false,
}: WorkspaceModelSummaryProps) {
  if (compact) {
    // One line naming the pair; the ids and the applied profiles sit behind Details.
    return (
      <section
        className="workspace-model-summary workspace-model-summary-compact"
        aria-label={title}
      >
        <h3 className="sr-only">{title}</h3>
        <p className="workspace-model-summary-line">
          <strong>{modelDisplayName(author.model)}</strong> writes
          <span aria-hidden="true"> · </span>
          <strong>{modelDisplayName(critic.model)}</strong> reviews
        </p>
        <details className="workspace-model-summary-details">
          <summary>Details</summary>
          <dl className="workspace-model-summary-rows">
            <SummaryRow label="Writer" side={author} />
            <SummaryRow label="Reviewer" side={critic} />
          </dl>
          {appliedProfiles === null ? null : appliedProfilesLine(appliedProfiles)}
        </details>
        {profileWarning === null ? null : (
          <p className="workspace-model-summary-profiles" role="status">
            {profileWarning}
          </p>
        )}
      </section>
    );
  }
  return (
    <section className="workspace-model-summary" aria-label={title}>
      <h2 className="eyebrow">{title}</h2>
      <dl className="workspace-model-summary-rows">
        <SummaryRow label="Writer" side={author} />
        <SummaryRow label="Reviewer" side={critic} />
      </dl>
      {appliedProfiles === null ? null : appliedProfilesLine(appliedProfiles)}
      {profileWarning === null ? null : (
        <p className="workspace-model-summary-profiles" role="status">
          {profileWarning}
        </p>
      )}
    </section>
  );
}
