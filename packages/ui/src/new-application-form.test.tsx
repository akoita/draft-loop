import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ApplicationSummaryView } from "./application-contract.js";
import {
  type CreateApplication,
  NewApplicationFormView,
  submitNewApplication,
} from "./new-application-form.js";
import { emptyNewApplicationDraft } from "./new-application-model.js";

const application: ApplicationSummaryView = {
  id: "app-1",
  name: "Acme — Platform Engineer",
  jobSourceKind: "pasted-text",
  status: "drafting",
  isDefault: false,
  createdAt: "2026-10-08T10:00:00.000Z",
  updatedAt: "2026-10-08T10:00:00.000Z",
  runCount: 0,
  briefCount: 0,
  exportCount: 0,
  latestRunId: null,
  archivedAt: null,
  modelProfiles: null,
  nameChosen: true,
  suggestedName: null,
};

const none = () => undefined;
const props = {
  draft: emptyNewApplicationDraft,
  busy: false,
  errorMessage: null,
  onDraftChange: none,
  onSubmit: none,
  onCancel: none,
};
const submitDisabled = /<button[^>]*type="submit"[^>]*disabled=""/u;

describe("New application form", () => {
  it("is a modal that asks for a name and pasted text, and says what is missing", () => {
    const html = renderToStaticMarkup(<NewApplicationFormView {...props} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("New application");
    expect(html).toContain("Paste the job description");
    expect(html).toContain("Name the application");
    expect(html).toContain("Create application");
    expect(html).toMatch(submitDisabled);
    expect(html).toContain('aria-describedby="new-application-problem"');
    const ready = renderToStaticMarkup(
      <NewApplicationFormView
        {...props}
        draft={{ ...emptyNewApplicationDraft, name: "Acme", jobText: "Role" }}
      />,
    );
    expect(ready).not.toMatch(submitDisabled);
    expect(ready).not.toContain('id="new-application-problem"');
  });

  it("asks only for the name and the job, not requirements, a profile or a start", () => {
    const html = renderToStaticMarkup(<NewApplicationFormView {...props} />);
    expect(html).not.toContain("Career profile");
    expect(html).not.toContain("Start review");
    expect(html).not.toContain("Extract");
  });

  it("offers a job page address that needs the person's approval", () => {
    const draft = { ...emptyNewApplicationDraft, name: "Acme", jobKind: "url" as const };
    const html = renderToStaticMarkup(<NewApplicationFormView {...props} draft={draft} />);
    expect(html).toContain("Job page address");
    expect(html).toContain("I approve DraftLoop fetching this page");
    expect(html).toContain("never before");
    expect(html).toContain("web address");
    expect(html).toMatch(submitDisabled);
    const unapproved = renderToStaticMarkup(
      <NewApplicationFormView
        {...props}
        draft={{ ...draft, jobUrl: "https://jobs.example.test/1" }}
      />,
    );
    expect(unapproved).toContain("Allow DraftLoop to fetch this page");
    expect(unapproved).toMatch(submitDisabled);
    const approved = renderToStaticMarkup(
      <NewApplicationFormView
        {...props}
        draft={{ ...draft, jobUrl: "https://jobs.example.test/1", urlApproved: true }}
      />,
    );
    expect(approved).not.toMatch(submitDisabled);
  });

  it("takes pasted text only from a host that fetches no job page", () => {
    const html = renderToStaticMarkup(
      <NewApplicationFormView {...props} jobPagesAllowed={false} />,
    );
    expect(html).toContain("Paste the job description");
    expect(html).not.toContain("Job page address");
    expect(html).not.toContain("Paste text");
  });

  it("shows a creation failure inline and a busy state", () => {
    const html = renderToStaticMarkup(
      <NewApplicationFormView
        {...props}
        draft={{ ...emptyNewApplicationDraft, name: "Acme", jobText: "Role" }}
        errorMessage="The pasted job description is empty."
        busy
      />,
    );
    expect(html).toMatch(/role="alert"[^>]*>The pasted job description is empty\./u);
    expect(html).toContain("Creating…");
    expect(html).toMatch(submitDisabled);
  });
});

describe("creating the application", () => {
  it("hands the port the trimmed name and the pasted text", async () => {
    const create = vi.fn<CreateApplication>(async () => application);
    const outcome = await submitNewApplication(
      { ...emptyNewApplicationDraft, name: "  Acme  ", jobText: "Role text" },
      create,
    );
    expect(create).toHaveBeenCalledWith("Acme", "Role text");
    expect(outcome).toEqual({ kind: "created", application });
  });

  it("hands the port the approved, trimmed URL", async () => {
    const create = vi.fn<CreateApplication>(async () => application);
    await submitNewApplication(
      {
        ...emptyNewApplicationDraft,
        name: "Acme",
        jobKind: "url",
        jobUrl: " https://jobs.example.test/1 ",
        urlApproved: true,
      },
      create,
    );
    expect(create).toHaveBeenCalledWith("Acme", { url: "https://jobs.example.test/1" });
  });

  it("calls nothing for an invalid draft or an unapproved URL", async () => {
    const create = vi.fn<CreateApplication>(async () => application);
    expect(await submitNewApplication(emptyNewApplicationDraft, create)).toMatchObject({
      kind: "invalid",
      problem: expect.stringMatching(/Name/u),
    });
    expect(
      await submitNewApplication(
        {
          ...emptyNewApplicationDraft,
          name: "Acme",
          jobKind: "url",
          jobUrl: "https://jobs.example.test/1",
        },
        create,
      ),
    ).toMatchObject({ kind: "invalid", problem: expect.stringMatching(/Allow DraftLoop/u) });
    expect(create).not.toHaveBeenCalled();
  });

  it("reports the host's refusal, or a fallback when it gives no reason", async () => {
    const draft = { ...emptyNewApplicationDraft, name: "Acme", jobText: "Role" };
    expect(
      await submitNewApplication(draft, async () => {
        throw new Error("The pasted job description is empty.");
      }),
    ).toEqual({ kind: "failed", message: "The pasted job description is empty." });
    expect(
      await submitNewApplication(draft, async () => {
        throw "unknown";
      }),
    ).toEqual({ kind: "failed", message: "The application could not be created." });
  });
});
