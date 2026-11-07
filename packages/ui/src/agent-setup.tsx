import { t } from "@lingui/core/macro";
import { useId, useState } from "react";

import {
  type AgentHost,
  type AgentTokenView,
  activeAgentTokens,
  agentChannelGuideUrl,
  agentConfiguration,
  agentHostHint,
  agentHostLabel,
  agentHosts,
} from "./agent-setup-model.js";
import { formatDate } from "./locale-format.js";

/**
 * "Connect a coding agent" in the Work journal panel (#2427): creates an agent token and shows
 * the configuration to paste into the agent, with the token in it. The secret lives only in this
 * component's state, shown once; a server that issues no agent tokens gets one line instead.
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
  readonly onIssue: (label: string) => Promise<IssuedAgentToken | { readonly problem: string }>;
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
}: AgentSetupProps) {
  const id = useId();
  const [host, setHost] = useState<AgentHost>("claude-code");
  const [issued, setIssued] = useState<IssuedAgentToken | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showTokens, setShowTokens] = useState(false);

  if (available === undefined) return null;
  if (!available) {
    return (
      <details className="agent-setup">
        <summary>{t`Connect a coding agent`}</summary>
        <p className="muted">
          {t`Connecting a coding agent to the hosted service is not available yet. It works today with a self-hosted server.`}{" "}
          <GuideLink>{t`How it works`}</GuideLink>
        </p>
      </details>
    );
  }

  const configuration = agentConfiguration(host, {
    serverUrl,
    workspaceId,
    token: issued?.token,
  });
  const active = tokens === undefined ? undefined : activeAgentTokens(tokens);

  async function create() {
    setBusy(true);
    setProblem(undefined);
    const answer = await onIssue(agentHostLabel(host));
    if ("problem" in answer) setProblem(t`The token could not be created. ${answer.problem}`);
    else {
      setIssued(answer);
      setCopied(false);
    }
    setBusy(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(configuration);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function revoke(tokenId: string) {
    setProblem(await onRevoke(tokenId));
  }

  const expires = issued === undefined ? undefined : (formatDate(issued.expires_at) ?? "");

  return (
    <details className="agent-setup">
      <summary>{t`Connect a coding agent`}</summary>
      <ol>
        <li>
          {t`Install draftloop-mcp once on this computer.`} <GuideLink>{t`Setup guide`}</GuideLink>
        </li>
        <li>
          {t`Create a token for your agent. It can only add notes here and list their titles.`}{" "}
          <button type="button" disabled={busy} onClick={() => void create()}>
            {t`Create agent token`}
          </button>
        </li>
        <li>{t`Copy the configuration into your agent, then ask it to run /log-work.`}</li>
      </ol>
      {problem === undefined ? null : (
        <p className="problem" role="alert">
          {problem}
        </p>
      )}
      {expires === undefined ? null : (
        <p className="agent-setup-warning" role="status">
          {t`This token is shown once. Keep it in your user settings, not in a file you commit. It expires on ${expires}; revoke it from this panel.`}
        </p>
      )}
      <div className="agent-setup-hosts" role="tablist" aria-label={t`Coding agent`}>
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
              setCopied(false);
            }}
          >
            {agentHostLabel(each)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-configuration`} aria-labelledby={`${id}-${host}`}>
        <p className="muted">{agentHostHint(host)}</p>
        <pre className={issued === undefined ? "agent-setup-config pending" : "agent-setup-config"}>
          <code>{configuration}</code>
        </pre>
        <button type="button" disabled={issued === undefined} onClick={() => void copy()}>
          {copied ? t`Copied` : t`Copy`}
        </button>
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
            return (
              <li key={token.id}>
                <span>
                  {token.label}{" "}
                  <span className="muted">{t`created ${created}, expires ${until}`}</span>
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
  );
}
