import type { ModelProfileReferences } from "@draft-loop/application/model-profile-selection";

import type { ModelProfileSupportResult } from "./bridge.js";
import { ProfileDetails } from "./model-profile-details.js";
import {
  modelProfileEntryForReference,
  modelProfilePresetReferences,
  modelProfilePresets,
  modelProfileReferencesEqual,
  withModelProfileLevels,
} from "./model-profile-picker-state.js";
import {
  modelDisplayName,
  presetDisplayName,
  providerDisplayName,
} from "./model-profile-presentation.js";
import type { WorkspaceModelSummarySide } from "./workspace-model-summary.js";

export interface ModelEditorSummaryProps {
  /** The workspace's configured destinations. */
  readonly author: WorkspaceModelSummarySide;
  readonly critic: WorkspaceModelSummarySide;
  /** The applied profile pair, or `null` while new runs use the workspace models alone. */
  readonly applied: ModelProfileReferences | null;
  readonly support: ModelProfileSupportResult | undefined;
}

/**
 * The applied pair's name: a preset's or "Custom pair", with any chosen reasoning levels, such as
 * "Balanced · writer high"; `null` when no pair is applied.
 */
export function appliedPairName(applied: ModelProfileReferences | null): string | null {
  if (applied === null) return null;
  const preset = modelProfilePresets.find((candidate) =>
    modelProfileReferencesEqual(modelProfilePresetReferences(candidate), applied),
  );
  return withModelProfileLevels(
    preset === undefined ? "Custom pair" : presetDisplayName(preset.label),
    applied,
  );
}

function sideModelName(
  side: WorkspaceModelSummarySide,
  applied: ModelProfileReferences | null,
  role: "author" | "critic",
): string {
  const entry = applied === null ? undefined : modelProfileEntryForReference(applied[role], role);
  return modelDisplayName(entry === undefined ? side.model : entry.profile.modelId);
}

/** The one line text naming what new runs use now. */
export function modelEditorSummaryText({
  author,
  critic,
  applied,
}: Pick<ModelEditorSummaryProps, "author" | "critic" | "applied">): string {
  const name = appliedPairName(applied);
  const pair = `${sideModelName(author, applied, "author")} writes · ${sideModelName(critic, applied, "critic")} reviews`;
  return name === null ? `Now: ${pair}` : `Now: ${name} — ${pair}`;
}

function DetailRow({
  label,
  side,
}: {
  readonly label: string;
  readonly side: WorkspaceModelSummarySide;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {modelDisplayName(side.model)} · {providerDisplayName(side.company)}{" "}
        <code className="workspace-model-summary-id">
          {side.company}/{side.model}
        </code>
      </dd>
    </div>
  );
}

/**
 * The model editor's single "Now:" line. Exact model ids and the applied profiles' lineage wait
 * under a collapsed Details disclosure.
 */
export function ModelEditorSummary({ author, critic, applied, support }: ModelEditorSummaryProps) {
  return (
    <section className="model-editor-summary" aria-label="Current model pair">
      <p className="model-editor-summary-line">
        {modelEditorSummaryText({ author, critic, applied })}
      </p>
      <details className="model-profile-picker-more model-editor-summary-details">
        <summary>Details</summary>
        <div className="model-editor-summary-body">
          <dl className="model-editor-summary-sides">
            <DetailRow label="Writer" side={author} />
            <DetailRow label="Reviewer" side={critic} />
          </dl>
          {applied === null ? null : (
            <div className="model-profile-picker-profile-pair">
              <ProfileDetails reference={applied.author} profileRole="author" support={support} />
              <ProfileDetails reference={applied.critic} profileRole="critic" support={support} />
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
