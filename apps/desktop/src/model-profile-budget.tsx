import {
  estimateModelProfileApiScenario,
  type ModelProfileApiScenarioInput,
  type ModelProfileApiScenarioUnavailableReason,
} from "@draft-loop/application/model-profile-budget";
import {
  listModelProfileCatalog,
  type ModelProfileCatalogEntry,
} from "@draft-loop/application/model-profile-catalog";
import type {
  ModelProfileReferences,
  RunProviderAuthModeConfiguration,
} from "@draft-loop/application/model-profile-selection";
import { useMemo, useState } from "react";

interface ModelProfileBudgetProps {
  readonly references: ModelProfileReferences;
  readonly authModes?: RunProviderAuthModeConfiguration;
  readonly disabled?: boolean;
}

export interface ModelProfileScenarioText {
  readonly inputTokens: string;
  readonly outputTokens: string;
  readonly calls: string;
}

export interface ModelProfileScenarioTextPair {
  readonly author: ModelProfileScenarioText;
  readonly critic: ModelProfileScenarioText;
}

const catalog = listModelProfileCatalog();

const initialScenario: ModelProfileScenarioTextPair = {
  author: { inputTokens: "10000", outputTokens: "1000", calls: "2" },
  critic: { inputTokens: "10000", outputTokens: "1000", calls: "1" },
};

function tokenCount(value: string): number {
  const normalized = value.trim();
  return normalized !== "" && /^\d+$/u.test(normalized) ? Number(normalized) : Number.NaN;
}

function scenarioInput(
  references: ModelProfileReferences,
  authModes: RunProviderAuthModeConfiguration | undefined,
  values: ModelProfileScenarioTextPair,
): ModelProfileApiScenarioInput {
  const scenario = (entry: ModelProfileScenarioText) => ({
    inputTokens: tokenCount(entry.inputTokens),
    outputTokens: tokenCount(entry.outputTokens),
    calls: tokenCount(entry.calls),
  });
  return {
    profiles: references,
    ...(authModes === undefined ? {} : { authModes }),
    author: scenario(values.author),
    critic: scenario(values.critic),
  };
}

export function modelProfileScenarioInputFromText(
  references: ModelProfileReferences,
  authModes: RunProviderAuthModeConfiguration | undefined,
  values: ModelProfileScenarioTextPair,
): ModelProfileApiScenarioInput {
  return scenarioInput(references, authModes, values);
}

function catalogEntry(
  reference: { readonly id: string; readonly version: number },
  role: "author" | "critic",
): ModelProfileCatalogEntry | undefined {
  return catalog.find(
    ({ profile }) =>
      profile.id === reference.id &&
      profile.version === reference.version &&
      profile.roles.includes(role),
  );
}

function unavailableMessage(reason: ModelProfileApiScenarioUnavailableReason): string {
  switch (reason) {
    case "unknown-profile":
      return "One or both exact profiles are not in the registered catalog, so no estimate is available.";
    case "authentication-unavailable":
      return "The configured authentication route is not known. Public rates remain reference information only.";
    case "subscription-billing":
      return "Public API rates do not estimate subscription quota or charges. No combined estimate is available for a user-session route.";
    case "invalid-scenario":
      return "Use nonnegative whole-token counts and planned call counts, with no more than 1,000 calls per role.";
    case "unsupported-pricing-scope":
      return "This profile does not have supported public pricing metadata for the displayed estimate scope.";
    case "unsupported-pricing-limit":
      return "This scenario exceeds the registered input, output, or context limits. Reduce the values; they are not adjusted automatically.";
  }
}

function currency(value: number): string {
  const fixed = value.toFixed(6);
  return value > 0 && fixed === "0.000000" ? "<$0.000001" : `$${fixed}`;
}

