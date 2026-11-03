import { contextBridge } from "electron";

/**
 * The only thing a server page learns from the client: that it runs in the desktop app. The
 * preload is sandboxed and exposes no Node or Electron API (ADR 0011, D9).
 */
contextBridge.exposeInMainWorld("draftLoopDesktop", Object.freeze({ host: "desktop" }));
