import { type FormEvent, useEffect, useState } from "react";

import { type ApiClient, describeError } from "./api-client.js";
import {
  defaultRuleForm,
  describeRule,
  type RuleForm,
  ruleRequest,
  type SensitivityRule,
} from "./sensitivity-model.js";

export interface SensitivityRulesStepProps {
  readonly client: ApiClient;
  readonly knowledgeBaseId: string;
}

export interface SensitivityRulesState {
  /** The base's rules; undefined until read. */
  readonly rules: readonly SensitivityRule[] | undefined;
  readonly form: RuleForm;
  readonly problems: readonly string[];
  readonly busy: boolean;
  readonly setForm: (form: RuleForm) => void;
  readonly add: () => Promise<void>;
  readonly remove: (ruleId: string) => Promise<boolean>;
}

/** Reads a knowledge base's sensitivity rules, and adds or removes one, each a new version. */
export function useSensitivityRules(
  client: ApiClient,
  knowledgeBaseId: string,
): SensitivityRulesState {
  const [rules, setRules] = useState<readonly SensitivityRule[] | undefined>(undefined);
  const [form, setForm] = useState<RuleForm>(defaultRuleForm);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    client
      .call("GET /v1/knowledge-bases/{knowledgeBaseId}/sensitivity-rules", {
        path: { knowledgeBaseId },
      })
      .then(
        (view) => current && setRules(view.rules),
        (error: unknown) => current && setProblems([describeError(error)]),
      );
    return () => {
      current = false;
    };
  }, [client, knowledgeBaseId]);

  async function change(action: () => Promise<{ readonly rules: readonly SensitivityRule[] }>) {
    setBusy(true);
    try {
      setRules((await action()).rules);
      setProblems([]);
      return true;
    } catch (error) {
      setProblems([describeError(error)]);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const request = ruleRequest(form);
    if ("problem" in request) {
      setProblems([request.problem]);
      return;
    }
    const added = await change(() =>
      client.call("POST /v1/knowledge-bases/{knowledgeBaseId}/sensitivity-rules", {
        path: { knowledgeBaseId },
        body: request.body,
      }),
    );
    if (added) setForm(defaultRuleForm);
  }

  const remove = (ruleId: string) =>
    change(() =>
      client.call("DELETE /v1/knowledge-bases/{knowledgeBaseId}/sensitivity-rules/{ruleId}", {
        path: { knowledgeBaseId, ruleId },
      }),
    );

  return { rules, form, problems, busy, setForm, add, remove };
}

/** A knowledge base's sensitivity rules: read, add and remove, each change a new version. */
export function SensitivityRulesStep({ client, knowledgeBaseId }: SensitivityRulesStepProps) {
  const { rules, form, problems, busy, setForm, add, remove } = useSensitivityRules(
    client,
    knowledgeBaseId,
  );

  return (
    <SensitivityRulesPanel
      knowledgeBaseId={knowledgeBaseId}
      rules={rules}
      form={form}
      problems={problems}
      busy={busy}
      onChange={setForm}
      onAdd={() => void add()}
      onRemove={(ruleId) => void remove(ruleId)}
    />
  );
}

export interface SensitivityRulesPanelProps {
  readonly knowledgeBaseId: string;
  readonly rules: readonly SensitivityRule[] | undefined;
  readonly form: RuleForm;
  readonly problems: readonly string[];
  readonly busy: boolean;
  readonly onChange: (form: RuleForm) => void;
  readonly onAdd: () => void;
  readonly onRemove: (ruleId: string) => void;
}

export function SensitivityRulesPanel(props: SensitivityRulesPanelProps) {
  const { knowledgeBaseId, rules, form, busy } = props;
  const set = (patch: Partial<RuleForm>) => props.onChange({ ...form, ...patch });
  const id = (name: string) => `${name}-${knowledgeBaseId}`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    props.onAdd();
  }

  return (
    <div className="rules">
      <h3>Private sections</h3>
      <p className="muted">
        Mark Markdown sections by their heading. Never-share sections never reach a model; sensitive
        ones stay out unless the workspace allows them.
      </p>
      {props.problems.map((problem) => (
        <p key={problem} className="problem" role="alert">
          {problem}
        </p>
      ))}
      {rules === undefined ? (
        <p role="status">Reading the rules…</p>
      ) : rules.length === 0 ? (
        <p className="muted">No rules: every section can be used.</p>
      ) : (
        <ul className="sources">
          {rules.map((rule) => (
            <li key={rule.id}>
              {describeRule(rule)}{" "}
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => props.onRemove(rule.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="inline-form">
        <select
          aria-label="Tier"
          value={form.tier}
          onChange={(event) => set({ tier: event.target.value as RuleForm["tier"] })}
        >
          <option value="never-share">Never share</option>
          <option value="sensitive">Sensitive</option>
        </select>
        <select
          aria-label="Match"
          value={form.kind}
          onChange={(event) => set({ kind: event.target.value as RuleForm["kind"] })}
        >
          <option value="heading-contains">Heading contains</option>
          <option value="heading-path">Under the headings</option>
        </select>
        <label htmlFor={id("rule-heading")}>
          {form.kind === "heading-contains"
            ? "Heading text"
            : "Headings, top level first, separated by >"}
        </label>
        <input
          id={id("rule-heading")}
          value={form.heading}
          onChange={(event) => set({ heading: event.target.value })}
        />
        <button type="submit" disabled={busy}>
          Add rule
        </button>
      </form>
    </div>
  );
}
