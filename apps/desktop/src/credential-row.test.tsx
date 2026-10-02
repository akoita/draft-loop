import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CredentialRow } from "./review.js";

describe("provider credential row", () => {
  it("renders a dedicated DeepInfra API-key row with secret-free status", () => {
    const html = renderToStaticMarkup(
      <CredentialRow
        title="DeepInfra API key (Z.ai GLM)"
        placeholder="DeepInfra API key"
        status={{
          provider: "deepinfra",
          configured: true,
          source: "app",
          protection: "os-backed",
        }}
        value=""
        revealed={false}
        onReveal={vi.fn()}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(html).toContain("DeepInfra API key (Z.ai GLM)");
    expect(html).toContain("Configured in app");
    expect(html).toContain("OS-backed encryption");
    expect(html).toContain('type="password"');
    expect(html).toContain("Remove");
    expect(html).not.toContain("user-session");
  });
});
