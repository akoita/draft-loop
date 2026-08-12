export interface IngestionSource {
  readonly path: string;
  readonly mediaType?: string;
}

export interface NormalizedSource {
  readonly source: IngestionSource;
  readonly text: string;
}
