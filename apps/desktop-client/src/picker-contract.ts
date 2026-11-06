/** What the server picker page and the main process exchange over IPC. */

import type { ShellLanguage } from "./shell-text.js";

export const pickerChannels = {
  view: "draft-loop:picker:view",
  open: "draft-loop:picker:open",
  remove: "draft-loop:picker:remove",
} as const;

export interface PickerServer {
  readonly origin: string;
  readonly name: string;
}

export interface PickerView {
  readonly servers: readonly PickerServer[];
  /** The server that could not be opened, and why, when the picker opened because of it. */
  readonly unreachable?: { readonly origin: string; readonly reason: string } | undefined;
  /** The language the picker writes in (#2329); English when left out. */
  readonly language?: ShellLanguage;
}

export type PickerOpenResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** The page's view of the main process: `window.draftLoopPicker`. */
export interface PickerApi {
  view(): Promise<PickerView>;
  /** Checks a typed or saved address, saves it and opens it. */
  open(address: string, name?: string): Promise<PickerOpenResult>;
  /** Forgets a server and clears everything its pages stored on this computer. */
  remove(origin: string): Promise<PickerView>;
}
