import type { NormalizedSource } from "@draft-loop/ingestion";

export interface EvidenceReference {
  readonly sourcePath: NormalizedSource["source"]["path"];
  readonly sourceChecksum?: string | undefined;
  readonly locator?: string | undefined;
  readonly excerpt: string;
}
