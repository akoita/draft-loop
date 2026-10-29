import type { FormEvent, ReactNode } from "react";

import type { ApiClient, ApiSchemas } from "./api-client.js";
import { useSensitivityRules } from "./sensitivity.js";
import { type RuleForm, ruleSentence, type SensitivityRule } from "./sensitivity-model.js";

type KnowledgeBase = ApiSchemas["KnowledgeBase"];

export interface PrivateSectionsPanelProps {
  /** The workspace's selected knowledge bases, or undefined until they are read. */
  readonly bases: readonly KnowledgeBase[] | undefined;
  /** One rules group for a base; the panel adds its heading when there are several bases. */
  readonly rulesFor: (base: KnowledgeBase) => ReactNode;
}

/** The private-section rules of the selected knowledge bases, one group per base. */
export function PrivateSectionsPanel({ bases, rulesFor }: PrivateSectionsPanelProps) {
  return (
    <section className="panel host-panel" aria-labelledby="private-sections-heading">
      <h2 id="private-sections-heading">Private sections</h2>
      <p className="muted">
        Mark Markdown sections by their heading. Never-send sections never reach a model;
        only-if-allowed sections stay out unless the workspace allows sensitive material.
      </p>
      {bases === undefined ? (
        <p role="status">Reading your knowledge bases…</p>
      ) : bases.length === 0 ? (
        <p className="muted">Rules apply once a knowledge base is chosen.</p>
      ) : (
        bases.map((base) => (
          <div key={base.id}>
            {bases.length > 1 ? <h3>{base.displayName}</h3> : null}
            {rulesFor(base)}
          </div>
        ))
      )}
    </section>
  );
}

export interface BaseRulesProps {
  readonly rules: readonly SensitivityRule[] | undefined;
  readonly form: RuleForm;
  readonly problems: readonly string[];
  readonly busy: boolean;
  readonly knowledgeBaseId: string;
  readonly onChange: (form: RuleForm) => void;
  readonly onAdd: () => void;
  readonly onRemove: (ruleId: string) => void;
}

/** One base's rules as sentences, with a one-line form that adds another. */
export function BaseRules(props: BaseRulesProps) {
  const { rules, form, busy, knowledgeBaseId } = props;
  const set = (patch: Partial<RuleForm>) => props.onChange({ ...form, ...patch });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    props.onAdd();
  }

  return (
    <div className="rules">
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
              {ruleSentence(rule)}{" "}
              <button
                type="button"
                className="secondary"
                disabled={busy}
                aria-label={`Remove rule: ${ruleSentence(rule)}`}
                onClick={() => props.onRemove(rule.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="rule-form">
        <select
          aria-label="What to do with matching sections"
          value={form.tier}
          onChange={(event) => set({ tier: event.target.value as RuleForm["tier"] })}
        >
          <option value="never-share">Never send</option>
          <option value="sensitive">Send only if allowed</option>
        </select>{" "}
        sections whose heading{" "}
        <select
          aria-label="How the heading matches"
          value={form.kind}
          onChange={(event) => set({ kind: event.target.value as RuleForm["kind"] })}
        >
          <option value="heading-contains">contains</option>
          <option value="heading-path">is under</option>
        </select>{" "}
        <input
          id={`rule-heading-${knowledgeBaseId}`}
          aria-label={
            form.kind === "heading-contains"
              ? "Heading text"
              : "Headings, top level first, separated by >"
          }
          placeholder={form.kind === "heading-contains" ? "Salary" : "Health > Notes"}
          value={form.heading}
          onChange={(event) => set({ heading: event.target.value })}
        />{" "}
        <button type="submit" disabled={busy}>
          Add rule
        </button>
      </form>
    </div>
  );
}

function LiveBaseRules({
  client,
  knowledgeBaseId,
}: {
  readonly client: ApiClient;
  readonly knowledgeBaseId: string;
}) {
  const state = useSensitivityRules(client, knowledgeBaseId);
  return (
    <BaseRules
      knowledgeBaseId={knowledgeBaseId}
      rules={state.rules}
      form={state.form}
      problems={state.problems}
      busy={state.busy}
      onChange={state.setForm}
      onAdd={() => void state.add()}
      onRemove={(ruleId) => void state.remove(ruleId)}
    />
  );
}

export interface PrivateSectionsProps {
  readonly client: ApiClient;
  readonly bases: readonly KnowledgeBase[] | undefined;
}

/** The Career evidence page's private-section rules, read and changed through the API. */
export function PrivateSections({ client, bases }: PrivateSectionsProps) {
  return (
    <PrivateSectionsPanel
      bases={bases}
      rulesFor={(base) => <LiveBaseRules client={client} knowledgeBaseId={base.id} />}
    />
  );
}
