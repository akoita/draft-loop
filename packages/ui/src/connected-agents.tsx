import { t } from "@lingui/core/macro";
import { useId, useState } from "react";

import {
  type AgentTokenView,
  agentScopeName,
  defaultAgentMonthlyCapUsd,
  parseAgentMonthlyCap,
} from "./agent-setup-model.js";
import { formatDate, formatNumber } from "./locale-format.js";

/**
 * Connected agents in Workspace settings → Agents (#2785): one table of every active agent token
 * and every assistant that signed in, with what it may do, what it spends and one way to stop it.
 * An assistant appears once it asks to spend, so the person sets its limit on its row and never
 * types an id. Stopping asks once, because the agent then works no more.
 */

/** One assistant connection as the API lists it; no limit until the person sets one. */
export interface AssistantConnectionView {
  readonly client_id: string;
  readonly monthly_cap_usd?: number | undefined;
  readonly spent_this_month_usd: number;
}

export interface ConnectedAgentsProps {
  /** The workspace's active tokens; undefined where the server issues none. */
  readonly tokens: readonly AgentTokenView[] | undefined;
  /** Assistants that signed in; undefined where the server keeps no limits. */
  readonly assistants: readonly AssistantConnectionView[] | undefined;
  /** Each resolves with a problem to show, or undefined once done. */
  readonly onRevoke: (tokenId: string) => Promise<string | undefined>;
  readonly onSetLimit?: (clientId: string, monthlyCapUsd: number) => Promise<string | undefined>;
  readonly onRemoveAssistant?: (clientId: string) => Promise<string | undefined>;
}

/** A readable name for an assistant's client, which the identity provider names by id. */
export function assistantName(clientId: string): string {
  if (/claude|anthropic/iu.test(clientId)) return "Claude";
  if (/chatgpt|openai/iu.test(clientId)) return "ChatGPT";
  try {
    return new URL(clientId).hostname;
  } catch {
    return clientId;
  }
}

type Row =
  | { readonly kind: "token"; readonly key: string; readonly token: AgentTokenView }
  | {
      readonly kind: "assistant";
      readonly key: string;
      readonly assistant: AssistantConnectionView;
    };

