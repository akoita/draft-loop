import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CredentialRow,
  googleCredentialNote,
  mistralCredentialNote,
} from "./provider-authentication.js";

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

  it("renders a dedicated Google Gemini API-key row naming Google and the paid-tier requirement", () => {
    const html = renderToStaticMarkup(
      <CredentialRow
        title="Google Gemini API key"
        placeholder="Gemini API key"
        note={googleCredentialNote}
        status={{ provider: "google", configured: false, source: "none", protection: "none" }}
        value=""
        revealed={false}
        onReveal={vi.fn()}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(html).toContain("Google Gemini API key");
    expect(html).toContain("Not configured");
    expect(html).toContain("sends submitted content to Google");
    expect(html).toContain("free-tier terms let Google use it");
    expect(html).toContain("paid-tier key");
    expect(html).toContain('type="password"');
    expect(html).not.toContain("Remove");
  });

  it("renders a dedicated Mistral API-key row naming Mistral AI as the destination and the public preview", () => {
    const html = renderToStaticMarkup(
      <CredentialRow
        title="Mistral API key"
        placeholder="Mistral API key"
        note={mistralCredentialNote}
        status={{ provider: "mistral", configured: false, source: "none", protection: "none" }}
        value=""
        revealed={false}
        onReveal={vi.fn()}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(html).toContain("Mistral API key");
    expect(html).toContain("Not configured");
    expect(html).toContain("sends candidate material to Mistral AI (api.mistral.ai)");
    expect(html).toContain("Mistral Large 4 is a public preview");
    expect(html).toContain('type="password"');
    expect(html).not.toContain("Remove");
  });

  it("renders a configured Mistral row without the stored key", () => {
    const html = renderToStaticMarkup(
      <CredentialRow
        title="Mistral API key"
        placeholder="Mistral API key"
        note={mistralCredentialNote}
        status={{ provider: "mistral", configured: true, source: "app", protection: "os-backed" }}
        value=""
        revealed={false}
        onReveal={vi.fn()}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(html).toContain("Configured in app");
    expect(html).toContain("Remove");
    expect(html).not.toContain("synthetic-mistral");
  });
});
