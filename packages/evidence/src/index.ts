import type { NormalizedSource } from "@draft-loop/ingestion";

export interface EvidenceReference {
  readonly sourcePath: NormalizedSource["source"]["path"];
  readonly locator?: string;
  readonly excerpt: string;
}
