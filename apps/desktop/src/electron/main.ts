import { dirname, join, resolve } from "node:path";
import { resolveProviderAuthModes } from "@draft-loop/application";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type OpenDialogOptions,
  safeStorage,
  session,
} from "electron";
import { supportedFileExtensions } from "../bridge.js";
import { type PackagedAcceptancePhase, runPackagedAcceptance } from "./acceptance.js";
import {
  type CredentialAcceptancePhase,
  runCredentialAcceptance,
} from "./credential-acceptance.js";
import { chooseMarkdownExportPath } from "./dialogs.js";
import { createNativeHost, createSafeStorageCredentialStore } from "./host.js";
import { type LiveProviderE2EOptions, runLiveProviderE2E } from "./live-e2e.js";
import { type PackagedSmokePhase, runPackagedSmoke } from "./smoke.js";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const bridgeChannel = "draft-loop:bridge";

/** Paint the window in the renderer's own ground so launch does not flash. */
const windowGround = "#0f1319";
let mainWindow: BrowserWindow | undefined;

function rendererUrl(): string | undefined {
  return typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === "undefined"
    ? undefined
    : MAIN_WINDOW_VITE_DEV_SERVER_URL;
}

async function chooseDirectory(mode: "open" | "create"): Promise<string | undefined> {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"] as const,
    title:
      mode === "create" ? "Choose a parent folder for the workspace" : "Open DraftLoop workspace",
  });
  return result.canceled ? undefined : result.filePaths[0];
}

async function chooseFiles(input: {
  readonly extensions?: readonly string[];
  readonly multiple?: boolean;
  readonly title?: string;
}) {
  const properties: OpenDialogOptions["properties"] =
    input.multiple === false ? ["openFile"] : ["openFile", "multiSelections"];
  const result = await dialog.showOpenDialog({
    properties,
    ...(input.extensions === undefined
      ? {}
      : {
          filters: [
            {
              name: "DraftLoop evidence",
              extensions: input.extensions.map((extension) => extension.slice(1)),
            },
          ],
        }),
    title: input.title ?? "Select local evidence",
  });
  return result.canceled ? [] : result.filePaths;
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: windowGround,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  const developmentUrl = rendererUrl();
  if (developmentUrl !== undefined) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });
  mainWindow = window;
  return window;
}

