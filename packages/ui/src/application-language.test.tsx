import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApplicationLanguageControl, proposedJobLanguage } from "./application-language.js";
import {
  type CreateApplication,
  NewApplicationFormView,
  submitNewApplication,
} from "./new-application-form.js";
import { emptyNewApplicationDraft } from "./new-application-model.js";

const frenchJob =
  "Nous recherchons une ingénieure plateforme pour rejoindre notre équipe. Vous serez responsable de la conception des outils internes, avec les équipes produit et données.";

const none = () => undefined;
const formProps = {
  busy: false,
  errorMessage: null,
  onDraftChange: none,
  onSubmit: none,
  onCancel: none,
};

describe("the job posting's language", () => {
  it("proposes the posting's language only when it differs from the chosen one", () => {
    expect(proposedJobLanguage(frenchJob, "")).toBe("fr");
    expect(proposedJobLanguage(frenchJob, "fr")).toBeUndefined();
    expect(proposedJobLanguage("Engineer, Paris", "")).toBeUndefined();
  });
});

describe("New application language", () => {
  it("offers the language and proposes the pasted posting's own", () => {
    const html = renderToStaticMarkup(
      <NewApplicationFormView
        {...formProps}
        draft={{ ...emptyNewApplicationDraft, name: "Synthétique", jobText: frenchJob }}
        languageChoice
      />,
    );
    expect(html).toContain("Write its documents in");
    expect(html).toContain("This job posting looks French.");
    expect(html).toContain("Write in French");
  });

  it("hides the choice for a host that cannot set it", () => {
    const html = renderToStaticMarkup(
      <NewApplicationFormView
        {...formProps}
        draft={{ ...emptyNewApplicationDraft, jobText: frenchJob }}
      />,
    );
    expect(html).not.toContain("Write its documents in");
  });

  it("hands the port the chosen language, and none for the workspace's", async () => {
    const created = { id: "app-1" } as Awaited<ReturnType<CreateApplication>>;
    const create = vi.fn<CreateApplication>(async () => created);
    await submitNewApplication(
      { ...emptyNewApplicationDraft, name: "Synthétique", jobText: frenchJob, language: "fr" },
      create,
    );
    await submitNewApplication(
      { ...emptyNewApplicationDraft, name: "Synthetic", jobText: "Role text" },
      create,
    );
    expect(create).toHaveBeenNthCalledWith(1, "Synthétique", frenchJob, undefined, "fr");
    expect(create).toHaveBeenNthCalledWith(2, "Synthetic", "Role text");
  });
});

describe("the application page's language", () => {
  it("shows the workspace's language until the application has its own", () => {
    const save = async () => undefined;
    const inherited = renderToStaticMarkup(
      <ApplicationLanguageControl language={null} disabled={false} onSave={save} />,
    );
    const own = renderToStaticMarkup(
      <ApplicationLanguageControl language="fr" disabled={false} onSave={save} />,
    );
    expect(inherited).toMatch(/<option value="" selected="">The workspace&#x27;s language/u);
    expect(own).toMatch(/<option value="fr" selected="">French/u);
  });
});
