import type { HostPanels } from "@draft-loop/ui/host-panels";

import type { ApiClient, ApiSchemas } from "./api-client.js";
import { EvidenceSections, StoragePermissionPanel } from "./evidence-panels.js";
import { StartPanel } from "./start-panels.js";

/**
 * What the web adds to the shared screens. In sign-in mode, where the server enforces consent and
 * credits, the storage permission above the Career evidence and the consent and credit cost in
 * the Start dialog; in both modes the evidence page's file checks and private-section rules.
 */
export function webHostPanels(
  client: ApiClient,
  mode: "owner" | "sign-in",
  workspace: ApiSchemas["Workspace"] | undefined,
): HostPanels {
  return {
    ...(mode === "sign-in"
      ? {
          evidenceBefore: <StoragePermissionPanel client={client} workspace={workspace} />,
          startDialog: (context) => <StartPanel client={client} {...context} />,
        }
      : {}),
    evidenceAfter: ({ revision }) => <EvidenceSections client={client} revision={revision} />,
  };
}
