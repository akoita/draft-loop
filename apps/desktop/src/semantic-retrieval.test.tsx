import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { EmbeddingModelPlanResult, EmbeddingModelStatusResult } from "./bridge.js";
import {
  EmbeddingInstallApproval,
  hasAnySemanticRetrievalCapability,
  SemanticRetrievalPanel,
  SemanticRetrievalView,
  type SemanticRetrievalViewProps,
  semanticRetrievalUnavailableMessage,
} from "./semantic-retrieval.js";
import {
  formatModelSize,
  installProgressPercent,
  retrievalFallbackNote,
} from "./semantic-retrieval-presentation.js";

const status = (state: EmbeddingModelStatusResult["state"]): EmbeddingModelStatusResult => ({
  tier: "311m",
  state,
  modelId: "ibm-granite/granite-embedding-311m-multilingual-r2",
  revision: "8f039f21d4181327268271bea4b11ddcc7eef88d",
  license: "Apache-2.0",
  totalSizeBytes: 345_941_766,
  sourceUrl: "https://huggingface.co/onnx-community/granite-embedding-311m-multilingual-r2-ONNX",
});

const plan: EmbeddingModelPlanResult = {
  tier: "311m",
  modelId: "ibm-granite/granite-embedding-311m-multilingual-r2",
  revision: "8f039f21d4181327268271bea4b11ddcc7eef88d",
  license: "Apache-2.0",
  sourceUrl: "https://huggingface.co/onnx-community/granite-embedding-311m-multilingual-r2-ONNX",
  files: [
    { path: "onnx/model_int8.onnx", sizeBytes: 312_556_945 },
    { path: "tokenizer.json", sizeBytes: 33_384_821 },
  ],
  totalSizeBytes: 345_941_766,
};

const noop = () => undefined;

function view(overrides: Partial<SemanticRetrievalViewProps> = {}): string {
  return renderToStaticMarkup(
    <SemanticRetrievalView
      tier="311m"
      mode="lexical"
      status={status("absent")}
      loading={false}
      approval={null}
      installing={false}
      cancelRequested={false}
      message={null}
      error={null}
      disabled={false}
      onTierChange={noop}
      onModeChange={noop}
      onRequestInstall={noop}
      onConfirmInstall={noop}
      onDismissApproval={noop}
      onCancelInstall={noop}
      onRemove={noop}
      {...overrides}
    />,
  );
}

describe("semantic retrieval panel", () => {
  it.each([
    ["absent", "Not installed", "Install model"],
    ["ready", "Installed", "Remove model"],
    ["corrupt", "Corrupt", "Reinstall model"],
    ["unsupported-platform", "Unsupported", null],
  ] as const)("renders the %s status", (state, label, action) => {
    const html = view({ status: status(state) });
    expect(html).toContain(label);
    expect(html).toContain(`data-state="${state}"`);
    if (action !== null) expect(html).toContain(action);
    if (state === "ready") expect(html).not.toContain("Install model");
    if (state === "unsupported-platform") {
      expect(html).not.toContain("Install model");
      expect(html).not.toContain("Remove model");
    }
  });

  it("offers both tiers with the standard tier selected and no filesystem path", () => {
    const html = view();
    expect(html).toContain("Standard (311M parameters, recommended)");
    expect(html).toContain("Low resource (97M parameters)");
    expect(html).toContain('<option value="311m" selected="">');
    expect(html).not.toMatch(/\/home\/|\\Users\\|userData/u);
  });

  it("shows the approval step with source, size, license, and destination label", () => {
    const html = renderToStaticMarkup(
      <EmbeddingInstallApproval plan={plan} onConfirm={noop} onDismiss={noop} />,
    );
    expect(html).toContain("Approve model download");
    expect(html).toContain("Hugging Face");
    expect(html).toContain("huggingface.co/onnx-community/granite-embedding-311m");
    expect(html).toContain("8f039f21d418");
    expect(html).toContain("345.9 MB");
    expect(html).toContain("Apache-2.0");
    expect(html).toContain("DraftLoop application data");
    expect(html).toContain("Confirm download");
    expect(html).toContain(">Cancel<");
    expect(html).toContain("onnx/model_int8.onnx");
  });

  it("opens the approval inside the panel and keeps install disabled until it is answered", () => {
    const html = view({ approval: plan });
    expect(html).toContain("Approve model download");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Install model/u);
  });

  it("shows progress with a cancel action while installing and hides the install controls", () => {
    const html = view({
      status: status("absent"),
      installing: true,
      progress: { receivedBytes: 100_000_000, totalBytes: 400_000_000 },
    });
    expect(html).toContain("Downloading model");
    expect(html).toContain("100.0 MB of 400.0 MB");
    expect(html).toContain("25%");
    expect(html).toContain('<progress class="semantic-progress-bar" max="100" value="25"');
    expect(html).toContain("Cancel download");
    expect(html).toContain("Installing");
    expect(html).not.toContain("Install model");
    expect(html).not.toContain("Remove model");
  });

  it("shows an indeterminate bar before the first progress report and a cancelling state", () => {
    const html = view({ installing: true, cancelRequested: true });
    expect(html).not.toMatch(/<progress[^>]*value=/u);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Cancelling…/u);
  });

  it("shows the three retrieval modes with the saved one checked", () => {
    const html = view({ mode: "hybrid" });
    expect(html).toContain("Lexical (default)");
    expect(html).toContain("Semantic");
    expect(html).toContain("Hybrid");
    expect(html).toMatch(/checked="" value="hybrid"/u);
    expect(html).not.toMatch(/checked="" value="lexical"/u);
  });

  it("explains the keyword fallback only when the mode needs a model that is not ready", () => {
    expect(view({ mode: "lexical", status: status("absent") })).not.toContain("fall back");
    expect(view({ mode: "semantic", status: status("ready") })).not.toContain("fall back");
    expect(view({ mode: "semantic", status: status("absent") })).toContain(
      "runs fall back to keyword retrieval until it is installed",
    );
    expect(view({ mode: "hybrid", status: status("corrupt") })).toContain("reinstalled");
    expect(view({ mode: "hybrid", status: status("unsupported-platform") })).toContain(
      "cannot run on this computer",
    );
    expect(view({ mode: "semantic", status: status("absent"), installing: true })).toContain(
      "still downloading",
    );
    expect(retrievalFallbackNote("semantic", undefined)).toBeNull();
  });

  it("disables the controls while the host is busy and reports failures as alerts", () => {
    const html = view({ disabled: true, error: "The model could not be installed." });
    expect(html).toMatch(/<select[^>]*disabled=""/u);
    expect(html).toMatch(/<fieldset[^>]*disabled=""/u);
    expect(html).toContain('role="alert"');
    expect(html).toContain("The model could not be installed.");
  });

  it("names the unavailable state when the host offers no model commands", () => {
    const html = renderToStaticMarkup(
      <SemanticRetrievalPanel workspaceId="workspace-1" capabilities={{}} disabled={false} />,
    );
    expect(html).toContain(semanticRetrievalUnavailableMessage);
    expect(hasAnySemanticRetrievalCapability({})).toBe(false);
    expect(hasAnySemanticRetrievalCapability({ getRetrievalMode: vi.fn() })).toBe(true);
  });

  it("formats sizes and progress defensively", () => {
    expect(formatModelSize(312_556_945)).toBe("312.6 MB");
    expect(formatModelSize(1_500_000_000)).toBe("1.50 GB");
    expect(formatModelSize(-1)).toBe("unknown size");
    expect(installProgressPercent(5, 0)).toBe(0);
    expect(installProgressPercent(500, 100)).toBe(100);
  });
});
