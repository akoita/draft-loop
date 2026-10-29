import { useEffect, useState } from "react";

import { type ApiClient, describeError } from "./api-client.js";
import {
  defaultRuleForm,
  type RuleForm,
  ruleRequest,
  type SensitivityRule,
} from "./sensitivity-model.js";

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
