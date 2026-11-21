import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApplicationSummaryView } from "./application-contract.js";
import type { CareerEvidenceStatus } from "./career-evidence.js";
import { DisplayPreferenceProvider } from "./display-preference.js";
import { GettingStarted } from "./getting-started.js";
import { gettingStartedView } from "./getting-started-model.js";
import {
  applicationCardStatus,
  type NextStepInputs,
  type NextStepStage,
  nextStep,
  nextStepSentence,
} from "./next-step.js";

function application(overrides: Partial<ApplicationSummaryView> = {}): ApplicationSummaryView {
  return {
    id: "app-1",
    name: "Acme",
    jobSourceKind: "pasted-text",
    status: "collecting",
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
    ...overrides,
  };
}

const documents = (sourceCount: number): CareerEvidenceStatus => ({
  kind: "selected",
  storeId: "store-1",
  knowledgeBaseId: "kb-1",
  displayName: "Documents",
  sourceCount,
  blockedCount: 0,
});

const ready: NextStepInputs = {
  evidence: documents(1),
  legacyEvidenceSourceCount: 0,
  profile: { kind: "reviewed", version: 1 },
  applications: { status: "ready", applications: [] },
};

const withApps = (...applications: ApplicationSummaryView[]): NextStepInputs => ({
  ...ready,
  applications: { status: "ready", applications },
});

const older = { updatedAt: "2026-11-01T00:00:00.000Z" };
const newer = { updatedAt: "2026-11-02T00:00:00.000Z" };

/**
 * Every record state the guidance must read the same way. A new stage or state goes here first,
 * so the Getting started list and the Home hint cannot drift apart from `nextStep`.
 */
const table: readonly {
  readonly name: string;
  readonly inputs: NextStepInputs;
  readonly stage: NextStepStage;
  readonly sentence: string;
  /** The Getting started step that is current, or null when every step is done. */
  readonly guideStep: string | null;
}[] = [
  {
    name: "no documents",
    inputs: { ...ready, evidence: documents(0) },
    stage: "career",
    sentence: "Add a CV or other documents in Career evidence",
    guideStep: "career",
  },
  {
    name: "profile not reviewed",
    inputs: { ...ready, profile: { kind: "draft", version: 1 } },
    stage: "profile",
    sentence: "Read the facts in Career profile",
    guideStep: "profile",
  },
  {
    name: "no application",
    inputs: ready,
    stage: "job",
    sentence: "Select New application",
    guideStep: "job",
  },
  {
    name: "application without a run",
    inputs: withApps(application()),
    stage: "start-review",
    sentence: "Acme: Start the review to get a first draft.",
    guideStep: "review",
  },
  {
    name: "first draft being written",
    inputs: withApps(application({ status: "drafting", runCount: 1 })),
    stage: "drafting",
    sentence: "Acme: The first draft is being written.",
    guideStep: "review",
  },
  {
    name: "draft waiting for decisions",
    inputs: withApps(application({ status: "in-review", runCount: 1 })),
    stage: "reviewing",
    sentence: "Acme: Read the draft, accept or reject each finding",
    guideStep: "review",
  },
  {
    name: "newest review stopped",
    inputs: withApps(application({ status: "in-review", runCount: 2, latestRunEnded: true })),
    stage: "review-ended",
    sentence: "Acme: The last review stopped before you approved a CV.",
    guideStep: "review",
  },
  {
    name: "approved, not downloaded",
    inputs: withApps(application({ status: "approved", runCount: 1 })),
    stage: "export",
    sentence: "Acme: The CV is approved. Pick a template and export it.",
    guideStep: "download",
  },
  {
    name: "downloaded",
    inputs: withApps(application({ status: "exported", runCount: 1, exportCount: 1 })),
    stage: "done",
    sentence: "Acme: The CV is downloaded.",
    guideStep: null,
  },
  {
    name: "older approved, newer stopped",
    inputs: withApps(
      application({ id: "old", name: "Old", status: "approved", runCount: 1, ...older }),
      application({
        id: "new",
        name: "New",
        status: "in-review",
        runCount: 1,
        latestRunEnded: true,
        ...newer,
      }),
    ),
    stage: "review-ended",
    sentence: "New: The last review stopped",
    guideStep: "review",
  },
  {
    name: "older stopped, newer downloaded",
    inputs: withApps(
      application({ id: "old", name: "Old", status: "in-review", latestRunEnded: true, ...older }),
      application({ id: "new", name: "New", status: "exported", exportCount: 1, ...newer }),
    ),
    stage: "done",
    sentence: "New: The CV is downloaded.",
    guideStep: null,
  },
];

describe("the next step", () => {
  it.each(table)("reads $name the same way on every guidance surface", (row) => {
    const step = nextStep(row.inputs);
    expect(step.stage).toBe(row.stage);
    expect(nextStepSentence(step)).toContain(row.sentence);

    const guide = gettingStartedView({ mode: "guided", guideHidden: false }, row.inputs);
    if (row.guideStep === null) {
      expect(guide.kind).toBe("complete");
    } else {
      expect(guide).toMatchObject({ kind: "guide", current: { key: row.guideStep } });
      if (guide.kind === "guide" && guide.current.application !== null) {
        expect(guide.current.application).toBe(step.application);
      }
    }

    // The followed application's card chip never says In review for a review that ended.
    if (step.application !== null) {
      const chip = applicationCardStatus(step.application).label;
      if (step.stage === "review-ended") expect(chip).toBe("Stopped");
      else expect(chip).not.toBe("Stopped");
    }

    // Once the guide is hidden, its folded line or the Home hint says exactly the next step.
    const hint = renderToStaticMarkup(
      <DisplayPreferenceProvider
        value={{ preference: { mode: "guided", guideHidden: true }, choose: () => undefined }}
      >
        <GettingStarted
          inputs={row.inputs}
          actions={{
            onManageEvidence: () => undefined,
            onManageProfile: () => undefined,
            onOpenApplication: () => undefined,
          }}
        />
      </DisplayPreferenceProvider>,
    );
    expect(hint).toContain(nextStepSentence(step));
  });

  it("follows no archived application or one without a job", () => {
    const archived = application({ archivedAt: "2026-11-01T00:00:00.000Z", ...newer });
    const jobless = application({ id: "jobless", jobMissing: true, ...newer });
    expect(nextStep(withApps(archived, jobless)).stage).toBe("job");
  });
});
