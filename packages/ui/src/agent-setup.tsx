import { t } from "@lingui/core/macro";
import { type ReactNode, useId, useState } from "react";

import {
  type AgentHost,
  type AgentScope,
  type AgentTokenView,
  activeAgentTokens,
  agentConfiguration,
  agentConfigurationHoldsToken,
  agentHostHint,
  agentHostLabel,
  agentHosts,
  agentScopeLabel,
  agentScopeName,
  agentScopes,
  agentSetupGuideUrl,
  defaultAgentMonthlyCapUsd,
  defaultAgentScopes,
  parseAgentMonthlyCap,
} from "./agent-setup-model.js";
import { type AssistantConnectionView, ConnectedAgents } from "./connected-agents.js";
import { currentScreenLanguage } from "./i18n.js";
import { formatDate } from "./locale-format.js";
import { codingAgentsSectionId } from "./shared-link.js";

/**
 * Agents in Settings (#2427, moved app-wide in #2439): creates an agent token
 * with the scopes the person ticks and shows the configuration to paste into the agent, with the
 * token in it. The secret lives only in this component's state, shown once; a server that issues
 * no agent tokens gets one line instead.
 */

export interface IssuedAgentToken {
  readonly token: string;
  readonly expires_at: string;
}

export interface AgentSetupProps {
  /** Whether this server issues agent tokens; undefined until read. */
  readonly available: boolean | undefined;
  /** The address the screen is served from. */
  readonly serverUrl: string;
  readonly workspaceId: string;
  /** The workspace's agent tokens; undefined until read or where none are issued. */
  readonly tokens: readonly AgentTokenView[] | undefined;
  /** Resolves with the new token, or with a problem to show. */
  readonly onIssue: (
    label: string,
    scopes: readonly AgentScope[],
    /** Set exactly when `scopes` holds `runs:start`. */
    monthlyCapUsd?: number,
  ) => Promise<IssuedAgentToken | { readonly problem: string }>;
  /** Opens the section, such as when a link elsewhere points to it. */
  readonly open?: boolean;
  /** Resolves with a problem to show, or undefined once revoked. */
  readonly onRevoke: (tokenId: string) => Promise<string | undefined>;
  /** The "Accept notes from agents" switch (#2625), from a host that serves the work journal. */
  readonly workJournal?: ReactNode;
  /**
   * Assistants that signed in (#2657), from a host that keeps their spend limits; listed with the
   * tokens under Connected agents (#2785).
   */
  readonly assistants?: readonly AssistantConnectionView[] | undefined;
  /** Resolves with a problem to show, or undefined once the assistant's limit is saved. */
  readonly onSetAssistantLimit?: (
    clientId: string,
    monthlyCapUsd: number,
  ) => Promise<string | undefined>;
  /** Resolves with a problem to show, or undefined once the assistant's limit is removed. */
  readonly onRemoveAssistant?: (clientId: string) => Promise<string | undefined>;
}

function GuideLink({ children }: { readonly children: string }) {
  return (
    <a href={agentSetupGuideUrl(currentScreenLanguage())} rel="noreferrer noopener" target="_blank">
      {children}
    </a>
  );
}

