import { join } from "node:path";

import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  screen,
  session,
  shell,
} from "electron";

import { askWhereToSave } from "./downloads.js";
import type { NavigationScope } from "./navigation.js";
import { partitionFor } from "./partition.js";
import { pickerChannels } from "./picker-contract.js";
import { createPickerService } from "./picker-service.js";
import { type CheckFetch, checkServer, type ServerCheck } from "./server-check.js";
import { createServerListStore } from "./servers.js";
import { denyPermissions, guardContents } from "./window-security.js";
import {
  createWindowStateStore,
  defaultWindowBounds,
  minimumWindowHeight,
  minimumWindowWidth,
  restoreWindowBounds,
} from "./window-state.js";

declare const PICKER_VITE_DEV_SERVER_URL: string | undefined;
declare const PICKER_VITE_NAME: string;

/** Paint the window in the screens' own ground so launch does not flash. */
const windowGround = "#0f1319";
/** The client has one window at a time: the picker or one server's screen. */
let currentWindow: BrowserWindow | undefined;
const configuredSessions = new Set<string>();

function openExternal(url: string): void {
  void shell.openExternal(url);
}

function configureSession(partition: string): Electron.Session {
  const serverSession = session.fromPartition(partition);
  if (configuredSessions.has(partition)) return serverSession;
  configuredSessions.add(partition);
  denyPermissions(serverSession);
  serverSession.on("will-download", (_event, item) =>
    askWhereToSave(item, app.getPath("downloads")),
  );
  return serverSession;
}

/** A window at the remembered size, replacing the current one. */
function createWindow(webPreferences: Electron.WebPreferences): BrowserWindow {
  const windowState = createWindowStateStore(app.getPath("userData"));
  const restored = restoreWindowBounds(
    windowState.read(),
    screen.getAllDisplays().map((display) => display.workArea),
  );
  const bounds = restored ?? defaultWindowBounds(screen.getPrimaryDisplay().workArea);
  const window = new BrowserWindow({
    ...bounds,
    minWidth: minimumWindowWidth,
    minHeight: minimumWindowHeight,
    backgroundColor: windowGround,
    title: "DraftLoop",
    webPreferences: {
      ...webPreferences,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  if (restored?.maximized === true) window.maximize();
  const rememberBounds = () => {
    if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
    windowState.write({ ...window.getNormalBounds(), maximized: window.isMaximized() });
  };
  let rememberTimer: NodeJS.Timeout | undefined;
  const rememberSoon = () => {
    clearTimeout(rememberTimer);
    rememberTimer = setTimeout(rememberBounds, 400);
  };
  window.on("resize", rememberSoon);
  window.on("move", rememberSoon);
  window.on("maximize", rememberSoon);
  window.on("unmaximize", rememberSoon);
  window.on("close", rememberBounds);
  const previous = currentWindow;
  currentWindow = window;
  previous?.destroy();
  return window;
}

function pickerUrl(): string {
  return typeof PICKER_VITE_DEV_SERVER_URL === "string"
    ? PICKER_VITE_DEV_SERVER_URL
    : new URL(`file://${join(__dirname, `../renderer/${PICKER_VITE_NAME}/index.html`)}`).href;
}

function isPickerFrame(frame: Electron.WebFrameMain | null): boolean {
  if (frame === null) return false;
  const page = new URL(pickerUrl());
  const sender = new URL(frame.url);
  return sender.origin === page.origin && sender.pathname === page.pathname;
}

function openPicker(): void {
  const window = createWindow({ preload: join(__dirname, "picker-preload.js") });
  // The picker never navigates: links and redirects go nowhere, new windows never open.
  guardContents(window.webContents, () => ({ serverOrigin: "null" }), openExternal);
  void window.loadURL(pickerUrl());
}

/** Opens one server's own web screen, in its own storage partition. */
function openServer(origin: string, check: ServerCheck & { reachable: true }): void {
  const partition = partitionFor(origin);
  configureSession(partition);
  const window = createWindow({ partition, preload: join(__dirname, "preload.js") });
  const scope: NavigationScope = {
    serverOrigin: origin,
    issuerOrigin: check.signIn === "oidc" ? check.issuerOrigin : undefined,
  };
  guardContents(window.webContents, () => scope, openExternal);
  window.webContents.on("did-fail-load", (_event, errorCode, description, url, isMainFrame) => {
    // -3 is an aborted load, such as a navigation the guard stopped.
    if (!isMainFrame || errorCode === -3 || new URL(url).origin !== origin) return;
    picker.setUnreachable(origin, `The page did not load (${description}).`);
    openPicker();
  });
  void window.loadURL(`${origin}/`);
}

const fetchForCheck: CheckFetch = (url, init) => fetch(url, init);
const store = () => createServerListStore(app.getPath("userData"));
const picker = createPickerService({
  get store() {
    return store();
  },
  check: (origin) => checkServer(origin, fetchForCheck),
  openServer,
  async clearServerData(origin) {
    const serverSession = session.fromPartition(partitionFor(origin));
    await serverSession.clearStorageData();
    await serverSession.clearCache();
  },
});

/** At launch: the last server when it answers, otherwise the picker saying why. */
async function openAtLaunch(): Promise<void> {
  const selected = store().read().selected;
  if (selected === undefined) {
    openPicker();
    return;
  }
  const result = await picker.open(selected);
  if (!result.ok) openPicker();
}

function buildMenu(): void {
  const serverMenu: MenuItemConstructorOptions = {
    label: "Server",
    submenu: [
      { label: "Switch server…", accelerator: "CmdOrCtrl+Shift+S", click: () => openPicker() },
      { type: "separator" },
      { role: "reload" },
    ],
  };
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [{ role: "appMenu" } as const]
      : [{ role: "fileMenu" } as const]),
    serverMenu,
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools" } as const]),
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerPickerChannels(): void {
  ipcMain.handle(pickerChannels.view, (event) => {
    if (!isPickerFrame(event.senderFrame)) throw new Error("Refused: not the picker page.");
    return picker.view();
  });
  ipcMain.handle(pickerChannels.open, (event, address: unknown, name: unknown) => {
    if (!isPickerFrame(event.senderFrame)) throw new Error("Refused: not the picker page.");
    if (typeof address !== "string") return { ok: false, reason: "Enter the server's address." };
    return picker.open(address, typeof name === "string" ? name : undefined);
  });
  ipcMain.handle(pickerChannels.remove, (event, origin: unknown) => {
    if (!isPickerFrame(event.senderFrame)) throw new Error("Refused: not the picker page.");
    return typeof origin === "string" ? picker.remove(origin) : picker.view();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (currentWindow === undefined || currentWindow.isDestroyed()) return;
    if (currentWindow.isMinimized()) currentWindow.restore();
    currentWindow.focus();
  });
  app.on("web-contents-created", (_event, contents) => {
    // No webview tags: a server page can never embed another privileged surface.
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
  app.whenReady().then(() => {
    buildMenu();
    registerPickerChannels();
    void openAtLaunch();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void openAtLaunch();
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
