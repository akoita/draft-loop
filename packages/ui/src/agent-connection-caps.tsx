import { t } from "@lingui/core/macro";
import { useId, useState } from "react";

import { defaultAgentMonthlyCapUsd, parseAgentMonthlyCap } from "./agent-setup-model.js";
import { formatNumber } from "./locale-format.js";

/**
 * What connected assistants may spend, in Workspace settings → Agents (#2657). An assistant that
 * signs the person in holds no agent token, so its monthly limit is set here, per assistant. Each
 * row says the state in words and its buttons name what they do; stopping asks once, because the
 * assistant then starts no run or draft.
 */

/** One assistant's monthly limit, as the API lists it. */
export interface AgentConnectionCapView {
  readonly client_id: string;
  readonly monthly_cap_usd: number;
  readonly spent_this_month_usd: number;
}

export interface AgentConnectionCapsProps {
  /** The workspace's limits; undefined until read. */
  readonly connections: readonly AgentConnectionCapView[] | undefined;
  /** Resolves with a problem to show, or undefined once saved. */
  readonly onSet: (clientId: string, monthlyCapUsd: number) => Promise<string | undefined>;
  /** Resolves with a problem to show, or undefined once removed. */
  readonly onRemove: (clientId: string) => Promise<string | undefined>;
  /** Opens on the question asked before stopping this assistant, such as to show it. */
  readonly confirmingStop?: string;
}

/** An assistant's id as the identity provider names its client: 1 to 200 visible characters. */
export function parseAssistantId(text: string): string | undefined {
  const trimmed = text.trim();
  return /^[\x21-\x7e]{1,200}$/u.test(trimmed) ? trimmed : undefined;
}

export function AgentConnectionCaps({
  connections,
  onSet,
  onRemove,
  confirmingStop,
}: AgentConnectionCapsProps) {
  const id = useId();
  const [assistant, setAssistant] = useState("");
  const [cap, setCap] = useState(defaultAgentMonthlyCapUsd);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState<string | undefined>(confirmingStop);

  if (connections === undefined) return null;
  const assistantId = parseAssistantId(assistant);
  const monthlyCap = parseAgentMonthlyCap(cap);

  async function run(action: () => Promise<string | undefined>) {
    setSaving(true);
    const failed = await action();
    setProblem(failed);
    setSaving(false);
    setConfirming(undefined);
    return failed === undefined;
  }

  async function save() {
    if (assistantId === undefined || monthlyCap === undefined) return;
    if (await run(() => onSet(assistantId, monthlyCap))) setAssistant("");
  }

  return (
    <div className="agent-connection-caps">
      <p className="work-journal-intake-title">{t`Spending by connected assistants`}</p>
      <p className="muted">
        {t`An assistant you connect by signing in, such as Claude or ChatGPT, starts CV runs and drafts only within a monthly limit you set here. Without a limit it starts none.`}
      </p>
      {connections.length === 0 ? (
        <p className="muted">{t`No assistant has a spend limit.`}</p>
      ) : (
        <ul className="agent-setup-tokens">
          {connections.map((connection) => {
            const name = connection.client_id;
            const spent = formatNumber(connection.spent_this_month_usd);
            const limit = formatNumber(connection.monthly_cap_usd);
            if (confirming === name) {
              return (
                <li key={name} className="work-journal-intake-confirm">
                  <span>
                    <span className="work-journal-intake-title">{t`Stop spending by ${name}?`}</span>{" "}
                    <span className="muted">
                      {t`It will start no run or draft until you set a limit again. It keeps its other permissions.`}
                    </span>
                  </span>{" "}
                  <span className="work-journal-intake-actions">
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={saving}
                      onClick={() => void run(() => onRemove(name))}
                    >
                      {t`Stop spending`}
                    </button>
                    <button
                      type="button"
                      className="button button-outline"
                      disabled={saving}
                      onClick={() => setConfirming(undefined)}
                    >
                      {t`Keep the limit`}
                    </button>
                  </span>
                </li>
              );
            }
            return (
              <li key={name}>
                <span>
                  <span className="state-pill">{t`On`}</span> {name}{" "}
                  <span className="muted">{t`US$${spent} of US$${limit} used this month.`}</span>
                </span>{" "}
                <span className="work-journal-intake-actions">
                  <button
                    type="button"
                    className="button button-outline"
                    disabled={saving}
                    onClick={() => {
                      setAssistant(name);
                      setCap(String(connection.monthly_cap_usd));
                    }}
                  >
                    {t`Change limit`}
                  </button>
                  <button
                    type="button"
                    className="button button-outline"
                    disabled={saving}
                    onClick={() => setConfirming(name)}
                  >
                    {t`Stop spending`}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="agent-connection-caps-form">
        <label>
          {t`Assistant`}{" "}
          <input
            type="text"
            value={assistant}
            autoComplete="off"
            aria-describedby={`${id}-assistant-hint`}
            onChange={(event) => setAssistant(event.currentTarget.value)}
          />
        </label>{" "}
        <label>
          {t`Monthly spend limit in US dollars`}{" "}
          <input
            type="text"
            inputMode="decimal"
            value={cap}
            aria-invalid={monthlyCap === undefined || undefined}
            aria-describedby={`${id}-cap-hint`}
            onChange={(event) => setCap(event.currentTarget.value)}
          />
        </label>{" "}
        <button
          type="button"
          className="button button-primary"
          disabled={saving || assistantId === undefined || monthlyCap === undefined}
          onClick={() => void save()}
        >
          {t`Set spend limit`}
        </button>
        <p className="muted" id={`${id}-assistant-hint`}>
          {t`Type the assistant's id. When an assistant has no limit, it tells you its id.`}
        </p>
        <p className="muted" id={`${id}-cap-hint`}>
          {t`Each run counts at your workspace's cost limit per run, and each draft at its cost cap. From 0.01 to 500.`}
        </p>
      </div>
      {problem === undefined ? null : (
        <p className="problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
