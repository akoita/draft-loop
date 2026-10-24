import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type {
  CredentialProvider,
  CredentialStatus,
  ModelCompany,
  ProviderAuthMode,
  ProviderAuthModeProvider,
  ProviderAuthModeStatus,
} from "./bridge.js";
import {
  credentialProviderLabels,
  type ProviderAuthenticationCallbacks,
  providerAuthModeLabels,
  removeProviderCredential,
  saveOpenAiAuthMode,
  saveProviderCredential,
} from "./provider-authentication-actions.js";
import type { ProviderAuthenticationSummary } from "./provider-authentication-summary.js";
import {
  type CredentialTestCallback,
  CredentialTestLine,
  type CredentialTestState,
  isCredentialTestProvider,
  useCredentialTests,
} from "./provider-key-test.js";
import {
  type CredentialMap,
  mapProviders,
  useProviderSignInReadiness,
} from "./provider-sign-in-readiness.js";
import { useModalFocusTrap } from "./review.js";

export { credentialProviderLabels, providerAuthModeLabels };

export const mistralCredentialNote =
  "This key sends candidate material to Mistral AI (api.mistral.ai). Mistral Large 4 is a public preview.";

export const googleCredentialNote =
  "This key sends submitted content to Google; Gemini API free-tier terms let Google use it, so candidate material needs a paid-tier key.";

const credentialSourceLabels: Readonly<Record<CredentialStatus["source"], string>> = {
  app: "Configured in app",
  env: "Configured via env",
  "user-session": "Provider user session",
  none: "Not configured",
};

const credentialProtectionLabels: Readonly<Record<CredentialStatus["protection"], string>> = {
  "os-backed": "OS-backed encryption",
  "basic-text": "Linux basic_text (weak protection)",
  "local-aes-gcm": "Local AES fallback (key stored beside app data)",
  environment: "Environment variable",
  "session-memory": "Session memory only",
  "provider-managed-session": "Provider-managed session",
  none: "No credential",
};

interface CredentialRowProps {
  readonly title: string;
  readonly placeholder: string;
  readonly status: CredentialStatus;
  readonly value: string;
  readonly revealed: boolean;
  readonly onReveal: (next: boolean) => void;
  readonly onChange: (next: string) => void;
  readonly onSave: () => void;
  readonly onRemove: () => void;
  /** Optional one-sentence destination or terms notice shown under the header. */
  readonly note?: string;
  /** Offers Test key for a configured key; absent for providers whose keys cannot be tested. */
  readonly keyTest?: {
    readonly state: CredentialTestState | undefined;
    readonly onTest: () => void;
  };
}

export function CredentialRow({
  title,
  placeholder,
  status,
  value,
  revealed,
  onReveal,
  onChange,
  onSave,
  onRemove,
  note,
  keyTest,
}: CredentialRowProps) {
  // Test key checks the stored or environment key, so it waits while a new one is being typed.
  const testable =
    keyTest !== undefined &&
    status.configured &&
    (status.source === "app" || status.source === "env");
  return (
    <section className="credential-row" aria-label={title}>
      <div className="credential-row-header">
        <strong>{title}</strong>
        <span className={`status-badge status-${status.source}`}>
          {credentialSourceLabels[status.source]}
        </span>
        <span className="credential-protection">
          {credentialProtectionLabels[status.protection]}
        </span>
      </div>
      {note === undefined ? null : <p className="credential-note">{note}</p>}
      <div className="credential-input-group">
        <input
          className="url-input"
          type={revealed ? "text" : "password"}
          placeholder={status.configured ? "••••••••••••••••••••••••" : placeholder}
          value={value}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          aria-label={title}
        />
        <button
          className="button button-quiet"
          type="button"
          aria-pressed={revealed}
          onClick={() => onReveal(!revealed)}
        >
          {revealed ? "Hide" : "Show"}
        </button>
        <button
          className="button button-primary"
          type="button"
          disabled={value.trim() === ""}
          onClick={onSave}
        >
          Save
        </button>
        {testable ? (
          <button
            className="button button-outline"
            type="button"
            disabled={value.trim() !== "" || keyTest.state?.status === "testing"}
            onClick={keyTest.onTest}
          >
            Test key
          </button>
        ) : null}
        {status.source === "app" ? (
          <button className="button button-danger" type="button" onClick={onRemove}>
            Remove
          </button>
        ) : null}
      </div>
      {testable && keyTest.state !== undefined ? (
        <CredentialTestLine state={keyTest.state} />
      ) : null}
    </section>
  );
}

