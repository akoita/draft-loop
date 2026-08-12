import { join } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type OpenDialogOptions,
  safeStorage,
  session,
} from "electron";

import { createNativeHost, createSafeStorageCredentialStore } from "./host.js";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const bridgeChannel = "draft-loop:bridge";
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
    title: "Select local evidence",
  });
  return result.canceled ? [] : result.filePaths;
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1024,
    minHeight: 720,
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
  const host = createNativeHost({
    dialogs: { chooseDirectory, chooseFiles },
    credentials: createSafeStorageCredentialStore({
      safeStorage,
      filename: join(app.getPath("userData"), "credentials.json"),
      // The renderer cannot send secrets. A future app-owned credential prompt
      // can provide this callback without changing the bridge contract.
      readSecret: async () => undefined,
    }),
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
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
