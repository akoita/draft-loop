import type { ModelProfileReferences } from "@draft-loop/application/model-profile-selection";
import type { ModelProfile } from "@draft-loop/domain/model-profile";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelProfileSupportResult } from "./bridge.js";
import {
  type ModelProfileSupportState,
  modelProfileApplyDisabledMessage,
  modelProfileCatalog,
  modelProfileEntryForReference,
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
  readonly support: ModelProfileSupportState;
  readonly disabled: boolean;
  readonly onApply: (references: ModelProfileReferences) => Promise<boolean>;
  readonly onUseWorkspaceModels: () => void;
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

function presetForReferences(references: ModelProfileReferences | null): string {
  if (references === null) return "";
  return (
    modelProfilePresets.find((preset) => {
      const presetReferences = modelProfilePresetReferences(preset);
      return modelProfileReferencesEqual(references, presetReferences);
    })?.id ?? ""
  );
}

function ProfileDetails({
  reference,
  profileRole,
  support,
}: {
  readonly reference: { readonly id: string; readonly version: number };
  readonly profileRole: "author" | "critic";
  readonly support: ModelProfileSupportResult | undefined;
}) {
  const entry = modelProfileEntryForReference(reference, profileRole);
  if (entry === undefined) return null;
  const { profile } = entry;
  const supported =
    support === undefined ? undefined : modelProfileRouteIsSupported(reference, support);
  const thinking = profile.runtime.thinking;
  const thinkingDescription =
    thinking.mode === "budgeted" ? `budgeted (${thinking.maxTokens} tokens)` : thinking.mode;
  return (
    <div className="model-profile-picker-details">
      <strong>
        {profile.id}@{profile.version}
      </strong>
      <dl>
        <div>
          <dt>Provider and model</dt>
          <dd>
            {profile.provider}/{profile.modelId}
          </dd>
        </div>
        <div>
          <dt>Tier and role</dt>
          <dd>
            {profile.tier} · {profile.roles.join(", ")}
          </dd>
        </div>
        <div>
          <dt>Runtime controls</dt>
          <dd>
            effort {profile.runtime.effort}; output {profile.runtime.maxOutputTokens} tokens;
            thinking {thinkingDescription}
          </dd>
        </div>
        <div>
          <dt>Route support</dt>
          <dd>
            {supported === undefined
              ? "Not checked"
              : supported
                ? "Supported with the configured authentication route"
                : "Unsupported with the configured authentication route"}
          </dd>
        </div>
        <div>
          <dt>Validation and availability</dt>
          <dd>Quality unvalidated; account availability unchecked</dd>
        </div>
      </dl>
    </div>
  );
}

export function ModelProfilePicker({
  workspaceId,
  generation,
  applied,
  support,
  disabled,
  onApply,
  onUseWorkspaceModels,
  onRetrySupport,
  isContextCurrent,
}: ModelProfilePickerProps) {
  const [draft, setDraft] = useState<DraftSelection>(() => ({
    author:
      applied === null
        ? ""
        : referenceToken({ id: applied.author.id, version: applied.author.version }),
    critic:
      applied === null
        ? ""
        : referenceToken({ id: applied.critic.id, version: applied.critic.version }),
  }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(false);
  const currentSupport = modelProfileSupportForContext(support, workspaceId, generation);
  const supportResult = currentSupport?.status === "ready" ? currentSupport.result : undefined;
  const currentDraftReferences = useMemo(() => draftReferences(draft), [draft]);

  useEffect(() => {
    setDraft({
      author:
        applied === null
          ? ""
          : referenceToken({ id: applied.author.id, version: applied.author.version }),
      critic:
        applied === null
          ? ""
          : referenceToken({ id: applied.critic.id, version: applied.critic.version }),
    });
    setError(null);
  }, [applied]);

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

  const onPresetChange = (presetId: string) => {
    const preset = modelProfilePresets.find((entry) => entry.id === presetId);
    if (preset === undefined) {
      setDraft({ author: "", critic: "" });
      return;
    }
    const references = modelProfilePresetReferences(preset);
    if (references === null) return;
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
    } catch {
      if (!mountedRef.current || !isContextCurrent(workspaceId, generation)) {
        return;
      }
      setError("The profile pair could not be applied. Your draft is unchanged.");
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
            Draft changes do not affect the applied pair. Apply saves workspace model destinations
            for future runs; provider transmission requires current consent.
          </p>
        </div>
        <button
          className="button button-quiet"
          type="button"
          disabled={disabled || saving || applied === null}
          onClick={onUseWorkspaceModels}
        >
          Use workspace models
        </button>
      </div>
      <p className="model-profile-picker-notice">
        CV quality has not been validated; account availability has not been checked. OpenAI Codex
        user-session routes do not support these profiles. Authentication is never switched
        automatically.
      </p>
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
      {applied === null ? (
        <p className="model-profile-picker-applied">
          Applied next-run selection: workspace model settings (legacy path).
        </p>
      ) : (
        <div className="model-profile-picker-applied">
          <strong>Applied next-run profiles</strong>
          <div className="model-profile-picker-profile-pair">
            <ProfileDetails
              reference={applied.author}
              profileRole="author"
              support={supportResult}
            />
            <ProfileDetails
              reference={applied.critic}
              profileRole="critic"
              support={supportResult}
            />
          </div>
        </div>
      )}
      <label className="model-profile-picker-field">
        <span>Profile preset</span>
        <select
          value={presetForReferences(selectedProfiles)}
          disabled={disabled || saving}
          onChange={(event) => onPresetChange(event.target.value)}
          aria-label="Profile preset"
        >
          <option value="">Choose exact profiles</option>
          {modelProfilePresets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>
      <div className="model-profile-picker-profile-pair">
        {(["author", "critic"] as const).map((role) => {
          const selected = selectedProfiles?.[role];
          const selectedSupported =
            selected === undefined || supportResult === undefined
              ? undefined
              : modelProfileRouteIsSupported(selected, supportResult);
          const selectedEntry =
            selected === undefined ? undefined : modelProfileEntryForReference(selected, role);
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
              {selectedEntry !== undefined && selected !== undefined ? (
                <ProfileDetails reference={selected} profileRole={role} support={supportResult} />
              ) : null}
              {selectedSupported === false ? (
                <p className="model-profile-picker-status">
                  Unsupported with the configured route.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      {currentDraftReferences === null ? (
        <p className="model-profile-picker-status">{modelProfileApplyDisabledMessage}</p>
      ) : null}
      {error === null ? null : (
        <p className="model-profile-picker-error" role="alert">
          {error}
        </p>
      )}
      <div className="model-profile-picker-actions">
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
