import { useCallback, useEffect, useMemo, useState } from "react";

import { type ApiClient, ApiRequestError, type ApiSchemas } from "./api-client.js";
import { BriefStep } from "./brief.js";
import type { Brief } from "./brief-model.js";
import { RecordContext } from "./record-context.js";
import { Records } from "./records.js";
import { type RecordMemory, recordMemory } from "./records-model.js";
import { ReviewStep } from "./review.js";
import { RunStep } from "./run.js";
import type { Run } from "./run-model.js";
import { screenMemory } from "./screen-memory.js";
import type { TokenStore } from "./session.js";
import { SignIn } from "./sign-in.js";
import { SourcesStep } from "./sources.js";
import { WorkspaceStep } from "./workspace.js";
import { ownerWorkspaceId } from "./workspace-model.js";

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
  /**
   * Sign-in mode lists the caller's candidate records and switches between them; owner-token
   * mode keeps the owner's single workspace.
   */
  readonly mode?: "owner" | "sign-in";
  /** Where sign-in mode remembers the tab's record; the browser tab's by default. */
  readonly memory?: RecordMemory;
}

/** The screen's steps, in the order a run needs them. */
export const steps = [
  { id: "workspace", label: "Workspace" },
  { id: "sources", label: "Sources" },
  { id: "brief", label: "Job brief" },
  { id: "run", label: "Run" },
  { id: "review", label: "Review" },
] as const;

export type StepId = (typeof steps)[number]["id"];

export function Shell({ client, onSignOut, mode = "owner", memory = recordMemory }: ShellProps) {
  const [health, setHealth] = useState<Health>("checking");

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
      {mode === "sign-in" ? (
        <Records client={client} memory={memory} onSwitch={() => screenMemory.forget()}>
          {(recordId, onSaved) => (
            <RecordSteps key={recordId} client={client} recordId={recordId} onSaved={onSaved} />
          )}
        </Records>
      ) : (
        <RecordSteps client={client} recordId={ownerWorkspaceId} />
      )}
    </div>
  );
}

export interface RecordStepsProps {
  readonly client: ApiClient;
  /** The workspace id of the candidate record every step works on. */
  readonly recordId: string;
  /** Called with the record's id once the Workspace step reads or creates it. */
  readonly onSaved?: (recordId: string) => void;
}

/** The steps over one candidate record, from its workspace to the reviewed draft. */
export function RecordSteps({ client, recordId, onSaved }: RecordStepsProps) {
  const [step, setStep] = useState<StepId>("workspace");
  const [workspace, setWorkspace] = useState<ApiSchemas["Workspace"] | undefined>(undefined);
  const [brief, setBrief] = useState<Brief | undefined>(undefined);
  const [run, setRun] = useState<Run | undefined>(undefined);
  const onWorkspace = useCallback(
    (workspace: ApiSchemas["Workspace"]) => {
      setWorkspace(workspace);
      onSaved?.(workspace.id);
    },
    [onSaved],
  );

  return (
    <RecordContext.Provider value={recordId}>
      <nav className="steps" aria-label="Steps">
        {steps.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === step ? "step current" : "step"}
            aria-current={item.id === step ? "step" : undefined}
            disabled={item.id !== "workspace" && workspace === undefined}
            onClick={() => setStep(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <main>
        {step === "workspace" || workspace === undefined ? (
          <WorkspaceStep client={client} onWorkspace={onWorkspace} />
        ) : step === "sources" ? (
          <SourcesStep client={client} workspace={workspace} onWorkspace={onWorkspace} />
        ) : step === "brief" ? (
          <BriefStep client={client} onBrief={setBrief} />
        ) : step === "run" ? (
          <RunStep
            client={client}
            brief={brief}
            onRun={setRun}
            onReview={() => setStep("review")}
          />
        ) : step === "review" ? (
          <ReviewStep
            client={client}
            run={run}
            onFollowRun={(next) => {
              setRun(next);
              setStep("run");
            }}
          />
        ) : null}
      </main>
    </RecordContext.Provider>
  );
}
