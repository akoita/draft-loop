import { t } from "@lingui/core/macro";
import { useId, useState } from "react";

import {
  type AgentHost,
  type AgentScope,
  type AgentTokenView,
  activeAgentTokens,
  agentChannelGuideUrl,
  agentConfiguration,
  agentConfigurationHoldsToken,
  agentHostHint,
  agentHostLabel,
  agentHosts,
  agentScopeLabel,
  agentScopeName,
  agentScopes,
  defaultAgentMonthlyCapUsd,
  defaultAgentScopes,
  parseAgentMonthlyCap,
} from "./agent-setup-model.js";
import { formatDate, formatNumber } from "./locale-format.js";
import { codingAgentsSectionId } from "./shared-link.js";

/**
 * Agents in Workspace settings (#2427, moved app-wide in #2439): creates an agent token
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
}

function GuideLink({ children }: { readonly children: string }) {
  return (
    <a href={agentChannelGuideUrl} rel="noreferrer noopener" target="_blank">
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
}: AgentSetupProps) {
  const id = useId();
  const [host, setHost] = useState<AgentHost>("plugin");
  const [issued, setIssued] = useState<IssuedAgentToken | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<"configuration" | "token" | undefined>(undefined);
  const [showTokens, setShowTokens] = useState(false);
  const [scopes, setScopes] = useState<readonly AgentScope[]>(defaultAgentScopes);
  const [cap, setCap] = useState(defaultAgentMonthlyCapUsd);

  if (available === undefined) return null;
  const heading = (
    <>
      <h3>{t`Agents`}</h3>
      <p className="muted">
        {t`Let Claude Code, Codex or another agent work with DraftLoop for you. Approvals, review decisions and settings always stay with you here.`}
      </p>
    </>
  );
  if (!available) {
    return (
      <section className="coding-agents" id={codingAgentsSectionId}>
        {heading}
        <p className="muted">
          {t`Connecting an agent to the hosted service is not available yet. It works today with a self-hosted server.`}{" "}
          <GuideLink>{t`How it works`}</GuideLink>
        </p>
      </section>
    );
  }

  const configuration = agentConfiguration(host, {
    serverUrl,
    workspaceId,
    token: issued?.token,
  });
  const active = tokens === undefined ? undefined : activeAgentTokens(tokens);
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

  async function revoke(tokenId: string) {
    setProblem(await onRevoke(tokenId));
  }

  const expires = issued === undefined ? undefined : (formatDate(issued.expires_at) ?? "");

  function toggle(scope: AgentScope, on: boolean) {
    setScopes(agentScopes.filter((each) => (each === scope ? on : scopes.includes(each))));
  }

  return (
    <section className="coding-agents" id={codingAgentsSectionId}>
      {heading}
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
        {active === undefined ? null : (
          <p className="muted">
            {t`Active agent tokens: ${active.length}`}
            {active.length === 0 ? null : (
              <>
                {" · "}
                <button
                  type="button"
                  className="link-action"
                  aria-expanded={showTokens}
                  onClick={() => setShowTokens(!showTokens)}
                >
                  {t`Show and revoke`}
                </button>
              </>
            )}
            {" · "}
            <GuideLink>{t`Full setup guide`}</GuideLink>
          </p>
        )}
        {showTokens && active !== undefined && active.length > 0 ? (
          <ul className="agent-setup-tokens">
            {active.map((token) => {
              const created = formatDate(token.created_at) ?? "";
              const until = formatDate(token.expires_at) ?? "";
              const can = token.scopes.map(agentScopeName).join(", ");
              const cap = token.monthly_cap_usd;
              const spent = formatNumber(token.spent_this_month_usd ?? 0);
              const limit = cap === undefined ? "" : formatNumber(cap);
              return (
                <li key={token.id}>
                  <span>
                    {token.label}{" "}
                    <span className="muted">{t`${can}; created ${created}, expires ${until}`}</span>
                    {cap === undefined ? null : (
                      <span className="muted">
                        {" "}
                        {t`US$${spent} of US$${limit} used this month.`}
                      </span>
                    )}
                  </span>{" "}
                  <button type="button" onClick={() => void revoke(token.id)}>
                    {t`Revoke`}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </details>
    </section>
  );
}

/** Where the Work journal panel points for connecting an agent (#2439). */
export function AgentSetupLink({ onOpen }: { readonly onOpen?: (() => void) | undefined }) {
  if (onOpen === undefined) return null;
  return (
    <p className="muted">
      {t`To let an agent file notes here, connect it under Agents in Workspace settings.`}{" "}
      <button type="button" className="link-action" onClick={onOpen}>
        {t`Connect an agent`}
      </button>
    </p>
  );
}
