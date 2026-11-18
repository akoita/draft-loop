import { useScreenLocale } from "@draft-loop/ui/i18n";
import {
  presetsWithinTiers,
  proposedCvLanguage,
  type WorkspaceSetupChoice,
  type WorkspaceSetupPreset,
  WorkspaceSetupScreen,
  workspaceSetupPresets,
} from "@draft-loop/ui/workspace-setup";
import { t } from "@lingui/core/macro";
import { useEffect, useRef, useState } from "react";

import { type ApiClient, ApiRequestError, type ApiSchemas, describeError } from "./api-client.js";
import { describeStartError } from "./credits-model.js";
import { useRecordId } from "./record-context.js";
import { defaultSetupChoice, routablePresets, setupRequestBody } from "./workspace-model.js";

type Workspace = ApiSchemas["Workspace"];

export type WorkspaceState =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "ready"; readonly workspace: Workspace }
  | { readonly kind: "failed"; readonly message: string };

export interface WorkspaceStepProps {
  readonly client: ApiClient;
  /** Called with the workspace once it is read or created. */
  readonly onWorkspace: (workspace: Workspace) => void;
  /**
   * Creates a missing workspace with the defaults instead of asking (one-person plans). If that
   * fails, the setup screen shows with the reason, so the person is never stuck.
   */
  readonly automatic?: boolean;
}

/** Reads the record's workspace and, on a first run, shows the shared setup screen to create it. */
export function WorkspaceStep({ client, onWorkspace, automatic = false }: WorkspaceStepProps) {
  const workspaceId = useRecordId();
  const { locale } = useScreenLocale();
  /** Whether the automatic create was tried, so it runs once and a failure shows the screen. */
  const [automaticTried, setAutomaticTried] = useState(false);
  const automaticStarted = useRef(false);
  /** Whether the offered presets were read, or could not be: the automatic create waits for it. */
  const [presetsRead, setPresetsRead] = useState(false);
  const [state, setState] = useState<WorkspaceState>({ kind: "loading" });
  const [presets, setPresets] = useState<readonly WorkspaceSetupPreset[]>(workspaceSetupPresets);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    client.call("GET /v1/workspaces/{workspaceId}", { path: { workspaceId } }).then(
      (workspace) => {
        if (!current) return;
        setState({ kind: "ready", workspace });
        onWorkspace(workspace);
      },
      (error: unknown) => {
        if (!current) return;
        if (error instanceof ApiRequestError && error.status === 404) setState({ kind: "missing" });
        else setState({ kind: "failed", message: describeError(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [client, onWorkspace, workspaceId]);

  // Only the presets whose two models the service routes and the plan's model tiers allow (#2864);
  // all of them when the service cannot say. Owner-token mode has no plan, so its read fails.
  useEffect(() => {
    if (state.kind !== "missing") return;
    let current = true;
    const planTiers = client.call("GET /v1/organisation/credits", {}).then(
      (credits): readonly string[] | undefined => credits.entitlements.modelTiers,
      () => undefined,
    );
    Promise.all([client.call("GET /v1/model-catalog", {}), planTiers]).then(
      ([catalog, tiers]) => {
        if (!current) return;
        const routable = routablePresets(workspaceSetupPresets(), catalog.models);
        const allowed = presetsWithinTiers(routable, tiers);
        const offered =
          allowed.length > 0 ? allowed : routable.length > 0 ? routable : workspaceSetupPresets();
        setPresets(offered);
        setPresetsRead(true);
      },
      () => {
        if (current) setPresetsRead(true);
      },
    );
    return () => {
      current = false;
    };
  }, [client, state.kind]);

  // A one-person plan has nothing to name or choose: create the workspace with what the setup
  // screen would propose, once. Settings changes it later; a failure shows the screen instead.
  useEffect(() => {
    if (!automatic || state.kind !== "missing" || !presetsRead || automaticStarted.current) return;
    automaticStarted.current = true;
    const choice = defaultSetupChoice(presets, proposedCvLanguage(locale));
    if (choice === undefined) {
      setAutomaticTried(true);
      return;
    }
    void createWorkspace(client, workspaceId, choice, {
      onCreated: (workspace) => {
        setState({ kind: "ready", workspace });
        onWorkspace(workspace);
      },
      onProblem: setProblem,
      onBusy: setBusy,
    }).finally(() => setAutomaticTried(true));
  }, [automatic, client, locale, onWorkspace, presets, presetsRead, state.kind, workspaceId]);

  function create(choice: WorkspaceSetupChoice) {
    return createWorkspace(client, workspaceId, choice, {
      onCreated: (workspace) => {
        setState({ kind: "ready", workspace });
        onWorkspace(workspace);
      },
      onProblem: setProblem,
      onBusy: setBusy,
    });
  }

  return (
    <WorkspaceStepView
      state={state.kind === "missing" && automatic && !automaticTried ? { kind: "loading" } : state}
      presets={presets}
      busy={busy}
      problem={problem}
      onCreate={(choice) => void create(choice)}
    />
  );
}

/** Creates the record's workspace with a setup choice, reporting the outcome through `on`. */
async function createWorkspace(
  client: ApiClient,
  workspaceId: string,
  choice: WorkspaceSetupChoice,
  on: {
    readonly onCreated: (workspace: Workspace) => void;
    readonly onProblem: (problem: string | null) => void;
    readonly onBusy: (busy: boolean) => void;
  },
): Promise<void> {
  on.onProblem(null);
  on.onBusy(true);
  try {
    const workspace = await client.call("PUT /v1/workspaces/{workspaceId}", {
      path: { workspaceId },
      body: setupRequestBody(choice),
    });
    on.onCreated(workspace);
  } catch (error) {
    on.onProblem(describeStartError(error));
  } finally {
    on.onBusy(false);
  }
}

export interface WorkspaceStepViewProps {
  readonly state: WorkspaceState;
  readonly presets: readonly WorkspaceSetupPreset[];
  readonly busy: boolean;
  readonly problem: string | null;
  readonly onCreate: (choice: WorkspaceSetupChoice) => void;
}

/** What the first run shows: the shared setup screen while the record has no workspace yet. */
export function WorkspaceStepView({
  state,
  presets,
  busy,
  problem,
  onCreate,
}: WorkspaceStepViewProps) {
  switch (state.kind) {
    case "loading":
      return <p role="status">{t`Opening your documents…`}</p>;
    case "failed":
      return (
        <p className="problem" role="alert">
          {state.message}
        </p>
      );
    case "ready":
      // The record opens on the shared screens as soon as its workspace is read.
      return null;
    case "missing":
      return (
        <div className="shared-screens">
          <WorkspaceSetupScreen
            presets={presets}
            busy={busy}
            problem={problem}
            onCreate={onCreate}
          />
        </div>
      );
  }
}
