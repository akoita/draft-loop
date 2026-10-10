import type { Command } from "commander";
import {
  type ApplicationIo,
  type CandidateEvidenceKind,
  CliUserError,
  candidateEvidenceKinds,
  type SourceEvidenceKindEntry,
  type SourceEvidenceKindService,
} from "./workflow.js";

/** The evidence-kind fields `knowledge source list` adds to each current source. */
export interface SourceEvidenceKindListing {
  readonly evidenceKind: CandidateEvidenceKind;
  readonly evidenceKindOrigin: SourceEvidenceKindEntry["origin"];
}

/** Effective kinds keyed by source id; retired sources have none. */
export async function sourceEvidenceKindListings(
  service: SourceEvidenceKindService,
  command: { readonly storeRoot: string; readonly knowledgeBaseId: string },
): Promise<ReadonlyMap<string, SourceEvidenceKindListing>> {
  const entries = await service.listSourceEvidenceKinds(command);
  return new Map(
    entries.map((entry) => [
      entry.sourceId,
      { evidenceKind: entry.kind, evidenceKindOrigin: entry.origin },
    ]),
  );
}

function parseKind(value: string): CandidateEvidenceKind {
  const kind = candidateEvidenceKinds.find((candidate) => candidate === value);
  if (kind === undefined) {
    throw new CliUserError(`Evidence kind must be one of: ${candidateEvidenceKinds.join(", ")}.`);
  }
  return kind;
}

function entryLine(entry: SourceEvidenceKindEntry): string {
  const origin =
    entry.origin === "user"
      ? "set by you"
      : `detected${entry.confidence === undefined ? "" : `, confidence ${entry.confidence.toFixed(2)}`}`;
  return `source ${entry.sourceId} evidence kind: ${entry.kind} (${origin})`;
}

/**
 * Registers `knowledge source kind`, which shows a source's effective evidence kind and records
 * or clears the user's override through the shared application contract.
 */
export function registerEvidenceKindCommand(
  knowledgeSource: Command,
  service: SourceEvidenceKindService,
  io: ApplicationIo,
): void {
  knowledgeSource
    .command("kind")
    .description(
      `Show a source's evidence kind, or set it (${candidateEvidenceKinds.join(", ")}); --clear returns to the detected kind`,
    )
    .argument("<store-root>", "local candidate-knowledge store directory")
    .argument("<knowledge-base-id>", "opaque knowledge-base id")
    .argument("<source-id>", "opaque source id")
    .argument("[kind]", "evidence kind to set for this source")
    .option("--clear", "remove your override and use the detected kind")
    .option("--json", "print machine-readable JSON")
    .action(
      async (
        storeRoot: string,
        knowledgeBaseId: string,
        sourceId: string,
        kind: string | undefined,
        options: { clear?: boolean; json?: boolean },
      ) => {
        if (kind !== undefined && options.clear === true) {
          throw new CliUserError("Give either a kind or --clear, not both.");
        }
        let entry: SourceEvidenceKindEntry | undefined;
        if (kind !== undefined || options.clear === true) {
          entry = await service.setSourceEvidenceKind({
            storeRoot,
            knowledgeBaseId,
            sourceId,
            kind: kind === undefined ? null : parseKind(kind),
          });
        } else {
          entry = (await service.listSourceEvidenceKinds({ storeRoot, knowledgeBaseId })).find(
            (candidate) => candidate.sourceId === sourceId,
          );
          if (entry === undefined) {
            throw new CliUserError(
              `Source ${sourceId} is not a current source of this knowledge base.`,
            );
          }
        }
        if (options.json === true) io.write(JSON.stringify(entry));
        else io.write(entryLine(entry));
      },
    );
}
