import { createHash } from "node:crypto";

import {
  canonicalCandidateProfileExtractionSchemaVersion,
  opportunityBriefMaximumCollectionEntries,
  opportunityExtractionSchemaVersion,
} from "@draft-loop/domain";
import type {
  CanonicalCandidateProfileExtractionProposal,
  OpportunityExtractionProposal,
} from "@draft-loop/schemas";

import type {
  CanonicalCandidateProfileExtractionPort,
  CanonicalCandidateProfileExtractionRequest,
} from "./candidate-profile-extraction.js";
import type {
  OpportunityExtractionPort,
  OpportunityExtractionRequest,
} from "./opportunity-extraction.js";

/*
 * Deterministic extraction ports used by fixture-mode (demo) workspaces. They never construct a
 * provider adapter or reach the network. Every value they return is a verbatim substring of the
 * supplied source text, so quote and excerpt verification passes and nothing is invented.
 */

/** Longest fixture value; a prefix of a source line is still an exact quote. */
const maximumFixtureValueLength = 300;
/** Facts taken from one source, so a large evidence file stays a readable demo profile. */
const maximumFixtureFactsPerSource = 24;
/** Leading Markdown list or heading markers that are not part of the line's content. */
const lineMarkerPattern = /^(?:#{1,6}\s+|[-*+•]\s+|\d{1,3}[.)]\s+)/u;
const bulletPattern = /^(?:[-*+•]\s+|\d{1,3}[.)]\s+)/u;
const headingPattern = /^#{1,6}\s+/u;

interface FixtureLine {
  readonly raw: string;
  readonly content: string;
}

function digest(parts: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(parts), "utf8").digest("hex");
}

/** Non-empty source lines with list and heading markers removed; content stays a substring. */
function sourceLines(text: string): FixtureLine[] {
  const lines: FixtureLine[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const raw = line.trim();
    const content = raw.replace(lineMarkerPattern, "").slice(0, maximumFixtureValueLength).trim();
    if (content.length >= 2 && /[\p{L}\p{N}]/u.test(content)) lines.push({ raw, content });
  }
  return lines;
}

function fixtureProfileProposal(
  request: CanonicalCandidateProfileExtractionRequest,
): CanonicalCandidateProfileExtractionProposal {
  const facts = request.sources.flatMap((source) => {
    const distinct = [...new Set(sourceLines(source.text).map(({ content }) => content))];
    return distinct.slice(0, maximumFixtureFactsPerSource).map((content, index) => ({
      key: `fixture-fact-${digest([source.id, String(index)]).slice(0, 24)}`,
      category: "achievement" as const,
      field: "statement",
      value: content,
      evidence: [{ sourceId: source.id, quote: content }],
    }));
  });
  return { schemaVersion: canonicalCandidateProfileExtractionSchemaVersion, facts, issues: [] };
}

/** Synthetic profile extraction: one fact per distinct source line, quoted verbatim. */
export function createFixtureCanonicalCandidateProfileExtractionPort(): CanonicalCandidateProfileExtractionPort {
  return Object.freeze({
    extract: (request: CanonicalCandidateProfileExtractionRequest) =>
      fixtureProfileProposal(request),
  });
}

function fixtureOpportunityProposal(
  request: OpportunityExtractionRequest,
): OpportunityExtractionProposal {
  let role: OpportunityExtractionProposal["role"] = null;
  const requirements: OpportunityExtractionProposal["requirements"][number][] = [];
  const seen = new Set<string>();
  for (const source of request.sources) {
    const lines = sourceLines(source.text);
    const heading = lines.find(({ raw }) => headingPattern.test(raw)) ?? lines[0];
    if (role === null && heading !== undefined) {
      role = { value: heading.content, sourceIds: [source.id] };
    }
    const bullets = lines.filter(({ raw }) => bulletPattern.test(raw));
    const candidates =
      bullets.length > 0
        ? bullets
        : lines.filter((line) => line !== heading && !headingPattern.test(line.raw));
    for (const { content } of candidates) {
      if (seen.has(content) || requirements.length >= opportunityBriefMaximumCollectionEntries) {
        continue;
      }
      seen.add(content);
      requirements.push({
        text: content,
        priority: "medium",
        sourceIds: [source.id],
        excerpt: content,
      });
    }
  }
  return {
    schemaVersion: opportunityExtractionSchemaVersion,
    role,
    employer: null,
    responsibilities: [],
    requirements,
    priorities: [],
    contradictions: [],
  };
}

/** Synthetic requirements extraction: list items (or plain lines) of the job text, verbatim. */
export function createFixtureOpportunityExtractionPort(): OpportunityExtractionPort {
  return Object.freeze({
    extract: (request: OpportunityExtractionRequest) => fixtureOpportunityProposal(request),
  });
}
