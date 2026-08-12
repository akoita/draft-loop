import type { EvidenceReference } from "@draft-loop/evidence";

export interface DraftArtifact {
  readonly id: string;
  readonly markdown: string;
  readonly evidence: readonly EvidenceReference[];
}
