/**
 * What the cover letter writing kit screen can do (#3279), built from the capability port only
 * when the host offers every kit command. A host without them gets no kit screen.
 */
import type { BridgeResult, CapabilityPort } from "./bridge.js";
import type { AnnotatedDraftView } from "./cover-letter-annotated-contract.js";
import type {
  CoverLetterKitLoadResult,
  CoverLetterKitScopeInput,
  CoverLetterKitView,
  OwnCoverLetterDownloadInput,
  OwnCoverLetterSaveInput,
  OwnCoverLetterView,
} from "./cover-letter-kit-contract.js";

export interface CoverLetterKitCapabilities {
  /** The newest kit and the newest letter the person wrote beside it. */
  readonly load: (scope: CoverLetterKitScopeInput) => Promise<CoverLetterKitLoadResult>;
  /** Prepares a new kit; one metered model call on the host. */
  readonly prepare: (scope: CoverLetterKitScopeInput) => Promise<CoverLetterKitView>;
  /** Saves the person's letter as a new version; no model is called. */
  readonly saveLetter: (input: OwnCoverLetterSaveInput) => Promise<OwnCoverLetterView>;
  /** Saves the person's letter as a Word or PDF file, with no confirm step. */
  readonly downloadLetter: (input: OwnCoverLetterDownloadInput) => Promise<void>;
  /** The annotated draft's model letter (#3281); absent on a host without it. */
  readonly draft?: AnnotatedDraftCapabilities;
}

export interface AnnotatedDraftCapabilities {
  /** The newest cover letter a model drafted, or null before one exists; no model is called. */
  readonly load: (scope: CoverLetterKitScopeInput) => Promise<AnnotatedDraftView | null>;
  /** Drafts a cover letter; one metered model call on the host. */
  readonly prepare: (scope: CoverLetterKitScopeInput) => Promise<AnnotatedDraftView>;
}

export const annotatedDraftCommands = [
  "cover-letter-kit.load-draft",
  "cover-letter-kit.prepare-draft",
] as const;

export const coverLetterKitCommands = [
  "cover-letter-kit.load",
  "cover-letter-kit.prepare",
  "cover-letter-kit.save-letter",
  "cover-letter-kit.download-letter",
] as const;

export function createCoverLetterKitCapabilities(
  port: CapabilityPort,
  unwrap: <Value>(result: BridgeResult<Value>) => Value,
): CoverLetterKitCapabilities | undefined {
  if (!coverLetterKitCommands.every((command) => port.hasCapability(command))) return undefined;
  const draft: AnnotatedDraftCapabilities | undefined = annotatedDraftCommands.every((command) =>
    port.hasCapability(command),
  )
    ? {
        load: async (input) =>
          unwrap(await port.execute({ type: "cover-letter-kit.load-draft", input: { ...input } }))
            .draft,
        prepare: async (input) =>
          unwrap(
            await port.execute({ type: "cover-letter-kit.prepare-draft", input: { ...input } }),
          ).draft,
      }
    : undefined;
  return {
    ...(draft === undefined ? {} : { draft }),
    load: async (input) =>
      unwrap(await port.execute({ type: "cover-letter-kit.load", input: { ...input } })),
    prepare: async (input) =>
      unwrap(await port.execute({ type: "cover-letter-kit.prepare", input: { ...input } })).kit,
    saveLetter: async (input) =>
      unwrap(await port.execute({ type: "cover-letter-kit.save-letter", input: { ...input } }))
        .letter,
    downloadLetter: async (input) => {
      unwrap(await port.execute({ type: "cover-letter-kit.download-letter", input: { ...input } }));
    },
  };
}