interface ProviderAuthenticationModeProps {
  readonly status: ProviderAuthModeStatus;
  readonly credentialStatus: CredentialStatus;
  readonly onChange?: ((mode: ProviderAuthMode) => void) | undefined;
}

/**
 * The OpenAI mode choice is kept separate from the key editor so an active
 * user-session never renders an actionable API-key control.
 */
export function ProviderAuthenticationMode({
  status,
  credentialStatus,
  onChange,
}: ProviderAuthenticationModeProps) {
  const modeLabel = providerAuthModeLabels[status.activeMode];
  const modeChoiceDisabled = status.environmentOverride || onChange === undefined;
  return (
    <fieldset className="provider-auth-mode" aria-describedby="provider-auth-mode-copy">
      <legend>OpenAI authentication</legend>
      <p className="credential-mode-copy" id="provider-auth-mode-copy">
        Choose which OpenAI account DraftLoop uses. This preference is saved for the next launch; it
        does not change the current host.
      </p>
      <label className="provider-auth-choice">
        <input
          type="radio"
          name="openai-provider-auth-mode"
          value="api-key"
          checked={status.preferredMode === "api-key"}
          disabled={modeChoiceDisabled}
          onChange={() => onChange?.("api-key")}
        />
        <span>
          <strong>{providerAuthModeLabels["api-key"]}</strong>
          <small>Use an OpenAI API key with direct API billing.</small>
        </span>
      </label>
      <label className="provider-auth-choice">
        <input
          type="radio"
          name="openai-provider-auth-mode"
          value="user-session"
          checked={status.preferredMode === "user-session"}
          disabled={modeChoiceDisabled}
          onChange={() => onChange?.("user-session")}
        />
        <span>
          <strong>{providerAuthModeLabels["user-session"]}</strong>
          <small>Use the local Codex CLI session with subscription billing.</small>
        </span>
      </label>
      <p className="credential-mode-status" role="status">
        Active now: {modeLabel}. Saved preference: {providerAuthModeLabels[status.preferredMode]}.
      </p>
      {status.restartRequired ? (
        <p className="credential-mode-pending" role="status">
          Close and reopen DraftLoop to apply it; the active host remains unchanged until then.
        </p>
      ) : null}
      {status.environmentOverride ? (
        <p className="credential-mode-warning" role="alert">
          An environment override controls this mode. Unset the provider auth override and restart
          DraftLoop before changing the saved preference.
        </p>
      ) : null}
      {status.activeMode === "user-session" ? (
        <div className="credential-session-guidance">
          <strong>
            Codex session: {credentialStatus.configured ? "available" : "not detected"}
          </strong>
          <p>
            Install the Codex CLI, run <code>codex login</code>, then close and reopen DraftLoop.
            DraftLoop does not copy subscription credentials into an API key.
          </p>
        </div>
      ) : null}
    </fieldset>
  );
}

const credentialRows: readonly {
  readonly provider: CredentialProvider;
  readonly title: string;
  readonly placeholder: string;
  readonly note?: string;
}[] = [
  { provider: "anthropic", title: "Anthropic API key (Claude)", placeholder: "sk-ant-api03-…" },
  { provider: "openai", title: "OpenAI API key (GPT)", placeholder: "sk-proj-…" },
  {
    provider: "deepinfra",
    title: "DeepInfra API key (Z.ai GLM)",
    placeholder: "DeepInfra API key",
  },
  {
    provider: "google",
    title: "Google Gemini API key",
    placeholder: "Gemini API key",
    note: googleCredentialNote,
  },
  {
    provider: "mistral",
    title: "Mistral API key",
    placeholder: "Mistral API key",
    note: mistralCredentialNote,
  },
];

