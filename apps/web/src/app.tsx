import { type HostPanels, HostPanelsContext } from "@draft-loop/ui/host-panels";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";

import { type ApiClient, ApiRequestError, type ApiSchemas } from "./api-client.js";
import { RecordContext } from "./record-context.js";
import { Records } from "./records.js";
import { type RecordMemory, recordMemory } from "./records-model.js";
import type { TokenStore } from "./session.js";
import { SharedScreens } from "./shared-screens.js";
import {
  type Health,
  PageActions,
  ServiceDown,
  ServiceStatus,
  ShellActionsContext,
  SignOutButton,
} from "./shell-actions.js";
import { SignIn } from "./sign-in.js";
import { HeaderCredits } from "./start-panels.js";
import { webHostPanels } from "./web-host-panels.js";
import { WorkspaceStep } from "./workspace.js";
import { ownerWorkspaceId } from "./workspace-model.js";

export interface AppProps {
  readonly tokens: TokenStore;
  readonly createClient: (token: string) => ApiClient;
}

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

  const actions = (
    <>
      <ServiceStatus health={health} />
      <SignOutButton onSignOut={onSignOut} />
    </>
  );
  // The page opens on the shared screens' own header, as on the desktop: the shell's actions sit
  // in it. Sign-in mode lists the records above the screens, so its actions stay at the top.
  return (
    <div className="shell">
      {health === "unreachable" ? <ServiceDown /> : null}
      {mode === "sign-in" ? (
        <>
          <ShellActionsContext.Provider value={actions}>
            <PageActions />
          </ShellActionsContext.Provider>
          <Records client={client} memory={memory}>
            {(recordId, onSaved) => (
              <RecordScreens
                key={recordId}
                client={client}
                recordId={recordId}
                mode="sign-in"
                onSaved={onSaved}
              />
            )}
          </Records>
        </>
      ) : (
        <ShellActionsContext.Provider value={actions}>
          <RecordScreens client={client} recordId={ownerWorkspaceId} />
        </ShellActionsContext.Provider>
      )}
    </div>
  );
}

export interface RecordScreensProps {
  readonly client: ApiClient;
  /** The workspace id of the candidate record every step works on. */
  readonly recordId: string;
  /** Called with the record's id once the workspace is read or created. */
  readonly onSaved?: (recordId: string) => void;
  /** Sign-in mode asks for the permission to store material, which only that mode enforces. */
  readonly mode?: "owner" | "sign-in";
}

/**
 * One candidate record: its workspace is read first, and a first run creates it on the shared
 * setup screen. The shared screens then open on it, from Home to the run's review, approval and
 * export, with the web's own panels (consent, credits, file checks, private sections) in them.
 */
export function RecordScreens({ client, recordId, onSaved, mode = "owner" }: RecordScreensProps) {
  const [workspace, setWorkspace] = useState<ApiSchemas["Workspace"] | undefined>(undefined);
  const shellActions = useContext(ShellActionsContext);
  const onWorkspace = useCallback(
    (workspace: ApiSchemas["Workspace"]) => {
      setWorkspace(workspace);
      onSaved?.(workspace.id);
    },
    [onSaved],
  );

  const hostPanels = useMemo<HostPanels>(
    () => webHostPanels(client, mode, workspace),
    [client, mode, workspace],
  );

  // A first run shows only the shared setup screen, then lands on Home.
  if (workspace === undefined) {
    return (
      <RecordContext.Provider value={recordId}>
        <PageActions />
        <WorkspaceStep client={client} onWorkspace={onWorkspace} />
      </RecordContext.Provider>
    );
  }

  return (
    <RecordContext.Provider value={recordId}>
      <HostPanelsContext.Provider value={hostPanels}>
        <SharedScreens
          client={client}
          workspaceId={recordId}
          hostActions={
            <>
              <HeaderCredits client={client} mode={mode} />
              {shellActions}
            </>
          }
        />
      </HostPanelsContext.Provider>
    </RecordContext.Provider>
  );
}
