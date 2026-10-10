import {
  type SourceEvidenceKindEntry,
  type SourceEvidenceKindService,
  sourceEvidenceKindService,
} from "@draft-loop/application";

import {
  maximumSourceEvidenceKindDisplayNameLength,
  maximumSourceEvidenceKindEntries,
  type SourceEvidenceKindSetInput,
  type SourceEvidenceKindSetResult,
  type SourceEvidenceKindSummary,
  type SourceEvidenceKindsInput,
  type SourceEvidenceKindsResult,
} from "../source-evidence-kind-contract.js";

export interface SourceEvidenceKindHostDependencies {
  /** Replaces the application evidence-kind service; tests inject a fake. */
  readonly service?: SourceEvidenceKindService;
  /** Resolves an open store's root after checking the knowledge base belongs to it. */
  readonly knowledgeBaseRoot: (storeId: string, knowledgeBaseId: string) => Promise<string>;
}

export interface SourceEvidenceKindHost {
  readonly list: (input: SourceEvidenceKindsInput) => Promise<SourceEvidenceKindsResult>;
  readonly set: (input: SourceEvidenceKindSetInput) => Promise<SourceEvidenceKindSetResult>;
}

/** One line, bounded, so a long file name or URL still crosses the bridge. */
function bridgeDisplayName(entry: SourceEvidenceKindEntry): string {
  const oneLine = entry.displayName.replace(/\s+/gu, " ").trim();
  const characters = [...(oneLine === "" ? entry.sourceId : oneLine)];
  return characters.length <= maximumSourceEvidenceKindDisplayNameLength
    ? characters.join("")
    : `${characters.slice(0, maximumSourceEvidenceKindDisplayNameLength - 1).join("")}…`;
}

function summary(entry: SourceEvidenceKindEntry): SourceEvidenceKindSummary {
  return {
    sourceId: entry.sourceId,
    displayName: bridgeDisplayName(entry),
    kind: entry.kind,
    origin: entry.origin,
  };
}

/** Host side of the evidence-kind commands; it adds store resolution and bounds to the service. */
export function createSourceEvidenceKindHost(
  dependencies: SourceEvidenceKindHostDependencies,
): SourceEvidenceKindHost {
  const service = dependencies.service ?? sourceEvidenceKindService;
  return {
    list: async ({ storeId, knowledgeBaseId }) => {
      const storeRoot = await dependencies.knowledgeBaseRoot(storeId, knowledgeBaseId);
      const entries = await service.listSourceEvidenceKinds({ storeRoot, knowledgeBaseId });
      return {
        storeId,
        knowledgeBaseId,
        sources: entries.slice(0, maximumSourceEvidenceKindEntries).map(summary),
        truncated: entries.length > maximumSourceEvidenceKindEntries,
      };
    },
    set: async ({ storeId, knowledgeBaseId, sourceId, kind }) => {
      const storeRoot = await dependencies.knowledgeBaseRoot(storeId, knowledgeBaseId);
      const entry = await service.setSourceEvidenceKind({
        storeRoot,
        knowledgeBaseId,
        sourceId,
        kind,
      });
      return { storeId, knowledgeBaseId, source: summary(entry) };
    },
  };
}
