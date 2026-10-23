import { useCallback, useEffect, useMemo, useState } from "react";

import { type ApiClient, ApiRequestError, type ApiSchemas } from "./api-client.js";
import type { TokenStore } from "./session.js";
import { SignIn } from "./sign-in.js";
import { WorkspaceStep } from "./workspace.js";

export interface AppProps {
  readonly tokens: TokenStore;
  readonly createClient: (token: string) => ApiClient;
}

type Health = "checking" | "serving" | "unreachable";

/** The owner's web screen over the hosted API. */
export function App({ tokens, createClient }: AppProps) {
  const [token, setToken] = useState<string | null>(() => tokens.read());
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const client = useMemo(() => {
    if (token === null) return undefined;
    const inner = createClient(token);
    // A refused token ends the session, so the owner signs in again instead of seeing errors.
    const guarded: ApiClient = {
      async call(operation, input) {
        try {
          return await inner.call(operation, input);
        } catch (error) {
          if (error instanceof ApiRequestError && error.status === 401) {
            tokens.clear();
            setNotice("The API refused the owner token. Sign in again.");
            setToken(null);
          }
          throw error;
        }
      },
    };
    return guarded;
  }, [token, tokens, createClient]);

  if (client === undefined)
    return (
      <SignIn
        {...(notice === undefined ? {} : { notice })}
        onSignIn={(value) => {
          tokens.write(value);
          setNotice(undefined);
          setToken(value);
        }}
      />
    );

  return (
    <Shell
      client={client}
      onSignOut={() => {
        tokens.clear();
        setToken(null);
      }}
    />
  );
}

export interface ShellProps {
  readonly client: ApiClient;
  readonly onSignOut: () => void;
}

/** The screen's steps, in the order a run needs them. */
export const steps = [{ id: "workspace", label: "Workspace" }] as const;

export type StepId = (typeof steps)[number]["id"];

export function Shell({ client, onSignOut }: ShellProps) {
  const [health, setHealth] = useState<Health>("checking");
  const [step, setStep] = useState<StepId>("workspace");
  const [, setWorkspace] = useState<ApiSchemas["Workspace"] | undefined>(undefined);
  const onWorkspace = useCallback((workspace: ApiSchemas["Workspace"]) => {
    setWorkspace(workspace);
  }, []);

  useEffect(() => {
    let current = true;
    client.call("GET /v1/health", {}).then(
      () => current && setHealth("serving"),
      () => current && setHealth("unreachable"),
    );
    return () => {
      current = false;
    };
  }, [client]);

  return (
    <div className="shell">
      <header className="shell-header">
        <h1>DraftLoop</h1>
        <p className={`health health-${health}`} role="status">
          {health === "checking"
            ? "Checking the service"
            : health === "serving"
              ? "Service is up"
              : "The service cannot be reached"}
        </p>
        <button type="button" className="secondary" onClick={onSignOut}>
          Sign out
        </button>
      </header>
      <nav className="steps" aria-label="Steps">
        {steps.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === step ? "step current" : "step"}
            aria-current={item.id === step ? "step" : undefined}
            onClick={() => setStep(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <main>
        {step === "workspace" ? <WorkspaceStep client={client} onWorkspace={onWorkspace} /> : null}
      </main>
    </div>
  );
}
