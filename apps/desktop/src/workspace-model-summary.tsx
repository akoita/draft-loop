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
}: WorkspaceModelSummaryProps) {
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
