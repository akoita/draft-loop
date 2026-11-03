import { join } from "node:path";

import { app, BrowserWindow, screen, session, shell } from "electron";

import { askWhereToSave } from "./downloads.js";
import type { NavigationScope } from "./navigation.js";
import { partitionFor } from "./partition.js";
import { thisComputerOrigin } from "./server-address.js";
import { createServerListStore } from "./servers.js";
import { denyPermissions, guardContents } from "./window-security.js";
import {
  createWindowStateStore,
  defaultWindowBounds,
  minimumWindowHeight,
  minimumWindowWidth,
  restoreWindowBounds,
} from "./window-state.js";

/** Paint the window in the screens' own ground so launch does not flash. */
const windowGround = "#0f1319";
let serverWindow: BrowserWindow | undefined;
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

/** Opens one server's web screen in the client's window, replacing any other server's window. */
function openServer(origin: string): BrowserWindow {
  const windowState = createWindowStateStore(app.getPath("userData"));
  const restored = restoreWindowBounds(
    windowState.read(),
    screen.getAllDisplays().map((display) => display.workArea),
  );
  const bounds = restored ?? defaultWindowBounds(screen.getPrimaryDisplay().workArea);
  const partition = partitionFor(origin);
  configureSession(partition);
  const window = new BrowserWindow({
    ...bounds,
    minWidth: minimumWindowWidth,
    minHeight: minimumWindowHeight,
    backgroundColor: windowGround,
    title: "DraftLoop",
    webPreferences: {
      partition,
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  const scope: NavigationScope = { serverOrigin: origin };
  guardContents(window.webContents, () => scope, openExternal);
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
  void window.loadURL(`${origin}/`);
  serverWindow?.destroy();
  serverWindow = window;
  return window;
}

function selectedOrigin(): string {
  return createServerListStore(app.getPath("userData")).read().selected ?? thisComputerOrigin;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (serverWindow === undefined || serverWindow.isDestroyed()) return;
    if (serverWindow.isMinimized()) serverWindow.restore();
    serverWindow.focus();
  });
  app.on("web-contents-created", (_event, contents) => {
    // No webview tags: a server page can never embed another privileged surface.
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
  app.whenReady().then(() => {
    openServer(selectedOrigin());
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) openServer(selectedOrigin());
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
