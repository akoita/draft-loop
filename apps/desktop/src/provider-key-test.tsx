import { useMemo, useRef, useState } from "react";

import type { CredentialTestProvider, CredentialTestResult } from "./bridge.js";

/** One key test in the Provider authentication dialog: running, answered, or refused by the host. */
export type CredentialTestState =
  | { readonly status: "testing" }
  | { readonly status: "done"; readonly result: CredentialTestResult }
  | { readonly status: "failed"; readonly message: string; readonly checkedAt: string };

export type CredentialTestCallback = (
  provider: CredentialTestProvider,
) => Promise<CredentialTestResult>;

export const credentialTestProviders: readonly CredentialTestProvider[] = ["anthropic", "openai"];

export function isCredentialTestProvider(provider: string): provider is CredentialTestProvider {
  return (credentialTestProviders as readonly string[]).includes(provider);
}

type Tone = "works" | "rejected" | "warning" | "unknown";

function listModels(models: readonly string[]): string {
  return models.join(" and ");
}

/** What a key test result says, in one sentence for a person. */
export function describeCredentialTest(result: CredentialTestResult): {
  readonly label: string;
  readonly detail: string;
  readonly tone: Tone;
} {
  switch (result.outcome) {
    case "works":
      return {
        label: "Works",
        tone: "works",
        detail:
          result.models.length === 0
            ? "The provider accepts this key. The open workspace uses none of its models, so no model was checked."
            : `The provider accepts this key, and ${listModels(result.models)} ${result.models.length > 1 ? "are" : "is"} available to it.`,
      };
    case "rejected":
      return {
        label: "Rejected",
        tone: "rejected",
        detail: "The provider does not accept this key. Check it for a typo or replace it.",
      };
    case "no-model-access":
      return {
        label: "No access to the model",
        tone: "warning",
        detail: `The key works, but ${listModels(result.models)} is not available to it. Choose another model or use a key from an account that has it.`,
      };
    case "limited":
      return {
        label: "Quota or rate limit",
        tone: "warning",
        detail:
          result.providerCode === null
            ? "The provider accepted the request but refused it for now. Check the account's quota, or try again later."
            : `The provider answered ${result.providerCode}. Check the account's quota, or try again later.`,
      };
    case "unreachable":
      return {
        label: "Could not check",
        tone: "unknown",
        detail:
          "DraftLoop could not reach the provider, so the key was not tested. Try again when you are online.",
      };
  }
}

function checkedAtText(checkedAt: string): string {
  const time = new Date(checkedAt);
  return Number.isNaN(time.getTime()) ? "" : time.toLocaleTimeString();
}

/** The line under a key row that shows its latest test. */
export function CredentialTestLine({ state }: { readonly state: CredentialTestState }) {
  if (state.status === "testing") {
    return (
      <p className="credential-test-result credential-test-unknown" role="status">
        Testing the key with the provider…
      </p>
    );
  }
  const { label, detail, tone } =
    state.status === "done"
      ? describeCredentialTest(state.result)
      : { label: "Could not check", detail: state.message, tone: "unknown" as const };
  const checkedAt = state.status === "done" ? state.result.checkedAt : state.checkedAt;
  return (
    <p className={`credential-test-result credential-test-${tone}`} role="status">
      <strong>{label}.</strong> {detail} Checked at{" "}
      <time dateTime={checkedAt}>{checkedAtText(checkedAt)}</time>.
    </p>
  );
}

export type CredentialTestStates = Partial<Record<CredentialTestProvider, CredentialTestState>>;

/**
 * Key test states for the dialog, outside React so the ordering rules are testable. Clearing a
 * provider, as editing, saving or removing its key does, also drops an answer still in flight, so
 * an old key's result never lands on a new one.
 */
export function createCredentialTestTracker(
  run: CredentialTestCallback,
  publish: (states: CredentialTestStates) => void,
  now: () => Date = () => new Date(),
) {
  let states: CredentialTestStates = {};
  const generations: Partial<Record<CredentialTestProvider, number>> = {};
  const set = (provider: CredentialTestProvider, state: CredentialTestState | undefined) => {
    const { [provider]: _previous, ...rest } = states;
    states = state === undefined ? rest : { ...rest, [provider]: state };
    publish(states);
  };

  return {
    states: () => states,
    clear(provider: string) {
      if (!isCredentialTestProvider(provider)) return;
      generations[provider] = (generations[provider] ?? 0) + 1;
      if (states[provider] !== undefined) set(provider, undefined);
    },
    async test(provider: CredentialTestProvider) {
      const generation = (generations[provider] ?? 0) + 1;
      generations[provider] = generation;
      set(provider, { status: "testing" });
      let next: CredentialTestState;
      try {
        next = { status: "done", result: await run(provider) };
      } catch (error: unknown) {
        next = {
          status: "failed",
          message: error instanceof Error ? error.message : "The key could not be tested.",
          checkedAt: now().toISOString(),
        };
      }
      if (generations[provider] === generation) set(provider, next);
    },
  };
}

/** The dialog's key tests; `test` does nothing when the host cannot test keys. */
export function useCredentialTests(onTestCredential: CredentialTestCallback | undefined) {
  const [states, setStates] = useState<CredentialTestStates>({});
  const runRef = useRef(onTestCredential);
  runRef.current = onTestCredential;
  const tracker = useMemo(
    () =>
      createCredentialTestTracker(async (provider) => {
        const run = runRef.current;
        if (run === undefined) throw new Error("Testing API keys is unavailable.");
        return run(provider);
      }, setStates),
    [],
  );
  return { states, test: tracker.test, clear: tracker.clear };
}
