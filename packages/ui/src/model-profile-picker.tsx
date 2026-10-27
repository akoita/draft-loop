import type { ModelProfileReferences } from "@draft-loop/application/model-profile-selection";
import type { ModelProfile } from "@draft-loop/domain/model-profile";
import { useEffect, useMemo, useRef, useState } from "react";
import { customPresetValue, ModelPresetCards } from "./model-preset-cards.js";
import { ModelProfileBudget } from "./model-profile-budget.js";
import { ProfileDetails } from "./model-profile-details.js";
import {
  type ModelProfileSupportState,
  modelProfileApplyDisabledMessage,
  modelProfileApplyErrorMessage,
  modelProfileCatalog,
  modelProfileNotSupportedMessage,
  modelProfilePresetReferences,
  modelProfilePresets,
  modelProfileReferencesEqual,
  modelProfileRouteIsSupported,
  modelProfileSupportForContext,
} from "./model-profile-picker-state.js";

interface ModelProfilePickerProps {
  readonly workspaceId: string;
  readonly generation: number;
  readonly applied: ModelProfileReferences | null;
  /**
   * The preset the workspace's models already match, the starting choice while nothing is
   * applied (#1834).
   */
  readonly matching?: ModelProfileReferences | null;
  /**
   * The host fixes the sign-in (the hosted service): presets it cannot run and the notes about
   * personal sessions and the legacy path are left out.
   */
  readonly signInFixed?: boolean;
  readonly pendingSelectionMessage?: string;
  /** Why a saved pair is not used, shown while nothing is applied. */
  readonly savedPairNotice?: string | null;
  readonly support: ModelProfileSupportState;
  readonly disabled: boolean;
  readonly onApply: (references: ModelProfileReferences) => Promise<boolean>;
  readonly onUseWorkspaceModels?: () => void;
  readonly onCancel?: () => void;
  readonly onRetrySupport: () => void;
  readonly isContextCurrent: (workspaceId: string, generation: number) => boolean;
}

interface DraftSelection {
  readonly author: string;
  readonly critic: string;
}

function referenceToken(reference: { readonly id: string; readonly version: number }): string {
  return JSON.stringify([reference.id, reference.version]);
}

function profileToken(profile: ModelProfile): string {
  return referenceToken(profile);
}

function draftReferences(selection: DraftSelection): ModelProfileReferences | null {
  const author = modelProfileCatalog.find(
    ({ profile }) => profileToken(profile) === selection.author && profile.roles.includes("author"),
  );
  const critic = modelProfileCatalog.find(
    ({ profile }) => profileToken(profile) === selection.critic && profile.roles.includes("critic"),
  );
  if (author === undefined || critic === undefined) return null;
  return {
    author: { id: author.profile.id, version: author.profile.version },
    critic: { id: critic.profile.id, version: critic.profile.version },
  };
}

function startingDraft(start: ModelProfileReferences | null): DraftSelection {
  return {
    author: start === null ? "" : referenceToken(start.author),
    critic: start === null ? "" : referenceToken(start.critic),
  };
}

function presetForReferences(references: ModelProfileReferences | null): string {
  if (references === null) return "";
  return (
    modelProfilePresets.find((preset) => {
      const presetReferences = modelProfilePresetReferences(preset);
      return modelProfileReferencesEqual(references, presetReferences);
    })?.id ?? ""
  );
}

