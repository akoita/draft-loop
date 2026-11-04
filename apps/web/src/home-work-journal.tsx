import { workJournalFragment, workJournalPanelId } from "@draft-loop/ui/shared-link";
import { pendingNoteCountLimit, WorkJournalPending } from "@draft-loop/ui/work-journal-pending";
import { useEffect, useState } from "react";

import type { ApiClient } from "./api-client.js";
import { useRecordId } from "./record-context.js";

export interface HomeWorkJournalProps {
  readonly client: ApiClient;
  readonly openEvidence: () => void;
}

/**
 * The waiting work journal notes in Home's Career evidence card (#2151). A failed read shows
 * nothing: the Career evidence page reports it beside the notes.
 */
export function HomeWorkJournal({ client, openEvidence }: HomeWorkJournalProps) {
  const workspaceId = useRecordId();
  const [count, setCount] = useState<number | undefined>(undefined);

  useEffect(() => {
    let active = true;
    client
      .call("GET /v1/workspaces/{workspaceId}/work-journal/notes", {
        path: { workspaceId },
        query: { status: "pending", limit: pendingNoteCountLimit },
      })
      .then((listed) => {
        if (active) setCount(listed.notes?.length ?? 0);
      })
      .catch(() => {
        if (active) setCount(undefined);
      });
    return () => {
      active = false;
    };
  }, [client, workspaceId]);

  return (
    <WorkJournalPending
      count={count}
      onOpen={() => {
        // The fragment makes the panel scroll into view once it reads its notes (#2149).
        window.history.replaceState(null, "", workJournalFragment);
        openEvidence();
        window.requestAnimationFrame(() =>
          document.getElementById(workJournalPanelId)?.scrollIntoView?.({ block: "start" }),
        );
      }}
    />
  );
}
