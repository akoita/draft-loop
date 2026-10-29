import { type FormEvent, useCallback, useEffect, useState } from "react";

import { type ApiClient, type ApiSchemas, describeError } from "./api-client.js";
import {
  basisLabel,
  type ConsentBasis,
  type ConsentKind,
  type ConsentProvider,
  type Consents,
  consentBases,
  consentHistory,
  consentSummary,
  type GrantInput,
  grantRequest,
  historyLine,
  isGranted,
  maximumConsentNoteLength,
  providerList,
  unconsentedProviders,
  withdrawRequest,
  workspaceProviders,
} from "./consent-model.js";
import { useRecordId } from "./record-context.js";

export interface ConsentStepProps {
  readonly client: ApiClient;
  readonly kind: ConsentKind;
  /** The workspace whose author and critic name the providers; the default pair until read. */
  readonly workspace: ApiSchemas["Workspace"] | undefined;
  /** Once granted, read as one short line with a way to withdraw, for pages that only remind. */
  readonly compact?: boolean;
}

export interface ConsentState {
  /** The record's consents; undefined until read. */
  readonly consents: Consents | undefined;
  readonly messages: readonly string[];
  readonly busy: boolean;
  /** The providers runs send material to. */
  readonly providers: readonly ConsentProvider[];
  readonly grant: (input: Omit<GrantInput, "providers">) => void;
  readonly withdraw: () => void;
}