export interface ProviderAuthenticationViewProps {
  readonly statuses: CredentialMap<CredentialStatus>;
  readonly openaiAuthMode: ProviderAuthModeStatus;
  readonly inputs: CredentialMap<string>;
  readonly revealed: CredentialMap<boolean>;
  readonly feedback: string | null;
  readonly onInputChange: (provider: CredentialProvider, value: string) => void;
  readonly onReveal: (provider: CredentialProvider, next: boolean) => void;
  readonly onSave: (provider: CredentialProvider) => void;
  readonly onRemove: (provider: CredentialProvider) => void;
  /** Absent when the host cannot test keys. */
  readonly keyTests?:
    | {
        readonly states: Partial<Record<CredentialProvider, CredentialTestState>>;
        readonly onTest: (provider: CredentialProvider) => void;
      }
    | undefined;
  /** Absent when the host cannot save the mode preference. */
  readonly onModeChange?: ((mode: ProviderAuthMode) => void) | undefined;
  readonly onClose: () => void;
}

/**
 * The Provider authentication dialog: every provider's key, and the OpenAI account choice. It is
 * workspace-level, so it opens from Home's Workspace settings and not from an application.
 */
export function ProviderAuthenticationView({
  statuses,
  openaiAuthMode,
  inputs,
  revealed,
  feedback,
  onInputChange,
  onReveal,
  onSave,
  onRemove,
  keyTests,
  onModeChange,
  onClose,
}: ProviderAuthenticationViewProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalFocusTrap(true, dialogRef, onClose);
  const rowFor = (row: (typeof credentialRows)[number]) => (
    <CredentialRow
      key={row.provider}
      title={row.title}
      placeholder={row.placeholder}
      {...(row.note === undefined ? {} : { note: row.note })}
      status={statuses[row.provider]}
      value={inputs[row.provider]}
      revealed={revealed[row.provider]}
      onReveal={(next) => onReveal(row.provider, next)}
      onChange={(value) => onInputChange(row.provider, value)}
      onSave={() => onSave(row.provider)}
      onRemove={() => onRemove(row.provider)}
      {...(keyTests === undefined || !isCredentialTestProvider(row.provider)
        ? {}
        : {
            keyTest: {
              state: keyTests.states[row.provider],
              onTest: () => keyTests.onTest(row.provider),
            },
          })}
    />
  );
  const [anthropic, openai, ...others] = credentialRows;
  return (
    // No dismiss-on-backdrop: a stray click must not discard a half-typed key.
    <div className="modal-backdrop">
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        aria-describedby="settings-dialog-copy"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">DraftLoop / Provider authentication</p>
            <h2 id="settings-dialog-title">Provider authentication</h2>
          </div>
          <button className="button button-quiet" type="button" onClick={onClose}>
            Close
            <kbd>Esc</kbd>
          </button>
        </div>
        <p className="modal-copy" id="settings-dialog-copy">
          Manage API keys for Anthropic, OpenAI, DeepInfra, Google Gemini, and Mistral. Anthropic
          and OpenAI also support provider-managed sessions; app keys override their API-key
          environment variables.
        </p>
        {feedback ? (
          <div className="feedback-banner" role="status">
            <p>{feedback}</p>
          </div>
        ) : null}
        <div className="credential-sections">
          {anthropic === undefined ? null : rowFor(anthropic)}
          <ProviderAuthenticationMode
            status={openaiAuthMode}
            credentialStatus={statuses.openai}
            onChange={onModeChange}
          />
          {openai === undefined || openaiAuthMode.activeMode !== "api-key" ? null : rowFor(openai)}
          {others.map(rowFor)}
        </div>
      </div>
    </div>
  );
}

export interface ProviderAuthenticationProps extends ProviderAuthenticationCallbacks {
  readonly getCredentialStatus?:
    | ((provider: CredentialProvider) => Promise<CredentialStatus>)
    | undefined;
  readonly getProviderAuthModeStatus?:
    | ((provider: ProviderAuthModeProvider) => Promise<ProviderAuthModeStatus>)
    | undefined;
  /** Demo workspaces need no provider authentication. */
  readonly fixtureMode?: boolean;
  /** The configured pair, so the summary names only the providers a run would use. */
  readonly authorCompany?: ModelCompany;
  readonly criticCompany?: ModelCompany;
  /** Told the pair's readiness once the statuses are read, and `null` while they are unknown. */
  readonly onReadiness?: (readiness: ProviderAuthenticationSummary | null) => void;
  /** Tests a saved Anthropic or OpenAI key; absent when the host cannot. */
  readonly onTestCredential?: CredentialTestCallback | undefined;
}