export function ConnectedAgents({
  tokens,
  assistants,
  onRevoke,
  onSetLimit,
  onRemoveAssistant,
}: ConnectedAgentsProps) {
  const id = useId();
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [cap, setCap] = useState(defaultAgentMonthlyCapUsd);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  if (tokens === undefined && assistants === undefined) return null;
  const rows: readonly Row[] = [
    ...(tokens ?? []).map((token) => ({ kind: "token" as const, key: `token:${token.id}`, token })),
    ...(assistants ?? []).map((assistant) => ({
      kind: "assistant" as const,
      key: `assistant:${assistant.client_id}`,
      assistant,
    })),
  ];
  const monthlyCap = parseAgentMonthlyCap(cap);

  async function run(action: () => Promise<string | undefined>) {
    setBusy(true);
    const failed = await action();
    setProblem(failed);
    setBusy(false);
    if (failed === undefined) {
      setConfirming(undefined);
      setEditing(undefined);
    }
  }

  function spending(row: Row) {
    if (row.kind === "token") {
      const { monthly_cap_usd: limit, spent_this_month_usd: spent } = row.token;
      if (limit === undefined) return t`Cannot spend`;
      return t`US$${formatNumber(spent ?? 0)} of US$${formatNumber(limit)} this month`;
    }
    const { monthly_cap_usd: limit, spent_this_month_usd: spent } = row.assistant;
    if (limit === undefined) return t`No limit yet, so it starts no run or draft`;
    return t`US$${formatNumber(spent)} of US$${formatNumber(limit)} this month`;
  }

  return (
    <div className="connected-agents">
      <h4 id={`${id}-title`}>{t`Connected agents`}</h4>
      {rows.length === 0 ? (
        <p className="muted">{t`No agent is connected yet. Connect one below.`}</p>
      ) : (
        <div className="connected-agents-table">
          <table aria-labelledby={`${id}-title`}>
            <thead>
              <tr>
                <th scope="col">{t`Agent`}</th>
                <th scope="col">{t`May`}</th>
                <th scope="col">{t`Spending`}</th>
                <th scope="col">
                  <span className="sr-only">{t`Actions`}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const name =
                  row.kind === "token" ? row.token.label : assistantName(row.assistant.client_id);
                const detail =
                  row.kind === "token"
                    ? t`Token, expires ${formatDate(row.token.expires_at) ?? ""}`
                    : t`Signed in from the assistant`;
                const may =
                  row.kind === "token"
                    ? row.token.scopes.map(agentScopeName).join(" · ")
                    : t`What you allowed when it signed in`;
                const hasLimit =
                  row.kind === "assistant" && row.assistant.monthly_cap_usd !== undefined;
                return (
                  <tr key={row.key}>
                    <th scope="row" data-label={t`Agent`}>
                      <span className="connected-agents-name">{name}</span>
                      <span className="muted">{detail}</span>
                    </th>
                    <td data-label={t`May`}>{may}</td>
                    <td data-label={t`Spending`}>
                      {editing === row.key && row.kind === "assistant" ? (
                        <span className="connected-agents-limit">
                          <label>
                            {t`Monthly limit in US dollars`}{" "}
                            <input
                              type="text"
                              inputMode="decimal"
                              value={cap}
                              aria-invalid={monthlyCap === undefined || undefined}
                              onChange={(event) => setCap(event.currentTarget.value)}
                            />
                          </label>
                          <button
                            type="button"
                            className="button button-primary"
                            disabled={busy || monthlyCap === undefined || onSetLimit === undefined}
                            onClick={() => {
                              if (monthlyCap === undefined || onSetLimit === undefined) return;
                              void run(() => onSetLimit(row.assistant.client_id, monthlyCap));
                            }}
                          >
                            {t`Save limit`}
                          </button>
                          <button
                            type="button"
                            className="button button-outline"
                            disabled={busy}
                            onClick={() => setEditing(undefined)}
                          >
                            {t`Cancel`}
                          </button>
                        </span>
                      ) : (
                        <>
                          {spending(row)}
                          {row.kind === "assistant" && onSetLimit !== undefined ? (
                            <>
                              {" "}
                              <button
                                type="button"
                                className="link-action"
                                onClick={() => {
                                  setEditing(row.key);
                                  setCap(
                                    String(
                                      row.assistant.monthly_cap_usd ?? defaultAgentMonthlyCapUsd,
                                    ),
                                  );
                                }}
                              >
                                {hasLimit ? t`Change limit` : t`Set a limit`}
                              </button>
                            </>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className="connected-agents-actions">
                      {confirming === row.key ? (
                        <span className="connected-agents-confirm">
                          <span>
                            {row.kind === "token"
                              ? t`Disconnect ${name}? Its token stops working now.`
                              : hasLimit
                                ? t`Stop spending by ${name}? It starts no run or draft until you set a limit again.`
                                : t`Remove ${name} from this list? It shows again if it asks to spend.`}
                          </span>
                          <button
                            type="button"
                            className="button button-primary"
                            disabled={busy}
                            onClick={() =>
                              void run(() =>
                                row.kind === "token"
                                  ? onRevoke(row.token.id)
                                  : (onRemoveAssistant?.(row.assistant.client_id) ??
                                    Promise.resolve(undefined)),
                              )
                            }
                          >
                            {row.kind === "token"
                              ? t`Disconnect`
                              : hasLimit
                                ? t`Stop spending`
                                : t`Remove`}
                          </button>
                          <button
                            type="button"
                            className="button button-outline"
                            disabled={busy}
                            onClick={() => setConfirming(undefined)}
                          >
                            {t`Keep it`}
                          </button>
                        </span>
                      ) : row.kind === "token" || onRemoveAssistant !== undefined ? (
                        <button
                          type="button"
                          className="button button-outline"
                          disabled={busy}
                          onClick={() => setConfirming(row.key)}
                        >
                          {row.kind === "token"
                            ? t`Disconnect`
                            : hasLimit
                              ? t`Stop spending`
                              : t`Remove`}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {problem === undefined ? null : (
        <p className="problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
