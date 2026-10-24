import { type FormEvent, useEffect, useState } from "react";

import { type ApiClient, ApiRequestError, describeError } from "./api-client.js";
import {
  policyChanged,
  policyStatus,
  policyTextProblem,
  type WritingPolicy,
} from "./policy-model.js";
import { useRecordId } from "./record-context.js";

type PolicyState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly policy: WritingPolicy | undefined }
  | { readonly kind: "failed"; readonly message: string };

/** Reads the workspace's writing policy and saves edits as new versions. */
export function WritingPolicyStep({ client }: { readonly client: ApiClient }) {
  const workspaceId = useRecordId();
  const [state, setState] = useState<PolicyState>({ kind: "loading" });
  const [text, setText] = useState("");
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    client.call("GET /v1/workspaces/{workspaceId}/writing-policy", { path: { workspaceId } }).then(
      (policy) => {
        if (!current) return;
        setState({ kind: "ready", policy });
        setText(policy.content);
      },
      (error: unknown) => {
        if (!current) return;
        if (error instanceof ApiRequestError && error.status === 404)
          setState({ kind: "ready", policy: undefined });
        else setState({ kind: "failed", message: describeError(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [client, workspaceId]);

  async function save() {
    const problem = policyTextProblem(text);
    setProblems(problem === undefined ? [] : [problem]);
    if (problem !== undefined) return;
    setBusy(true);
    try {
      const policy = await client.call("PUT /v1/workspaces/{workspaceId}/writing-policy", {
        path: { workspaceId },
        body: { content: text },
      });
      setState({ kind: "ready", policy });
      setText(policy.content);
    } catch (error) {
      setProblems([describeError(error)]);
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === "loading") return <p role="status">Reading your writing policy…</p>;
  if (state.kind === "failed")
    return (
      <p className="problem" role="alert">
        {state.message}
      </p>
    );
  return (
    <WritingPolicyPanel
      policy={state.policy}
      text={text}
      problems={problems}
      busy={busy}
      onChange={setText}
      onSave={() => void save()}
    />
  );
}

export interface WritingPolicyPanelProps {
  readonly policy: WritingPolicy | undefined;
  readonly text: string;
  readonly problems: readonly string[];
  readonly busy: boolean;
  readonly onChange: (text: string) => void;
  readonly onSave: () => void;
}

export function WritingPolicyPanel(props: WritingPolicyPanelProps) {
  const { policy, text, busy } = props;
  const changed = policyChanged(policy, text);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    props.onSave();
  }

  return (
    <section className="panel">
      <h2>Writing policy</h2>
      <p>
        Your rules for how the CV is written: tone, length, what to stress or leave out. They guide
        the author and the critic, and never add facts.
      </p>
      <p className="muted">{policyStatus(policy)}</p>
      {props.problems.map((problem) => (
        <p key={problem} className="problem" role="alert">
          {problem}
        </p>
      ))}
      <form onSubmit={submit}>
        <label htmlFor="writing-policy">Policy, in Markdown</label>
        <textarea
          id="writing-policy"
          value={text}
          onChange={(event) => props.onChange(event.target.value)}
        />
        <button type="submit" disabled={busy || !changed}>
          {busy ? "Saving…" : changed ? "Save as a new version" : "Saved"}
        </button>
      </form>
    </section>
  );
}
