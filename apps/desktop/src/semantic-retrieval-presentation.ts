import type {
  EmbeddingModelState,
  EmbeddingModelTier,
  RetrievalMode,
} from "./semantic-retrieval-contract.js";

export const embeddingTierChoices: readonly {
  readonly tier: EmbeddingModelTier;
  readonly label: string;
}[] = [
  { tier: "311m", label: "Standard (311M parameters, recommended)" },
  { tier: "97m", label: "Low resource (97M parameters)" },
];

export const retrievalModeChoices: readonly {
  readonly mode: RetrievalMode;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    mode: "lexical",
    label: "Lexical (default)",
    description: "Keyword search over your candidate knowledge. Needs no model.",
  },
  {
    mode: "semantic",
    label: "Semantic",
    description: "Finds passages by meaning with the local model, even without shared keywords.",
  },
  {
    mode: "hybrid",
    label: "Hybrid",
    description: "Combines keyword and meaning-based results.",
  },
];

export function embeddingModelStateLabel(state: EmbeddingModelState): string {
  switch (state) {
    case "absent":
      return "Not installed";
    case "installing":
      return "Installing";
    case "ready":
      return "Installed";
    case "corrupt":
      return "Corrupt";
    case "unsupported-platform":
      return "Unsupported";
  }
}

const megabyte = 1_000_000;
const gigabyte = 1_000_000_000;

/** A short decimal size such as `312.6 MB`. */
export function formatModelSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes >= gigabyte) return `${(bytes / gigabyte).toFixed(2)} GB`;
  if (bytes >= megabyte) return `${(bytes / megabyte).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

/** Whole-number percentage, clamped to 0-100; `0` when no total is known. */
export function installProgressPercent(receivedBytes: number, totalBytes: number): number {
  if (!Number.isFinite(receivedBytes) || !Number.isFinite(totalBytes) || totalBytes <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((receivedBytes / totalBytes) * 100)));
}

/**
 * The inline explanation shown when a run would use the model but the model is not usable. A run
 * never fails for this: it falls back to keyword retrieval.
 */
export function retrievalFallbackNote(
  mode: RetrievalMode,
  state: EmbeddingModelState | undefined,
): string | null {
  if (mode === "lexical" || state === undefined || state === "ready") return null;
  switch (state) {
    case "absent":
      return "The local model is not installed, so runs fall back to keyword retrieval until it is installed.";
    case "installing":
      return "The local model is still downloading, so runs fall back to keyword retrieval until it is installed.";
    case "corrupt":
      return "The installed model files failed verification, so runs fall back to keyword retrieval until the model is reinstalled.";
    case "unsupported-platform":
      return "The local model cannot run on this computer, so runs use keyword retrieval.";
  }
}
