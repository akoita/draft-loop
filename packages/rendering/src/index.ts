import type { DraftArtifact } from "@draft-loop/schemas";

export type OutputFormat = "markdown" | "pdf" | "docx";

export interface RenderRequest {
  readonly artifactId: string;
  readonly format: OutputFormat;
}

export function renderMarkdown(artifact: DraftArtifact): string {
  const sections = [...artifact.sections].sort((left, right) => left.order - right.order);
  return `${sections
    .map((section) => {
      const blocks = section.blocks
        .map((block) => (block.type === "bullet" ? `- ${block.text}` : block.text))
        .join("\n\n");
      return `## ${section.title}\n\n${blocks}`;
    })
    .join("\n\n")}\n`;
}