/**
 * Provider authentication for Home's Workspace settings: a one-line readiness summary and the
 * button that opens the dialog. Renders nothing when the host has no credential capability.
 */
export function ProviderAuthentication({
  getCredentialStatus,
  getProviderAuthModeStatus,
  onSetCredential,
  onRemoveCredential,
  onSetProviderAuthMode,
  onTestCredential,
  fixtureMode = false,
  authorCompany,
  criticCompany,
  onReadiness,
}: ProviderAuthenticationProps) {
  const [open, setOpen] = useState(false);
  const [inputs, setInputs] = useState<CredentialMap<string>>(() => mapProviders(() => ""));
  const [revealed, setRevealed] = useState<CredentialMap<boolean>>(() => mapProviders(() => false));
  const [feedback, setFeedback] = useState<string | null>(null);
  const keyTests = useCredentialTests(onTestCredential);
  const { readiness, statuses, openaiAuthMode, setOpenaiAuthMode, refresh } =
    useProviderSignInReadiness({
      getCredentialStatus,
      getProviderAuthModeStatus,
      fixtureMode,
      authorCompany,
      criticCompany,
    });

  const close = useCallback(() => setOpen(false), []);

  const report = (outcome: { readonly feedback: string } | null) => {
    if (outcome !== null) setFeedback(outcome.feedback);
  };

  const save = async (provider: CredentialProvider) => {
    const outcome = await saveProviderCredential({ onSetCredential }, provider, inputs[provider]);
    report(outcome);
    if (outcome?.ok) {
      // A saved key is not tested automatically, and the old key's result no longer applies.
      keyTests.clear(provider);
      setInputs((current) => ({ ...current, [provider]: "" }));
      refresh();
    }
  };

  const remove = async (provider: CredentialProvider) => {
    const outcome = await removeProviderCredential({ onRemoveCredential }, provider);
    report(outcome);
    if (outcome?.ok) {
      keyTests.clear(provider);
      refresh();
    }
  };

  const changeMode = async (mode: ProviderAuthMode) => {
    const outcome = await saveOpenAiAuthMode({ onSetProviderAuthMode }, mode);
    report(outcome);
    if (outcome?.status !== undefined) {
      setOpenaiAuthMode(outcome.status);
      refresh();
    }
  };

  const summary = readiness.summary;
  // Ready only when every read the pair needs reported it so, as before the hook was shared.
  const ready = summary === null ? undefined : readiness.state === "ready";

  const onReadinessRef = useRef(onReadiness);
  onReadinessRef.current = onReadiness;
  useEffect(() => {
    onReadinessRef.current?.(ready === undefined || summary === null ? null : { ready, summary });
  }, [ready, summary]);

  if (getCredentialStatus === undefined && onSetCredential === undefined) return null;

  return (
    <section className="provider-authentication" aria-label="Provider authentication">
      <div className="provider-authentication-head">
        <strong>Provider authentication</strong>
        {summary === null ? null : (
          <span className="provider-authentication-summary">{summary}</span>
        )}
      </div>
      <button className="button button-outline" type="button" onClick={() => setOpen(true)}>
        Manage provider authentication
      </button>
      {/* Portalled out of Home so no ancestor's layout can contain the fixed backdrop. */}
      {open && typeof document !== "undefined"
        ? createPortal(
            <ProviderAuthenticationView
              statuses={statuses}
              openaiAuthMode={openaiAuthMode}
              inputs={inputs}
              revealed={revealed}
              feedback={feedback}
              onInputChange={(provider, value) => {
                keyTests.clear(provider);
                setInputs((current) => ({ ...current, [provider]: value }));
              }}
              onReveal={(provider, next) =>
                setRevealed((current) => ({ ...current, [provider]: next }))
              }
              onSave={(provider) => void save(provider)}
              onRemove={(provider) => void remove(provider)}
              keyTests={
                onTestCredential === undefined
                  ? undefined
                  : {
                      states: keyTests.states,
                      onTest: (provider) => {
                        if (isCredentialTestProvider(provider)) void keyTests.test(provider);
                      },
                    }
              }
              onModeChange={
                onSetProviderAuthMode === undefined ? undefined : (mode) => void changeMode(mode)
              }
              onClose={close}
            />,
            document.body,
          )
        : null}
    </section>
  );
}
