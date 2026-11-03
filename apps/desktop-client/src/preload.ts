import { contextBridge, ipcRenderer } from "electron";

import { signInChannels } from "./sign-in-contract.js";

/**
 * What a server page learns from the client: that it runs in the desktop app, and a sign-in it
 * may remember on this computer. The preload is sandboxed and exposes no Node or Electron API;
 * the main process answers only the window's own server (ADR 0011, D9).
 */
const rememberedToken: unknown = ipcRenderer.sendSync(signInChannels.read);

contextBridge.exposeInMainWorld(
  "draftLoopDesktop",
  Object.freeze({
    host: "desktop",
    signIn: Object.freeze({
      rememberedToken: typeof rememberedToken === "string" ? rememberedToken : null,
      remember: (token: unknown) => {
        if (typeof token === "string") ipcRenderer.send(signInChannels.remember, token);
      },
      forget: () => ipcRenderer.send(signInChannels.forget),
    }),
  }),
);
