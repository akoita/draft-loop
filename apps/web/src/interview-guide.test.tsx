import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ApplicationMaterialView,
  type ApplicationMaterialViewProps,
} from "./application-material.js";
import type { ApplicationMaterialDraft } from "./application-material-model.js";
import { InterviewGuideForm, InterviewGuideReader } from "./interview-guide.js";
import {
  emptyInterviewDetailsForm,
  interviewDetailsFormOf,
  interviewDetailsOf,
  interviewGuideSections,
  interviewGuideUnsourcedNote,
  suggestedInterviewGuideDepth,
} from "./interview-guide-model.js";

// An invented guide.
const guide: ApplicationMaterialDraft = {
  id: "amd_fixture0003",
  created_at: "2026-11-10T10:00:00.000Z",
  kind: "interview-guide",
  interview_details: { stage: "final", depth: "extensive", topics: ["salary"] },
  items: [
    { section: "read-first", question: "", text: "Lead with reporting.", citations: [] },
    {
      section: "company",
      question: "",
      text: "Example Corp builds tools for clinics.",
      citations: [],
      company_citations: [{ finding_id: "fnd_1", text: "Example Corp builds tools for clinics." }],
    },
    {
      section: "questions",
      question: "How do you report?",
      text: "As a Data Analyst you report weekly.",
      trap: "Do not overstate the team size.",
      citations: [{ fact_id: "t", text: "role title: Data Analyst" }],
    },
    {
      section: "questions",
      question: "Why this role?",
      text: "Your reporting work fits it.",
      citations: [{ fact_id: "t", text: "role title: Data Analyst" }],
    },
    { section: "never-say", question: "", text: "my old manager", citations: [] },
  ],
  dropped_sentences: ["You led a team of forty."],
  unsourced_topics: ["salary"],
  model: { provider: "anthropic", model: "claude-sonnet-5-5" },
  prompt_version: "interview-guide-v1",
  cost_usd: 0.31,
};

describe("the interview guide's model", () => {
  it("suggests a depth from the interview and lets the candidate switch", () => {
    expect(suggestedInterviewGuideDepth("screen", undefined)).toBe("essential");
    expect(suggestedInterviewGuideDepth("screen", 90)).toBe("extensive");
    expect(suggestedInterviewGuideDepth("technical", 20)).toBe("essential");
    expect(suggestedInterviewGuideDepth("combined", 20)).toBe("extensive");
    expect(interviewDetailsOf({ ...emptyInterviewDetailsForm, lengthMinutes: "75" }).depth).toBe(
      "extensive",
    );
    expect(
      interviewDetailsOf({ ...emptyInterviewDetailsForm, lengthMinutes: "75", depth: "essential" })
        .depth,
    ).toBe("essential");
  });

  it("sends only what the candidate filled, with lists split by line", () => {
    const details = interviewDetailsOf({
      ...emptyInterviewDetailsForm,
      stage: "technical",
      lengthMinutes: "45",
      interviewerRole: "  engineering manager ",
      topics: ["salary"],
      otherTopics: "on-call duty\n\n",
      neverSay: "my old manager\nthe lawsuit",
      notes: "  ",
      scheduledAt: "2026-11-12T14:00",
    });
    expect(details).toEqual({
      stage: "technical",
      depth: "extensive",
      scheduled_at: "2026-11-12T14:00",
      length_minutes: 45,
      interviewer_role: "engineering manager",
      topics: ["salary"],
      other_topics: ["on-call duty"],
      never_say: ["my old manager", "the lawsuit"],
    });
    expect(interviewDetailsOf(interviewDetailsFormOf(details))).toEqual(details);
  });

  it("groups a guide's items by section and names unsourced topics", () => {
    const sections = interviewGuideSections(guide);
    expect(sections.map((section) => [section.section, section.items.length])).toEqual([
      ["read-first", 1],
      ["company", 1],
      ["questions", 2],
      ["never-say", 1],
    ]);
    expect(sections[2]?.items.map((entry) => entry.index)).toEqual([2, 3]);
    expect(interviewGuideUnsourcedNote(guide)).toContain("no recent source on pay");
    expect(interviewGuideUnsourcedNote({ ...guide, unsourced_topics: [] })).toBeUndefined();
  });
});

