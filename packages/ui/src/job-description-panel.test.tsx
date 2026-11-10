import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ApplicationJobResult } from "./application-job-contract.js";
import { JobCopyActions, JobDescriptionView, jobOriginNote } from "./job-description-panel.js";
import { createFixtureReviewState, type DesktopReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";
import {
  availableReviewWorkTab,
  findingsTabLabel,
  jobTabLabel,
  reviewWorkPanelProps,
} from "./review-work-tabs.js";

const pasted: ApplicationJobResult = {
  workspaceId: "workspace-1",
  origin: "pasted-text",
  text: "Staff Fullstack Engineer\n\nTypeScript, React & Node.js",
  truncated: false,
  url: null,
  savedAt: null,
  copySource: null,
  earlier: null,
};

function view(job: ApplicationJobResult): string {
  return renderToStaticMarkup(
    <JobDescriptionView load={{ kind: "ready", job }} onRetry={() => undefined} />,
  );
}

describe("the Job tab", () => {
  it("shows the job text read-only with where it came from", () => {
    const html = view(pasted);
    expect(html).toContain("<h2>Job description</h2>");
    expect(html).toContain("The text pasted when this application was created.");
    expect(html).toContain("Staff Fullstack Engineer\n\nTypeScript, React &amp; Node.js");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("longer than shown");
  });

  it("says when the text was cut", () => {
    expect(view({ ...pasted, origin: "local-file", truncated: true })).toContain(
      "The job description is longer than shown here.",
    );
  });

  it("shows a URL job's address and says when no copy of the page was saved", () => {
    const html = view({
      ...pasted,
      origin: "url",
      text: null,
      url: "https://jobs.example.com/staff-engineer",
    });
    expect(html).toContain('href="https://jobs.example.com/staff-engineer"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain("No copy of the page was saved");
    expect(html).not.toContain("job-text");
  });

  it("shows the saved copy of a URL job's page, and its earlier copy folded", () => {
    const html = view({
      ...pasted,
      origin: "url",
      url: "https://jobs.example.com/staff-engineer",
      savedAt: "2030-01-05T12:00:00.000Z",
      earlier: { text: "Staff Engineer, first copy", savedAt: "2030-01-04T12:00:00.000Z" },
    });
    expect(html).toContain("Saved from the job page on 5 Jan 2030");
    expect(html).toContain("Staff Fullstack Engineer");
    expect(html).toContain("<details");
    expect(html).toContain("Earlier copy, saved on 4 Jan 2030");
    expect(html).toContain("Staff Engineer, first copy");
  });

  it("explains an unreadable job and offers a retry after a failed read", () => {
    expect(view({ ...pasted, origin: "unavailable", text: null })).toContain(
      "could not be read. Its file may have been moved or emptied.",
    );
    const failed = renderToStaticMarkup(
      <JobDescriptionView load={{ kind: "failed" }} onRetry={() => undefined} />,
    );
    expect(failed).toContain("Try again");
    expect(jobOriginNote({ ...pasted, origin: "unavailable", text: null })).toBeNull();
  });

  it("falls back to Findings when the remembered tab is not offered", () => {
    const tabs = [findingsTabLabel(0), jobTabLabel()];
    expect(availableReviewWorkTab("coverage", tabs)).toBe("findings");
    expect(availableReviewWorkTab("job", tabs)).toBe("job");
    expect(reviewWorkPanelProps("job", "job", true)).toMatchObject({
      id: "job-panel",
      "aria-labelledby": "review-work-tab-job",
      hidden: false,
    });
  });

  it("appears beside Findings in the review once a run exists, and only with a reader", () => {
    const state: DesktopReviewState = {
      ...createFixtureReviewState(),
      state: "awaiting-approval",
      coverage: null,
    };
    const render = (withReader: boolean) =>
      renderToStaticMarkup(
        <ReviewWorkspace
          state={state}
          onAction={() => undefined}
          {...(withReader ? { onReadJob: async () => pasted } : {})}
        />,
      );
    const withTab = render(true);
    expect(withTab).toContain('role="tablist"');
    expect(withTab).toContain('aria-label="Job description"');
    expect(withTab).toContain('id="job-panel"');
    const withoutTab = render(false);
    expect(withoutTab).not.toContain('id="job-panel"');
    expect(withoutTab).not.toContain('role="tablist"');
    // The draft's toolbar says where the job went once the setup steps left the screen (#1832).
    expect(withTab).toMatch(/class="button button-outline doc-toolbar-job"[^>]*>Read the job</u);
    expect(withoutTab).not.toContain("Read the job");
  });
});

describe("saving a copy of a job page that has none (#2593)", () => {
  const noCopy: ApplicationJobResult = {
    ...pasted,
    origin: "url",
    text: null,
    url: "https://jobs.example.com/staff-engineer",
  };

  it("offers to save a copy now or paste it, only where the host can save one", () => {
    const html = renderToStaticMarkup(
      <JobDescriptionView
        load={{ kind: "ready", job: noCopy }}
        onRetry={() => undefined}
        onSaveCopy={async () => undefined}
      />,
    );
    expect(html).toContain("Save a copy now");
    expect(html).toContain("Paste the description");
    expect(view(noCopy)).not.toContain("Save a copy now");
  });

  it("shows nothing to save once a copy exists, and says when the copy was pasted", () => {
    const pastedCopy: ApplicationJobResult = {
      ...noCopy,
      text: "Staff Engineer",
      savedAt: "2030-01-05T12:00:00.000Z",
      copySource: "pasted",
    };
    const html = renderToStaticMarkup(
      <JobDescriptionView
        load={{ kind: "ready", job: pastedCopy }}
        onRetry={() => undefined}
        onSaveCopy={async () => undefined}
      />,
    );
    expect(html).toContain("Pasted on 5 Jan 2030");
    expect(html).not.toContain("Save a copy now");
  });

  it("asks for the pasted description in a text box", () => {
    const html = renderToStaticMarkup(
      <JobCopyActions save={async () => undefined} initialPasting />,
    );
    expect(html).toContain("<textarea");
    expect(html).toContain("Save the description");
    expect(html).toContain("Cancel");
  });
});
