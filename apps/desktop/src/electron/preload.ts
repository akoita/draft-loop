import type { BridgeCommand, BridgeResult, NativeBridge } from "@draft-loop/ui/bridge";
import { bridgeCapabilities } from "@draft-loop/ui/bridge-capabilities";
import { contextBridge, ipcRenderer } from "electron";

const bridgeChannel = "draft-loop:bridge";
const exposedCapabilities = Object.freeze([...bridgeCapabilities]);

const nativeBridge: NativeBridge = Object.freeze({
  capabilities: exposedCapabilities,
  invoke: (command: BridgeCommand): Promise<BridgeResult<unknown>> =>
    ipcRenderer.invoke(bridgeChannel, command) as Promise<BridgeResult<unknown>>,
});

contextBridge.exposeInMainWorld("__DRAFT_LOOP_NATIVE_BRIDGE__", nativeBridge);
