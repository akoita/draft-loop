import { contextBridge, ipcRenderer } from "electron";
import type { BridgeCommand, BridgeResult, NativeBridge } from "../bridge.js";
import { bridgeCapabilities } from "../bridge-capabilities.js";

const bridgeChannel = "draft-loop:bridge";
const exposedCapabilities = Object.freeze([...bridgeCapabilities]);

const nativeBridge: NativeBridge = Object.freeze({
  capabilities: exposedCapabilities,
  invoke: (command: BridgeCommand): Promise<BridgeResult<unknown>> =>
    ipcRenderer.invoke(bridgeChannel, command) as Promise<BridgeResult<unknown>>,
});

contextBridge.exposeInMainWorld("__DRAFT_LOOP_NATIVE_BRIDGE__", nativeBridge);
