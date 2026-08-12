export type OutputFormat = "markdown" | "pdf" | "docx";

export interface RenderRequest {
  readonly artifactId: string;
  readonly format: OutputFormat;
}
