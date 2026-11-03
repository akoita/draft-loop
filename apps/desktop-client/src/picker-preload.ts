import { contextBridge, ipcRenderer } from "electron";

import { type PickerApi, pickerChannels } from "./picker-contract.js";

/** The picker page's only bridge: three calls, each checked again by the main process. */
const api: PickerApi = {
  view: () => ipcRenderer.invoke(pickerChannels.view),
  open: (address, name) => ipcRenderer.invoke(pickerChannels.open, address, name),
  remove: (origin) => ipcRenderer.invoke(pickerChannels.remove, origin),
};

contextBridge.exposeInMainWorld("draftLoopPicker", Object.freeze(api));
