import { plural } from "@lingui/core/macro";
import { useCallback, useEffect, useState } from "react";

import type { ApiClient, ApiSchemas } from "./api-client.js";
import { PrivateSections } from "./private-sections.js";
import { useRecordId } from "./record-context.js";
import { activeBases } from "./sources-model.js";

type KnowledgeBase = ApiSchemas["KnowledgeBase"];

/** The folded line's text for the rules in force: nothing while every section can be used. */
export function privateRulesNote(counts: Readonly<Record<string, number>>): string | null {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;
  return plural(total, { one: "# private-section rule", other: "# private-section rules" });
}

/** The workspace's selected knowledge bases, read again when the page changes the selection. */
function useSelectedBaseList(
  client: ApiClient,
  revision: number,
): readonly KnowledgeBase[] | undefined {
  const workspaceId = useRecordId();
  const [bases, setBases] = useState<readonly KnowledgeBase[] | undefined>(undefined);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` re-reads the bases after the shared page changes the selection.
  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const [workspace, { knowledgeBases }] = await Promise.all([
          client.call("GET /v1/workspaces/{workspaceId}", { path: { workspaceId } }),
          client.call("GET /v1/knowledge-bases", { query: { workspaceId } }),
        ]);
        if (!current) return;
        setBases(
          activeBases(knowledgeBases).filter((base) =>
            workspace.knowledgeBaseIds.includes(base.id),
          ),
        );
      } catch {
        // The files panel below reports the same failed reading; here the rules stay on "reading".
      }
    })();
    return () => {
      current = false;
    };
  }, [client, workspaceId, revision]);

  return bases;
}

export interface EvidenceAdvancedProps {
  readonly client: ApiClient;
  /** Changes when the shared page changes the knowledge selection or adds files. */
  readonly revision: number;
  /** Puts the number of rules in force on the folded Advanced options line. */
  readonly setNote: (note: string | null) => void;
}

/** What the web adds to the Career evidence card's Advanced options: the private-section rules. */
export function EvidenceAdvanced({ client, revision, setNote }: EvidenceAdvancedProps) {
  const bases = useSelectedBaseList(client, revision);
  const [counts, setCounts] = useState<Readonly<Record<string, number>>>({});
  const onCount = useCallback((knowledgeBaseId: string, count: number) => {
    setCounts((current) =>
      current[knowledgeBaseId] === count ? current : { ...current, [knowledgeBaseId]: count },
    );
  }, []);
  const selected = bases?.map((base) => base.id).join(" ") ?? "";
  const note = privateRulesNote(
    Object.fromEntries(Object.entries(counts).filter(([id]) => selected.split(" ").includes(id))),
  );
  useEffect(() => {
    setNote(note);
  }, [note, setNote]);

  return <PrivateSections client={client} bases={bases} onCount={onCount} />;
}