export function ModelProfilePicker({
  workspaceId,
  generation,
  applied,
  matching = null,
  signInFixed = false,
  pendingSelectionMessage,
  savedPairNotice = null,
  support,
  disabled,
  onApply,
  onUseWorkspaceModels,
  onCancel,
  onRetrySupport,
  isContextCurrent,
}: ModelProfilePickerProps) {
  const start = applied ?? matching;
  const [draft, setDraft] = useState<DraftSelection>(() => startingDraft(start));
  const [customMode, setCustomMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(false);
  const currentSupport = modelProfileSupportForContext(support, workspaceId, generation);
  const supportResult = currentSupport?.status === "ready" ? currentSupport.result : undefined;
  const currentDraftReferences = useMemo(() => draftReferences(draft), [draft]);

  // Keyed by the pair, not the object: the matching preset is worked out again on every render.
  const startKey = JSON.stringify(startingDraft(start));
  useEffect(() => {
    setDraft(JSON.parse(startKey) as DraftSelection);
    setCustomMode(false);
    setError(null);
  }, [startKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const selectedProfiles = currentDraftReferences;
  const routeUnsupported =
    selectedProfiles !== null &&
    supportResult !== undefined &&
    (!modelProfileRouteIsSupported(selectedProfiles.author, supportResult) ||
      !modelProfileRouteIsSupported(selectedProfiles.critic, supportResult));
  const supportReady = supportResult !== undefined;
  const applyDisabled =
    disabled || saving || selectedProfiles === null || !supportReady || routeUnsupported;

  const matchedPresetId = presetForReferences(selectedProfiles);
  const showCustom = customMode || matchedPresetId === "";

  const onPresetChange = (presetId: string) => {
    if (presetId === customPresetValue) {
      setCustomMode(true);
      setError(null);
      return;
    }
    const preset = modelProfilePresets.find((entry) => entry.id === presetId);
    if (preset === undefined) return;
    const references = modelProfilePresetReferences(preset);
    if (references === null) return;
    setCustomMode(false);
    setDraft({
      author: referenceToken(references.author),
      critic: referenceToken(references.critic),
    });
    setError(null);
  };

  const applyDraft = async () => {
    if (applyDisabled || selectedProfiles === null) return;
    if (!isContextCurrent(workspaceId, generation)) return;
    setSaving(true);
    setError(null);
    try {
      const appliedSuccessfully = await onApply(selectedProfiles);
      if (!mountedRef.current || !isContextCurrent(workspaceId, generation)) {
        return;
      }
      if (!appliedSuccessfully) return;
    } catch (reason) {
      if (!mountedRef.current || !isContextCurrent(workspaceId, generation)) {
        return;
      }
      setError(modelProfileApplyErrorMessage(reason));
    } finally {
      if (mountedRef.current && isContextCurrent(workspaceId, generation)) {
        setSaving(false);
      }
    }
  };

  const supportMessage =
    currentSupport === null ||
    currentSupport.status === "idle" ||
    currentSupport.status === "loading"
      ? "Checking profile support for this workspace's configured authentication routes…"
      : currentSupport.status === "unavailable"
        ? "Profile route support is unavailable. Profile Apply is disabled; retry or use the workspace's current models."
        : null;

  return (
    <section className="model-profile-picker" aria-label="Next-run model profiles">
      <div className="model-profile-picker-heading">
        <div>
          <h2>Model profiles for new runs</h2>
          <p>
            Choose which models write and review your next runs. Changing this does not affect runs
            already in progress. Sending candidate material still asks for your approval each time.
          </p>
        </div>
        {onUseWorkspaceModels === undefined ? null : (
          <button
            className="button button-quiet"
            type="button"
            disabled={disabled || saving || applied === null}
            onClick={onUseWorkspaceModels}
          >
            Use workspace models
          </button>
        )}
      </div>
      {signInFixed ? null : (
        <details className="model-profile-picker-notice">
          <summary>
            <span className="model-profile-picker-notice-line">
              Presets are unvalidated for real CVs and do not work with OpenAI Codex user sessions.
            </span>{" "}
            <span className="model-profile-picker-notice-more">More</span>
          </summary>
          <p>
            Quality for real CVs has not been validated for these presets, and account availability
            is not checked. OpenAI Codex user-session routes cannot use these profiles. DraftLoop
            never switches your sign-in automatically.
          </p>
        </details>
      )}
      {supportMessage === null ? null : (
        <p className="model-profile-picker-status" role="status">
          {supportMessage}
        </p>
      )}
      {currentSupport?.status === "unavailable" ? (
        <button
          className="button button-quiet model-profile-picker-retry"
          type="button"
          disabled={disabled || saving}
          onClick={onRetrySupport}
        >
          Retry profile check
        </button>
      ) : null}
      {routeUnsupported ? (
        <p className="model-profile-picker-status" role="status">
          {modelProfileNotSupportedMessage}
        </p>
      ) : null}
      {applied === null && (matching === null || pendingSelectionMessage !== undefined) ? (
        <div className="model-profile-picker-applied">
          <p>
            {pendingSelectionMessage ??
              (signInFixed
                ? "New runs use the workspace's current models."
                : "Applied next-run selection: workspace model settings (legacy path).")}
          </p>
          {savedPairNotice === null ? null : (
            <p className="model-profile-picker-status" role="status">
              {savedPairNotice}
            </p>
          )}
        </div>
      ) : null}
      <ModelPresetCards
        groupName={`model-preset-${workspaceId}`}
        checkedValue={showCustom ? customPresetValue : matchedPresetId}
        disabled={disabled || saving}
        support={supportResult}
        hideUnsupported={signInFixed}
        onSelect={onPresetChange}
      />
      {showCustom ? (
        <div className="model-profile-picker-profile-pair">
          {(["author", "critic"] as const).map((role) => {
            const selected = selectedProfiles?.[role];
            const selectedSupported =
              selected === undefined || supportResult === undefined
                ? undefined
                : modelProfileRouteIsSupported(selected, supportResult);
            return (
              <div className="model-profile-picker-side" key={role}>
                <label className="model-profile-picker-field">
                  <span>{role === "author" ? "Author profile" : "Critic profile"}</span>
                  <select
                    value={draft[role]}
                    disabled={disabled || saving}
                    onChange={(event) => {
                      setDraft((current) => ({ ...current, [role]: event.target.value }));
                      setError(null);
                    }}
                    aria-label={`${role === "author" ? "Author" : "Critic"} profile`}
                  >
                    <option value="">Choose an exact {role} profile</option>
                    {modelProfileCatalog
                      .filter(({ profile }) => profile.roles.includes(role))
                      .map(({ profile }) => {
                        const isSupported =
                          supportResult === undefined
                            ? undefined
                            : modelProfileRouteIsSupported(
                                { id: profile.id, version: profile.version },
                                supportResult,
                              );
                        return (
                          <option key={profileToken(profile)} value={profileToken(profile)}>
                            {profile.id}@{profile.version} — {profile.provider}/{profile.modelId} —{" "}
                            {profile.tier}
                            {isSupported === false ? " — unsupported with current route" : ""}
                          </option>
                        );
                      })}
                  </select>
                </label>
                {selectedSupported === false ? (
                  <p className="model-profile-picker-status">
                    Unsupported with the configured route.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {selectedProfiles === null ||
      modelProfileReferencesEqual(selectedProfiles, applied) ? null : (
        <details className="model-profile-picker-more">
          <summary>Details</summary>
          <div className="model-profile-picker-profile-pair">
            <ProfileDetails
              reference={selectedProfiles.author}
              profileRole="author"
              support={supportResult}
            />
            <ProfileDetails
              reference={selectedProfiles.critic}
              profileRole="critic"
              support={supportResult}
            />
          </div>
        </details>
      )}
      {selectedProfiles === null ? null : (
        <ModelProfileBudget
          references={selectedProfiles}
          {...(supportResult === undefined ? {} : { authModes: supportResult.authModes })}
          disabled={disabled}
        />
      )}
      {currentDraftReferences === null ? (
        <p className="model-profile-picker-status">{modelProfileApplyDisabledMessage}</p>
      ) : null}
      {error === null ? null : (
        <p className="model-profile-picker-error" role="alert">
          {error}
        </p>
      )}
      <div className="model-profile-picker-actions">
        {onCancel === undefined ? null : (
          <button
            className="button button-quiet"
            type="button"
            disabled={disabled || saving}
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
        <button
          className="button button-primary"
          type="button"
          disabled={applyDisabled}
          onClick={() => void applyDraft()}
        >
          Apply for future runs
        </button>
      </div>
    </section>
  );
}