function PublicRate({
  entry,
  profileRole,
}: {
  readonly entry: ModelProfileCatalogEntry | undefined;
  readonly profileRole: "author" | "critic";
}) {
  if (entry === undefined) {
    return (
      <div className="model-profile-budget-rate">
        <strong>{profileRole === "author" ? "Author" : "Critic"}</strong>
        <p>No public API rate is available for this registered role.</p>
      </div>
    );
  }
  const { profile, apiPricing } = entry;
  const documentationName =
    profile.provider === "anthropic"
      ? "Anthropic"
      : profile.provider === "openai"
        ? "OpenAI"
        : "DeepInfra";
  return (
    <div className="model-profile-budget-rate">
      <strong>
        {profileRole === "author" ? "Author" : "Critic"}: {profile.id}@{profile.version}
      </strong>
      <span>
        {profile.provider}/{profile.modelId}
      </span>
      <dl>
        <div>
          <dt>Public uncached API list rates</dt>
          <dd>
            ${apiPricing.inputUsdPerMillion}/1M input · ${apiPricing.outputUsdPerMillion}/1M output
          </dd>
        </div>
        <div>
          <dt>Metadata review</dt>
          <dd>
            {entry.reviewedAt} · Official {documentationName} model/pricing documentation
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function ModelProfileBudget({
  references,
  authModes,
  disabled = false,
}: ModelProfileBudgetProps) {
  const [values, setValues] = useState<ModelProfileScenarioTextPair>(initialScenario);
  const input = useMemo(
    () => scenarioInput(references, authModes, values),
    [authModes, references, values],
  );
  const estimate = useMemo(() => estimateModelProfileApiScenario(input), [input]);
  const authorEntry = catalogEntry(references.author, "author");
  const criticEntry = catalogEntry(references.critic, "critic");

  const update = (
    role: "author" | "critic",
    field: keyof ModelProfileScenarioText,
    value: string,
  ) => {
    setValues((current) => ({
      ...current,
      [role]: { ...current[role], [field]: value },
    }));
  };

  return (
    <details className="model-profile-budget" open>
      <summary>Illustrative public API token-cost scenario</summary>
      <p className="model-profile-budget-copy">
        Public standard uncached text API list rates in USD, up to 200,000 input tokens per call.
        This is an explicit example, not a measured forecast, hard cap, or actual bill. Subscription
        quota and charges are not estimated.
      </p>
      <div className="model-profile-budget-rates">
        <PublicRate entry={authorEntry} profileRole="author" />
        <PublicRate entry={criticEntry} profileRole="critic" />
      </div>
      <p className="model-profile-budget-example">
        Initial illustration: 10,000 input and 1,000 output tokens per call, with 2 author calls and
        1 critic call. Edit every value to reflect your own scenario.
      </p>
      <div className="model-profile-budget-scenarios">
        {(["author", "critic"] as const).map((role) => (
          <fieldset className="model-profile-budget-role" disabled={disabled} key={role}>
            <legend>{role === "author" ? "Author scenario" : "Critic scenario"}</legend>
            <label>
              <span>Input tokens per call</span>
              <input
                type="number"
                min="0"
                step="1"
                value={values[role].inputTokens}
                aria-label={`${role} input tokens per call`}
                onChange={(event) => update(role, "inputTokens", event.target.value)}
              />
            </label>
            <label>
              <span>Output tokens per call</span>
              <input
                type="number"
                min="0"
                step="1"
                value={values[role].outputTokens}
                aria-label={`${role} output tokens per call`}
                onChange={(event) => update(role, "outputTokens", event.target.value)}
              />
            </label>
            <label>
              <span>Planned calls</span>
              <input
                type="number"
                min="0"
                max="1000"
                step="1"
                value={values[role].calls}
                aria-label={`${role} planned calls`}
                onChange={(event) => update(role, "calls", event.target.value)}
              />
            </label>
          </fieldset>
        ))}
      </div>
      <p className="model-profile-budget-formula">
        Formula: calls × (input tokens × input rate + output tokens × output rate) ÷ 1,000,000;
        author and critic are added together. The output allocation includes billable reasoning
        tokens where applicable, but does not change runtime controls.
      </p>
      {estimate.status === "available" ? (
        <dl className="model-profile-budget-result" aria-label="Estimated public API cost">
          <div>
            <dt>Author estimate</dt>
            <dd>{currency(estimate.authorUsd)}</dd>
          </div>
          <div>
            <dt>Critic estimate</dt>
            <dd>{currency(estimate.criticUsd)}</dd>
          </div>
          <div>
            <dt>Combined scenario estimate</dt>
            <dd>{currency(estimate.totalUsd)}</dd>
          </div>
        </dl>
      ) : (
        <p className="model-profile-budget-unavailable" role="status">
          {unavailableMessage(estimate.reason)}
        </p>
      )}
      <p className="model-profile-budget-assumptions">
        Actual costs may differ. This excludes extra calls, retries, input growth, cache, tools,
        batch, regional premiums, and unsupported long context. The scenario estimates list-rate API
        usage only and does not change the selected profiles or their runtime budgets.
      </p>
    </details>
  );
}