describe("the interview guide in the panel", () => {
  it("asks for the interview, the depth with its cost, topics and research", () => {
    const html = renderToStaticMarkup(
      <InterviewGuideForm
        form={{ ...emptyInterviewDetailsForm, topics: ["salary"] }}
        onForm={() => {}}
        research
        onResearch={() => {}}
        busy={false}
        firstGuide
      />,
    );
    expect(html).toContain("Kind of interview");
    expect(html).toContain("<strong>Essential</strong> · suggested");
    expect(html).toContain("at most US$0.20");
    expect(html).toContain("at most US$0.40");
    expect(html).toContain("A pay range is given only from a dated source");
    expect(html).toContain("never-say list are never sent");
    expect(html).toContain("Never say, one per line");
  });

  it("reads as folded sections with contents, traps, sources and what was left out", () => {
    const parts: string[] = [];
    const html = renderToStaticMarkup(
      <InterviewGuideReader draft={guide} busy={false} onPart={(part) => parts.push(part)} />,
    );
    expect(html).toContain('<a href="#guide-questions">Likely questions</a>');
    expect(html).toContain(
      '<details id="guide-read-first" class="interview-guide-section" open="">',
    );
    expect(html).toContain('<details id="guide-company" class="interview-guide-section">');
    expect(html).toContain("<strong>Avoid:</strong> Do not overstate the team size.");
    expect(html).toContain("From research");
    expect(html).toContain("<q>You led a team of forty.</q>");
    expect(html).toContain("no recent source on pay");
    // One button per part, under the first section it writes; none for server sections.
    expect(html.match(/Write the questions and checklist again/gu)).toHaveLength(1);
    expect(html).toContain("Write the interview, company, role and market again");
    expect(html).not.toContain("Write the pitch");
  });

  it("opens a saved guide in the panel's guide tab, and keeps old question sets readable", () => {
    const base = {
      kind: "interview-guide",
      draft: guide,
      versions: [guide],
      problem: undefined,
      busy: false,
      guidance: {},
      onGuidance: () => {},
      models: [],
      modelId: undefined,
      onModel: () => {},
      samples: ["A sample"],
      samplesSaved: true,
      onSamples: () => {},
      onSaveSamples: () => {},
      collapsed: false,
      onToggle: () => {},
      onKind: () => {},
      onDraft: () => {},
      onDownload: () => {},
      onSelect: () => {},
      onDelete: () => {},
      onGuidePart: () => {},
      guideForm: <p>details form</p>,
    } satisfies ApplicationMaterialViewProps;
    const html = renderToStaticMarkup(<ApplicationMaterialView {...base} />);
    expect(html).toContain("<p>details form</p>");
    expect(html).toContain("Model (optional)");
    expect(html).not.toContain("Your writing samples");
    expect(html).toContain("Draft a new interview guide");
    expect(html).toContain("Guide contents");
    expect(html).toContain("Write the questions and checklist again");
    const researching = renderToStaticMarkup(
      <ApplicationMaterialView {...base} busy guideResearching />,
    );
    expect(researching).toContain("Researching the employer, the role and the field.");
    const { interview_details: _details, unsourced_topics: _topics, ...rest } = guide;
    const questions: ApplicationMaterialDraft = {
      ...rest,
      kind: "interview-questions",
      items: [{ question: "Why us?", text: "Your reporting fits.", citations: [] }],
    };
    const old = renderToStaticMarkup(<ApplicationMaterialView {...base} draft={questions} />);
    expect(old).toContain("<h3>Why us?</h3>");
    expect(old).not.toContain("Guide contents");
  });
});
