import { describe, expect, it } from "vitest";

import {
  type CareerInterviewFact,
  type CareerInterviewRequirement,
  findCareerInterviewTopics,
} from "./career-interview-topics.js";

/** An invented career record: two complete roles with a gap between them, and one thin role. */
const completeRole = (subjectId: string, title: string, dates: string): CareerInterviewFact[] => [
  { id: `${subjectId}-title`, category: "role", subjectId, field: "title", value: title },
  {
    id: `${subjectId}-employer`,
    category: "employer",
    subjectId,
    field: "name",
    value: "Example Freight",
  },
  { id: `${subjectId}-dates`, category: "date", subjectId, field: "dates", value: dates },
  {
    id: `${subjectId}-scope`,
    category: "role",
    subjectId,
    field: "scope",
    value: "Owned the routing platform",
  },
  {
    id: `${subjectId}-impact`,
    category: "achievement",
    subjectId,
    field: "impact",
    value: "Moved routing to the new cluster",
  },
];

const year = 2026;

describe("findCareerInterviewTopics", () => {
  it("proposes nothing for a complete record with no applications", () => {
    const facts = completeRole("job-1", "Platform Engineer", "2019 to present");
    expect(findCareerInterviewTopics({ facts }, year)).toEqual([]);
  });

  it("names each missing part of a role in one topic", () => {
    const facts: CareerInterviewFact[] = [
      { id: "t", category: "role", subjectId: "job-2", field: "title", value: "Analyst" },
      { id: "e", category: "employer", subjectId: "job-2", field: "name", value: "Example Bank" },
    ];
    const topics = findCareerInterviewTopics({ facts }, year);
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({
      kind: "role-gap",
      subjectId: "job-2",
      missing: ["dates", "outcome", "scope"],
      factIds: ["t", "e"],
      reason:
        "Your record names Analyst at Example Bank but not when it happened, what changed thanks to your work and what the role covered.",
    });
  });

  it("proposes an untold period between dated roles", () => {
    const facts = [
      ...completeRole("job-1", "Developer", "2012 to 2015"),
      ...completeRole("job-2", "Platform Engineer", "2018 to present"),
    ];
    const topics = findCareerInterviewTopics({ facts }, year);
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({
      kind: "untold-period",
      period: { from: 2016, to: 2017 },
      reason: "Your record says nothing between 2016 and 2017.",
      factIds: ["job-1-dates", "job-2-dates"],
    });
  });

  it("does not count overlapping or adjacent roles as a gap", () => {
    const facts = [
      ...completeRole("job-1", "Developer", "2012 to 2016"),
      ...completeRole("job-2", "Consultant", "2013 to 2014"),
      ...completeRole("job-3", "Platform Engineer", "2017 to present"),
    ];
    expect(findCareerInterviewTopics({ facts }, year)).toEqual([]);
  });

  it("proposes a theme the record hints at but never tells", () => {
    const facts: CareerInterviewFact[] = [
      ...completeRole("job-1", "Platform Engineer", "2019 to present"),
      {
        id: "vol",
        category: "project",
        subjectId: "vol-1",
        field: "name",
        value: "Volunteer at a coding club",
      },
    ];
    const topics = findCareerInterviewTopics({ facts }, year);
    expect(topics.map((topic) => topic.theme)).toEqual(["volunteering"]);
    expect(topics[0]?.reason).toBe(
      "Your record mentions volunteering but tells no story about it.",
    );
  });

  it("does not propose a theme an achievement already tells", () => {
    const facts: CareerInterviewFact[] = [
      ...completeRole("job-1", "Platform Engineer", "2019 to present"),
      { id: "m", category: "skill", field: "name", value: "Mentoring" },
      { id: "a", category: "achievement", field: "impact", value: "Mentored four new engineers" },
    ];
    expect(findCareerInterviewTopics({ facts }, year)).toEqual([]);
  });

  it("proposes a requirement from the candidate's job posts that the record does not show", () => {
    const facts = completeRole("job-1", "Platform Engineer", "2019 to present");
    const requirements: CareerInterviewRequirement[] = [
      { id: "r1", applicationId: "app-1", text: "Kubernetes operations", priority: "high" },
      { id: "r2", applicationId: "app-1", text: "Routing platform ownership", priority: "medium" },
    ];
    const topics = findCareerInterviewTopics({ facts, requirements }, year);
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({
      kind: "application-relevance",
      requirementIds: ["r1"],
      reason:
        'A job you applied for asks for "Kubernetes operations", and your record does not show it yet.',
    });
  });

  it("ranks topics relevant to applications first, then recent ones", () => {
    const facts: CareerInterviewFact[] = [
      { id: "old", category: "role", subjectId: "old", field: "title", value: "Support Agent" },
      { id: "old-d", category: "date", subjectId: "old", field: "dates", value: "2008 to 2010" },
      { id: "new", category: "role", subjectId: "new", field: "title", value: "Data Engineer" },
      { id: "new-d", category: "date", subjectId: "new", field: "dates", value: "2011 to 2020" },
      { id: "mid", category: "role", subjectId: "mid", field: "title", value: "Pipeline Lead" },
      { id: "mid-d", category: "date", subjectId: "mid", field: "dates", value: "2021 to now" },
    ];
    const requirements: CareerInterviewRequirement[] = [
      { id: "r1", applicationId: "app-1", text: "Customer support tooling", priority: "critical" },
    ];
    const subjects = findCareerInterviewTopics({ facts, requirements }, year)
      .filter((topic) => topic.kind === "role-gap")
      .map((topic) => topic.subjectId);
    expect(subjects).toEqual(["old", "mid", "new"]);
  });

  it("is reproducible and suppresses a declined topic until the record changes", () => {
    const facts: CareerInterviewFact[] = [
      { id: "t", category: "role", subjectId: "job", field: "title", value: "Analyst" },
    ];
    const first = findCareerInterviewTopics({ facts }, year);
    expect(findCareerInterviewTopics({ facts }, year)).toEqual(first);
    const declinedTopicKeys = first.map((topic) => topic.key);
    expect(findCareerInterviewTopics({ facts, declinedTopicKeys }, year)).toEqual([]);
    const changed: CareerInterviewFact[] = [
      ...facts,
      { id: "d", category: "date", subjectId: "job", field: "dates", value: "2020 to 2022" },
    ];
    expect(findCareerInterviewTopics({ facts: changed, declinedTopicKeys }, year)).toHaveLength(1);
  });

  it("caps the number of topics", () => {
    const facts: CareerInterviewFact[] = Array.from({ length: 20 }, (_, index) => ({
      id: `t${index}`,
      category: "role",
      subjectId: `job-${index}`,
      field: "title",
      value: `Role ${index}`,
    }));
    expect(findCareerInterviewTopics({ facts }, year)).toHaveLength(12);
    expect(findCareerInterviewTopics({ facts, maximumTopics: 3 }, year)).toHaveLength(3);
  });
});