/** Reads the candidate record's consents and records a grant or a withdrawal of one kind. */
export function useConsents(
  client: ApiClient,
  kind: ConsentKind,
  workspace: ApiSchemas["Workspace"] | undefined,
): ConsentState {
  const workspaceId = useRecordId();
  const [consents, setConsents] = useState<Consents | undefined>(undefined);
  const [messages, setMessages] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const providers = workspaceProviders(workspace);

  const load = useCallback(async () => {
    try {
      setConsents(
        await client.call("GET /v1/workspaces/{workspaceId}/consents", { path: { workspaceId } }),
      );
    } catch (error) {
      setMessages([describeError(error)]);
    }
  }, [client, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function record(request: ReturnType<typeof grantRequest>) {
    if ("problem" in request) {
      setMessages([request.problem]);
      return;
    }
    setBusy(true);
    try {
      await client.call("POST /v1/workspaces/{workspaceId}/consents", {
        path: { workspaceId },
        body: request.body,
      });
      setMessages([]);
      await load();
    } catch (error) {
      setMessages([describeError(error)]);
    } finally {
      setBusy(false);
    }
  }

  return {
    consents,
    messages,
    busy,
    providers,
    grant: (input) => void record(grantRequest(kind, { ...input, providers })),
    withdraw: () => {
      if (consents !== undefined) void record(withdrawRequest(kind, consents));
    },
  };
}

/** Reads the candidate record's consents and records a grant or a withdrawal of one kind. */
export function ConsentStep({ client, kind, workspace, compact }: ConsentStepProps) {
  const state = useConsents(client, kind, workspace);
  return <ConsentView kind={kind} state={state} {...(compact === undefined ? {} : { compact })} />;
}

/** One kind of consent over a state read by `useConsents`. */
export function ConsentView({
  kind,
  state,
  compact,
}: {
  readonly kind: ConsentKind;
  readonly state: ConsentState;
  readonly compact?: boolean;
}) {
  const { consents, messages, busy, providers } = state;
  if (consents === undefined)
    return messages.length === 0 ? (
      <p role="status">Reading the candidate's consents…</p>
    ) : (
      <Alerts messages={messages} />
    );

  return (
    <ConsentPanel
      kind={kind}
      consents={consents}
      providers={providers}
      messages={messages}
      busy={busy}
      {...(compact === undefined ? {} : { compact })}
      onGrant={state.grant}
      onWithdraw={state.withdraw}
    />
  );
}

function Alerts({ messages }: { readonly messages: readonly string[] }) {
  return (
    <>
      {messages.map((message) => (
        <p key={message} className="problem" role="alert">
          {message}
        </p>
      ))}
    </>
  );
}

export interface ConsentPanelProps {
  readonly kind: ConsentKind;
  readonly consents: Consents;
  /** The providers runs send material to. */
  readonly providers: readonly ConsentProvider[];
  readonly messages: readonly string[];
  readonly busy: boolean;
  readonly onGrant: (input: Omit<GrantInput, "providers">) => void;
  readonly onWithdraw: () => void;
  /** Dates in this locale; the browser's when left out. */
  readonly locale?: string;
  /** Once granted, shows one short line and the withdrawal instead of the full panel. */
  readonly compact?: boolean;
}

const titles: Readonly<Record<ConsentKind, string>> = {
  "material-storage": "Consent to store the candidate's material",
  "provider-transmission": "Consent to send material to model providers",
};

const compactTitles: Readonly<Record<ConsentKind, string>> = {
  "material-storage": "Permission to store this material",
  "provider-transmission": "Permission to send material to model providers",
};

const firstSteps: Readonly<Record<ConsentKind, string>> = {
  "material-storage": "Record this before the first upload.",
  "provider-transmission": "Record this before the first run.",
};

/** One kind of consent: what it covers, its current state, the form or withdrawal, and history. */
export function ConsentPanel(props: ConsentPanelProps) {
  const { kind, consents, providers, busy, locale, compact } = props;
  const granted = isGranted(consents, kind);
  const history = consentHistory(consents, kind);
  const missing = kind === "provider-transmission" ? unconsentedProviders(consents, providers) : [];
  const headingId = `consent-${kind}`;

  if (compact === true && granted && missing.length === 0)
    return (
      <section className="consent consent-compact" aria-labelledby={headingId}>
        <p>
          <strong id={headingId}>{compactTitles[kind]}</strong> ·{" "}
          <span className="muted">{consentSummary(consents, kind, locale)}</span>{" "}
          <button type="button" className="secondary" disabled={busy} onClick={props.onWithdraw}>
            Withdraw consent
          </button>
        </p>
        <Alerts messages={props.messages} />
      </section>
    );

  return (
    <section className="consent" aria-labelledby={headingId}>
      <h3 id={headingId}>{compact === true ? compactTitles[kind] : titles[kind]}</h3>
      <p>
        {kind === "material-storage"
          ? "DraftLoop stores the CVs, notes and records you upload for this candidate, in the EU."
          : `Runs send the approved parts of the candidate's material to ${providerList(providers)} to draft and review the CV. The providers do not keep it.`}
      </p>
      <p className={granted ? "muted" : "notice"}>
        {consentSummary(consents, kind, locale)}
        {granted ? null : ` ${firstSteps[kind]}`}
      </p>
      {missing.length === 0 ? null : (
        <p className="notice">
          The consent does not name {providerList(missing)}. Withdraw it and record it again for{" "}
          {providerList(providers)}.
        </p>
      )}
      <Alerts messages={props.messages} />
      {granted ? (
        <button type="button" className="secondary" disabled={busy} onClick={props.onWithdraw}>
          Withdraw consent
        </button>
      ) : (
        <GrantForm kind={kind} providers={providers} busy={busy} onGrant={props.onGrant} />
      )}
      {history.length === 0 ? null : (
        <details className="consent-history">
          <summary>History ({history.length})</summary>
          <ul>
            {history.map((entry) => (
              <li key={entry.id}>{historyLine(entry, locale)}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

interface GrantFormProps {
  readonly kind: ConsentKind;
  readonly providers: readonly ConsentProvider[];
  readonly busy: boolean;
  readonly onGrant: ConsentPanelProps["onGrant"];
}

function GrantForm({ kind, providers, busy, onGrant }: GrantFormProps) {
  const bases = consentBases[kind];
  const [basis, setBasis] = useState<ConsentBasis | undefined>(
    bases.length === 1 ? bases[0] : undefined,
  );
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const noteId = `consent-${kind}-note`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onGrant({ basis, confirmed, note });
  }

  return (
    <form onSubmit={submit}>
      {kind === "material-storage" ? (
        <fieldset>
          <legend>Basis for storing the material</legend>
          {bases.map((item) => (
            <label key={item} className="check">
              <input
                type="radio"
                name={`consent-${kind}-basis`}
                value={item}
                checked={basis === item}
                onChange={() => setBasis(item)}
              />
              {basisLabel(item)}
            </label>
          ))}
        </fieldset>
      ) : (
        <label className="check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          The candidate agreed that runs send their material to {providerList(providers)}
        </label>
      )}
      <label htmlFor={noteId}>Note (optional)</label>
      <input
        id={noteId}
        maxLength={maximumConsentNoteLength}
        placeholder="Where the agreement is kept"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <button type="submit" disabled={busy}>
        Record consent
      </button>
    </form>
  );
}
