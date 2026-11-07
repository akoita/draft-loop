import type { HostPanels } from "@draft-loop/ui/host-panels";

import type { ApiClient, ApiSchemas } from "./api-client.js";
import { ApplicationMaterialSection } from "./application-material.js";
import { CodingAgentsSection } from "./coding-agents.js";
import { EvidenceSections, StoragePermissionPanel } from "./evidence-panels.js";
import { HomeWorkJournal } from "./home-work-journal.js";
import { PreferenceSuggestionsSection } from "./preference-suggestions.js";
import { StartPanel } from "./start-panels.js";

/**
 * What the web adds to the shared screens. In sign-in mode, where the server enforces consent and
 * credits, the storage permission above the Career evidence and the consent and credit cost in
 * the Start dialog; in both modes the evidence page's file checks and private-section rules; with
 * the owner token, the work journal review (#2024) and its waiting notes on Home (#2151); on
 * every application, the prepare panel for a cover letter or interview questions (#2217); and
 * the writing preferences suggested from review choices and Agents (#2439) in Workspace
 * settings.
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
    workspaceSettings: () => (
      <>
        <PreferenceSuggestionsSection client={client} />
        <CodingAgentsSection client={client} mode={mode} />
      </>
    ),
    application: ({ applicationId }) => (
      <ApplicationMaterialSection client={client} applicationId={applicationId} />
    ),
    evidenceAfter: ({ revision, openHome }) => (
      <EvidenceSections
        client={client}
        revision={revision}
        workJournal={mode === "owner"}
        openHome={openHome}
      />
    ),
    ...(mode === "owner"
      ? {
          homeEvidence: ({ openEvidence }) => (
            <HomeWorkJournal client={client} openEvidence={openEvidence} />
          ),
        }
      : {}),
  };
}
