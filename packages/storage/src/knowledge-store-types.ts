export type ManagedCandidateKnowledgeWriteInterruptionBoundary =
  | "intent"
  | "staging"
  | "target-intent"
  | "target-publication"
  | "published-event"
  | "commit"
  | "staging-cleanup"
  | "after-staging-cleanup";

export interface ManagedCandidateKnowledgeFileInventory {
  readonly schemaVersion: 1;
  readonly verifiedManagedFileCount: number;
  readonly scannedEntryCount: number;
  readonly unknownEntries: {
    readonly intakeShapedFilesAtSourcesRoot: number;
    readonly opaqueEntriesAtSourcesRoot: number;
    readonly entriesInsideManagedSourceDirectories: number;
    readonly symbolicLinks: number;
    readonly otherEntries: number;
  };
  readonly complete: boolean;
  readonly scanLimitReached: boolean;
}