app.whenReady().then(() => {
  const providerAuthModeConfiguration = resolveProviderAuthModes(
    process.env.DRAFT_LOOP_PROVIDER_AUTH_MODE,
    process.env.DRAFT_LOOP_ANTHROPIC_AUTH_MODE,
    process.env.DRAFT_LOOP_OPENAI_AUTH_MODE,
  );
  const acceptanceEnabled = process.env.DRAFT_LOOP_ACCEPTANCE === "1";
  const acceptanceRoot = process.env.DRAFT_LOOP_ACCEPTANCE_WORKSPACE;
  const acceptanceCandidate = process.env.DRAFT_LOOP_ACCEPTANCE_CANDIDATE;
  const acceptanceEvidence = process.env.DRAFT_LOOP_ACCEPTANCE_EVIDENCE;
  const acceptancePhase = process.env.DRAFT_LOOP_ACCEPTANCE_PHASE;
  const acceptanceArtifactChecksum = process.env.DRAFT_LOOP_ACCEPTANCE_ARTIFACT_SHA256;
  const acceptanceJobUrl = process.env.DRAFT_LOOP_ACCEPTANCE_JOB_URL;
  const credentialAcceptanceEnabled = process.env.DRAFT_LOOP_CREDENTIAL_ACCEPTANCE === "1";
  const credentialAcceptanceStore = process.env.DRAFT_LOOP_CREDENTIAL_ACCEPTANCE_STORE;
  const smokeEnabled = process.env.DRAFT_LOOP_SMOKE === "1";
  const smokeRoot = process.env.DRAFT_LOOP_SMOKE_WORKSPACE;
  const smokePhase = process.env.DRAFT_LOOP_SMOKE_PHASE;
  const liveE2eEnabled = process.env.DRAFT_LOOP_LIVE_E2E === "1";
  const liveE2eRoot = process.env.DRAFT_LOOP_LIVE_E2E_WORKSPACE;
  const liveE2eJob = process.env.DRAFT_LOOP_LIVE_E2E_JOB;
  const liveE2eCandidate = process.env.DRAFT_LOOP_LIVE_E2E_CANDIDATE;
  const liveE2eEvidence = process.env.DRAFT_LOOP_LIVE_E2E_EVIDENCE;
  const liveE2eAuthorModel = process.env.DRAFT_LOOP_LIVE_E2E_AUTHOR_MODEL?.trim();
  const liveE2eCriticModel = process.env.DRAFT_LOOP_LIVE_E2E_CRITIC_MODEL?.trim();
  if (liveE2eEnabled && (acceptanceEnabled || smokeEnabled || credentialAcceptanceEnabled)) {
    throw new Error("Desktop live E2E cannot run with another desktop test mode.");
  }
  if (acceptanceEnabled && (smokeEnabled || credentialAcceptanceEnabled)) {
    throw new Error("Packaged acceptance cannot run with another packaged test mode.");
  }
  if (acceptanceEnabled) {
    if (
      acceptanceRoot === undefined ||
      acceptanceCandidate === undefined ||
      acceptanceEvidence === undefined ||
      acceptanceArtifactChecksum === undefined ||
      acceptanceJobUrl === undefined ||
      (acceptancePhase !== "prepare" && acceptancePhase !== "resume")
    ) {
      throw new Error("Packaged installed-app acceptance configuration is incomplete.");
    }
  }
  if (smokeEnabled && (smokeRoot === undefined || smokePhase === undefined)) {
    throw new Error(
      "Packaged smoke requires DRAFT_LOOP_SMOKE_WORKSPACE and DRAFT_LOOP_SMOKE_PHASE.",
    );
  }
  if (smokeEnabled && smokePhase !== "prepare" && smokePhase !== "resume") {
    throw new Error(`Unsupported packaged smoke phase: ${smokePhase}`);
  }
  if (
    liveE2eEnabled &&
    (liveE2eRoot === undefined ||
      liveE2eJob === undefined ||
      liveE2eCandidate === undefined ||
      liveE2eEvidence === undefined)
  ) {
    throw new Error(
      "Desktop live E2E requires DRAFT_LOOP_LIVE_E2E_WORKSPACE, DRAFT_LOOP_LIVE_E2E_JOB, DRAFT_LOOP_LIVE_E2E_CANDIDATE, and DRAFT_LOOP_LIVE_E2E_EVIDENCE.",
    );
  }
  const smokeWorkspace = smokeRoot === undefined ? undefined : resolve(smokeRoot);
  const acceptanceWorkspace = acceptanceRoot === undefined ? undefined : resolve(acceptanceRoot);
  const liveE2eWorkspace = liveE2eRoot === undefined ? undefined : resolve(liveE2eRoot);
  const liveE2eJobPath = liveE2eJob === undefined ? undefined : resolve(liveE2eJob);
  const liveE2eCandidatePath =
    liveE2eCandidate === undefined ? undefined : resolve(liveE2eCandidate);
  const liveE2eEvidencePath = liveE2eEvidence === undefined ? undefined : resolve(liveE2eEvidence);
  const credentialStore = createSafeStorageCredentialStore({
    safeStorage,
    filename:
      credentialAcceptanceEnabled && credentialAcceptanceStore !== undefined
        ? resolve(credentialAcceptanceStore)
        : join(app.getPath("userData"), "credentials.json"),
  });
  if (credentialAcceptanceEnabled) {
    const phase = process.env.DRAFT_LOOP_CREDENTIAL_ACCEPTANCE_PHASE;
    const evidencePath = process.env.DRAFT_LOOP_CREDENTIAL_ACCEPTANCE_EVIDENCE;
    const anthropicInitial = process.env.DRAFT_LOOP_CREDENTIAL_ACCEPTANCE_ANTHROPIC_INITIAL;
    const anthropicReplacement = process.env.DRAFT_LOOP_CREDENTIAL_ACCEPTANCE_ANTHROPIC_REPLACEMENT;
    const anthropicEnvironment = process.env.DRAFT_LOOP_CREDENTIAL_ACCEPTANCE_ANTHROPIC_ENVIRONMENT;
    const openaiInitial = process.env.DRAFT_LOOP_CREDENTIAL_ACCEPTANCE_OPENAI_INITIAL;
    const openaiReplacement = process.env.DRAFT_LOOP_CREDENTIAL_ACCEPTANCE_OPENAI_REPLACEMENT;
    const openaiEnvironment = process.env.DRAFT_LOOP_CREDENTIAL_ACCEPTANCE_OPENAI_ENVIRONMENT;
    if (
      (phase !== "prepare" && phase !== "verify") ||
      evidencePath === undefined ||
      credentialAcceptanceStore === undefined ||
      anthropicInitial === undefined ||
      anthropicReplacement === undefined ||
      anthropicEnvironment === undefined ||
      openaiInitial === undefined ||
      openaiReplacement === undefined ||
      openaiEnvironment === undefined
    ) {
      throw new Error("Packaged credential acceptance configuration is incomplete.");
    }
    let safeStorageAvailable = false;
    let selectedStorageBackend: string | null = null;
    try {
      safeStorageAvailable = safeStorage.isEncryptionAvailable();
      selectedStorageBackend = safeStorage.getSelectedStorageBackend?.() ?? null;
    } catch {
      selectedStorageBackend = null;
    }
    void runCredentialAcceptance({
      store: credentialStore,
      phase: phase as CredentialAcceptancePhase,
      evidencePath: resolve(evidencePath),
      appVersion: app.getVersion(),
      safeStorageAvailable,
      selectedStorageBackend,
      credentials: {
        anthropic: {
          initial: anthropicInitial,
          replacement: anthropicReplacement,
          environment: anthropicEnvironment,
        },
        openai: {
          initial: openaiInitial,
          replacement: openaiReplacement,
          environment: openaiEnvironment,
        },
      },
    })
      .then(() => app.exit(0))
      .catch(() => {
        console.error("Packaged credential acceptance failed.");
        app.exit(1);
      });
    return;
  }
  const acceptanceUrlFetcher = async (input: string): Promise<Response> => {
    if (input !== acceptanceJobUrl) throw new Error("Unexpected URL in packaged acceptance.");
    return new Response(
      "<!doctype html><html><head><title>TypeScript Systems Engineer</title></head><body><h1>TypeScript Systems Engineer</h1><p>Build reliable local-first developer tools with TypeScript, testing, and evidence-backed documentation.</p></body></html>",
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  };
  const acceptanceUrlHostnameResolver = async (): Promise<readonly string[]> => ["93.184.216.34"];
  const host = createNativeHost({
    providerAuthModeConfiguration,
    dialogs:
      acceptanceEnabled && acceptanceWorkspace !== undefined && acceptanceCandidate !== undefined
        ? {
            chooseDirectory: async (mode) =>
              mode === "create" ? dirname(acceptanceWorkspace) : acceptanceWorkspace,
            chooseFiles: async (input) =>
              input.target === "evidence" ? [acceptanceCandidate] : [],
          }
        : smokeEnabled && smokeWorkspace !== undefined
          ? {
              chooseDirectory: async (mode) =>
                mode === "create" ? dirname(smokeWorkspace) : smokeWorkspace,
              chooseFiles: async () => [],
            }
          : liveE2eEnabled &&
              liveE2eWorkspace !== undefined &&
              liveE2eJobPath !== undefined &&
              liveE2eCandidatePath !== undefined
            ? {
                chooseDirectory: async (mode) =>
                  mode === "create" ? dirname(liveE2eWorkspace) : liveE2eWorkspace,
                chooseFiles: async (input) =>
                  input.target === "job-description" ? [liveE2eJobPath] : [liveE2eCandidatePath],
                chooseMarkdownExportPath: async () =>
                  join(liveE2eWorkspace, "exports", "live-e2e.md"),
              }
            : {
                chooseDirectory,
                chooseFiles,
                chooseKnowledgeSourceFile: async () =>
                  (
                    await chooseFiles({
                      extensions: supportedFileExtensions,
                      multiple: false,
                      title: "Add file to candidate knowledge base",
                    })
                  )[0],
                chooseMarkdownExportPath: (defaultPath) =>
                  chooseMarkdownExportPath(mainWindow, defaultPath, dialog),
              },
    credentials: credentialStore,
    ...(acceptanceEnabled
      ? {
          requireProviderPreflight: true,
          urlFetcher: acceptanceUrlFetcher,
          urlHostnameResolver: acceptanceUrlHostnameResolver,
        }
      : {}),
    ...(smokeEnabled || (!app.isPackaged && !liveE2eEnabled)
      ? {
          onError: (error: unknown, capability: string) => {
            console.error(
              `desktop host error (${capability}):`,
              error instanceof Error ? (error.stack ?? error.message) : error,
            );
          },
        }
      : {}),
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  if (smokeEnabled && smokeWorkspace !== undefined && smokePhase !== undefined) {
    void runPackagedSmoke({
      host,
      phase: smokePhase as PackagedSmokePhase,
      workspaceRoot: smokeWorkspace,
    })
      .then(() => app.exit(0))
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : "Packaged smoke failed.");
        app.exit(1);
      });
    return;
  }
  if (
    liveE2eEnabled &&
    liveE2eWorkspace !== undefined &&
    liveE2eJobPath !== undefined &&
    liveE2eCandidatePath !== undefined &&
    liveE2eEvidencePath !== undefined
  ) {
    const liveOptions: LiveProviderE2EOptions = {
      host,
      workspaceRoot: liveE2eWorkspace,
      jobPath: liveE2eJobPath,
      candidatePath: liveE2eCandidatePath,
      evidencePath: liveE2eEvidencePath,
      providerAuthModeConfiguration,
      ...(liveE2eAuthorModel === undefined || liveE2eAuthorModel === ""
        ? {}
        : { authorModel: liveE2eAuthorModel }),
      ...(liveE2eCriticModel === undefined || liveE2eCriticModel === ""
        ? {}
        : { criticModel: liveE2eCriticModel }),
    };
    void runLiveProviderE2E(liveOptions)
      .then(() => app.exit(0))
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : "Desktop live E2E failed.");
        app.exit(1);
      });
    return;
  }
  if (
    acceptanceEnabled &&
    acceptanceWorkspace !== undefined &&
    acceptanceCandidate !== undefined &&
    acceptanceEvidence !== undefined &&
    acceptanceArtifactChecksum !== undefined &&
    acceptanceJobUrl !== undefined &&
    (acceptancePhase === "prepare" || acceptancePhase === "resume")
  ) {
    void runPackagedAcceptance({
      host,
      phase: acceptancePhase as PackagedAcceptancePhase,
      workspaceRoot: acceptanceWorkspace,
      candidatePath: resolve(acceptanceCandidate),
      evidencePath: resolve(acceptanceEvidence),
      appVersion: app.getVersion(),
      artifactChecksum: acceptanceArtifactChecksum,
      jobUrl: acceptanceJobUrl,
    })
      .then(() => app.exit(0))
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : "Packaged acceptance failed.");
        app.exit(1);
      });
    return;
  }
  ipcMain.handle(bridgeChannel, async (event, command: unknown) => {
    if (mainWindow === undefined || event.sender !== mainWindow.webContents) {
      return {
        ok: false,
        error: { code: "permission-denied", message: "The desktop host denied this operation." },
      };
    }
    return host.invoke(command);
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