export function AgentSetup({
  available,
  serverUrl,
  workspaceId,
  tokens,
  onIssue,
  onRevoke,
  open = false,
  workJournal,
  assistants,
  onSetAssistantLimit,
  onRemoveAssistant,
}: AgentSetupProps) {
  const id = useId();
  const [host, setHost] = useState<AgentHost>("plugin");
  const [issued, setIssued] = useState<IssuedAgentToken | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<"configuration" | "token" | undefined>(undefined);
  const [scopes, setScopes] = useState<readonly AgentScope[]>(defaultAgentScopes);
  const [cap, setCap] = useState(defaultAgentMonthlyCapUsd);

  if (available === undefined) return null;
  const heading = (
    <>
      <h3>{t`Agents`}</h3>
      <p className="muted">
        {t`Let Claude Code, Codex or another agent work with DraftLoop for you. Approvals, review decisions and settings always stay with you here.`}
      </p>
      {workJournal}
    </>
  );
  const active = tokens === undefined ? undefined : activeAgentTokens(tokens);
  const connected = (
    <ConnectedAgents
      tokens={available ? (active ?? []) : undefined}
      assistants={assistants}
      onRevoke={onRevoke}
      {...(onSetAssistantLimit === undefined ? {} : { onSetLimit: onSetAssistantLimit })}
      {...(onRemoveAssistant === undefined ? {} : { onRemoveAssistant })}
    />
  );
  if (!available) {
    return (
      <section className="coding-agents" id={codingAgentsSectionId}>
        {heading}
        {assistants === undefined ? (
          <p className="muted">
            {t`Connecting an agent to the hosted service is not available yet. It works today with a self-hosted server.`}{" "}
            <GuideLink>{t`How it works`}</GuideLink>
          </p>
        ) : (
          connected
        )}
      </section>
    );
  }

  const configuration = agentConfiguration(host, {
    serverUrl,
    workspaceId,
    token: issued?.token,
  });
  const holdsToken = agentConfigurationHoldsToken(host);
  const startsRuns = scopes.includes("runs:start");
  const monthlyCap = parseAgentMonthlyCap(cap);

  async function create() {
    setBusy(true);
    setProblem(undefined);
    const answer = startsRuns
      ? await onIssue(agentHostLabel(host), scopes, monthlyCap)
      : await onIssue(agentHostLabel(host), scopes);
    if ("problem" in answer) setProblem(t`The token could not be created. ${answer.problem}`);
    else {
      setIssued(answer);
      setCopied(undefined);
    }
    setBusy(false);
  }

  async function copy(what: "configuration" | "token", value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
    } catch {
      setCopied(undefined);
    }
  }

  const expires = issued === undefined ? undefined : (formatDate(issued.expires_at) ?? "");

  function toggle(scope: AgentScope, on: boolean) {
    setScopes(agentScopes.filter((each) => (each === scope ? on : scopes.includes(each))));
  }

  return (
    <section className="coding-agents" id={codingAgentsSectionId}>
      {heading}
      {connected}
      <details className="agent-setup" open={open || undefined}>
        <summary>{t`Connect an agent`}</summary>
        <ol>
          <li>
            {t`Install draftloop-mcp once on this computer.`}{" "}
            <GuideLink>{t`Setup guide`}</GuideLink>
          </li>
          <li>
            {t`Choose what your agent may do, then create its token.`}
            <fieldset className="agent-setup-scopes">
              <legend className="sr-only">{t`What the agent may do`}</legend>
              {agentScopes.map((scope) => (
                <label key={scope}>
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={(event) => toggle(scope, event.currentTarget.checked)}
                  />{" "}
                  {agentScopeLabel(scope)}
                </label>
              ))}
              {startsRuns ? (
                <label className="agent-setup-cap">
                  {t`Monthly spend limit in US dollars`}{" "}
                  <input
                    type="text"
                    inputMode="decimal"
                    value={cap}
                    aria-invalid={monthlyCap === undefined || undefined}
                    aria-describedby={`${id}-cap-hint`}
                    onChange={(event) => setCap(event.currentTarget.value)}
                  />
                  <span className="muted" id={`${id}-cap-hint`}>
                    {t`Each run counts at your workspace's cost limit per run, and each draft at its cost cap. From 0.01 to 500.`}
                  </span>
                </label>
              ) : null}
            </fieldset>
            <button
              type="button"
              disabled={busy || scopes.length === 0 || (startsRuns && monthlyCap === undefined)}
              onClick={() => void create()}
            >
              {t`Create agent token`}
            </button>
          </li>
          <li>{t`Copy the configuration into your agent.`}</li>
        </ol>
        {problem === undefined ? null : (
          <p className="problem" role="alert">
            {problem}
          </p>
        )}
        {expires === undefined ? null : (
          <p className="agent-setup-warning" role="status">
            {t`This token is shown once. Keep it in your user settings, not in a file you commit. It expires on ${expires}; revoke it here.`}
          </p>
        )}
        <div className="agent-setup-hosts" role="tablist" aria-label={t`Agent`}>
          {agentHosts.map((each) => (
            <button
              key={each}
              type="button"
              role="tab"
              id={`${id}-${each}`}
              aria-selected={each === host}
              aria-controls={`${id}-configuration`}
              onClick={() => {
                setHost(each);
                setCopied(undefined);
              }}
            >
              {agentHostLabel(each)}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`${id}-configuration`} aria-labelledby={`${id}-${host}`}>
          <p className="muted">{agentHostHint(host)}</p>
          <pre
            className={
              issued === undefined && holdsToken
                ? "agent-setup-config pending"
                : "agent-setup-config"
            }
          >
            <code>{configuration}</code>
          </pre>
          <button
            type="button"
            disabled={issued === undefined && holdsToken}
            onClick={() => void copy("configuration", configuration)}
          >
            {copied === "configuration" ? t`Copied` : t`Copy`}
          </button>
          {holdsToken || issued === undefined ? null : (
            <p className="agent-setup-token">
              {t`Token:`} <code>{issued.token}</code>{" "}
              <button type="button" onClick={() => void copy("token", issued.token)}>
                {copied === "token" ? t`Copied` : t`Copy token`}
              </button>
            </p>
          )}
        </div>
        <p className="muted">
          <GuideLink>{t`Full setup guide`}</GuideLink>
        </p>
      </details>
    </section>
  );
}
