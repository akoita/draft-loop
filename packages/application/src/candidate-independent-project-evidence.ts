import type {
  CandidateKnowledgeLexicalChunkInput,
  CandidateKnowledgeLexicalHit,
} from "@draft-loop/domain";

import {
  type CandidateRoleContributionBlock,
  createCandidateRoleContributionBlock,
  flattenCandidateRoleContributionSourceLines,
  isDatedCandidateRoleHeading,
  parseCandidateRoleContributionBlocks,
} from "./candidate-role-contribution-blocks.js";

export type CandidateIndependentProjectSelectionDecision =
  | "no-project-groups"
  | "no-job-overlap"
  | "budget"
  | "selected";

export interface CandidateIndependentProjectSelection {
  readonly foundRegion: boolean;
  readonly blocks: readonly CandidateRoleContributionBlock[];
  readonly decision: CandidateIndependentProjectSelectionDecision;
  readonly projectDecisions: readonly {
    readonly title: string;
    readonly decision: Exclude<CandidateIndependentProjectSelectionDecision, "no-project-groups">;
  }[];
}

interface ProjectLabel {
  readonly title: string;
  readonly description: string;
}

interface ProjectGroup {
  readonly labelIndex: number;
  readonly title: string;
  readonly descriptor: CandidateRoleContributionBlock;
  readonly score: number;
  readonly minimum: CandidateRoleContributionBlock;
  readonly minimumBody: readonly CandidateRoleContributionBlock[];
  readonly extras: readonly CandidateRoleContributionBlock[];
  readonly constraints: readonly CandidateRoleContributionBlock[];
  readonly requestedOrder: number;
}

const headingPattern = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u;
const boldProjectLabelPattern = /^\s{0,3}\*\*([^*\r\n]{1,100})\*\*(.*)$/u;
const boldSectionLabelPattern = /^\s{0,3}\*\*(.{1,120}?)\*\*/u;
const ancillarySectionPattern =
  /\b(?:research|self[ -]?study|(?:formal\s+)?training|education|coursework|certifications?|languages?)\b/iu;
const declarativeProjectTitlePattern =
  /\b(?:is|are|was|were|be|been|being|used|uses|using|not|stated)\b/iu;
const genericProjectTitles = new Set([
  "caveat",
  "education",
  "global limitation",
  "global limitations",
  "honesty constraints",
  "limitations",
  "independent projects",
  "other projects",
  "personal projects",
  "project",
  "projects",
  "production limitations",
  "note",
  "notes",
  "ongoing technical research",
  "self study",
  "selected projects",
  "scope",
  "scope limitations",
  "status",
  "technical research",
  "work samples",
]);
const genericJobTerms = new Set([
  "a",
  "about",
  "across",
  "all",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "candidate",
  "could",
  "career",
  "cv",
  "developer",
  "developed",
  "development",
  "do",
  "engineering",
  "engineer",
  "experience",
  "for",
  "from",
  "has",
  "have",
  "in",
  "independent",
  "into",
  "is",
  "it",
  "its",
  "led",
  "made",
  "most",
  "more",
  "not",
  "only",
  "our",
  "of",
  "on",
  "or",
  "project",
  "projects",
  "responsible",
  "role",
  "self",
  "software",
  "team",
  "than",
  "the",
  "then",
  "their",
  "them",
  "there",
  "these",
  "this",
  "that",
  "to",
  "used",
  "very",
  "when",
  "where",
  "was",
  "were",
  "which",
  "who",
  "what",
  "how",
  "will",
  "would",
  "should",
  "also",
  "each",
  "some",
  "any",
  "other",
  "you",
  "your",
  "with",
  "work",
  "worked",
  "years",
]);
const limitationLabelPattern =
  /^\s*(?:\*\*)?(?:global|production|scope)?\s*limitations?(?:\*\*)?\s*[:.]?/iu;
const globalConstraintLabelPattern =
  /^\s*(?:\*\*)?global\s+(?:production\s+)?(?:limitations?|constraints?)(?:\*\*)?\s*[:.]?(?:\*\*)?/iu;
const projectConstraintLabelPattern =
  /^\s*(?:\*\*)?(?:honesty|scope|status|production)\s+(?:constraints?|limitations?|notes?)(?:\*\*)?\s*[:.]?(?:\*\*)?/iu;
const globalProductionLimitationPattern =
  /\b(?:all|both|these|none of (?:these|the)|across (?:all |the )?)\s+(?:independent\s+)?projects?\b[\s\S]{0,260}\b(?:not\s+(?:in\s+)?production|no\s+production|prototype|demo(?:nstration)?\s+only|no\s+users|not\s+deployed|no\s+scale)\b/iu;
const projectStatusLimitationPattern =
  /\b(?:not\s+(?:in\s+)?production(?:[- ]ready)?|no\s+production\s+users|staging\s+only|demo(?:nstration)?\s+only|prototype\s+only|not\s+deployed|no\s+scale\s+metric)\b/iu;
const listItemStartPattern = /^\s{0,3}(?:[-*+]|\d+[.)])\s+/u;

function headingLevel(line: string): number | undefined {
  return headingPattern.exec(line)?.[1]?.length;
}

function independentRoleHeading(line: string): boolean {
  return (
    isDatedCandidateRoleHeading(line) &&
    /\b(?:independent|freelance|self[ -]?employed)\b/iu.test(line)
  );
}

function parseProjectLabel(line: string): ProjectLabel | undefined {
  const match = boldProjectLabelPattern.exec(line);
  if (match === null) return undefined;
  let title = match[1]?.trim() ?? "";
  let description = match[2]?.trim() ?? "";
  if (/^[,.]/u.test(description)) {
    description = description.slice(1).trim();
  } else if (/[,.]$/u.test(title)) {
    title = title.replace(/[,.]$/u, "").trim();
  } else {
    return undefined;
  }
  const normalizedTitle = normalizePhrase(title);
  if (
    normalizedTitle === "" ||
    genericProjectTitles.has(normalizedTitle) ||
    normalizedTitle.split(" ").length > 8 ||
    /[,!?;:]/u.test(title) ||
    declarativeProjectTitlePattern.test(normalizedTitle)
  ) {
    return undefined;
  }
  return { title, description };
}

function isAncillarySectionBoundary(line: string): boolean {
  const markdownTitle = headingPattern.exec(line)?.[2];
  const boldTitle = boldSectionLabelPattern.exec(line)?.[1];
  const title = markdownTitle ?? boldTitle;
  return title !== undefined && ancillarySectionPattern.test(title);
}

function isUnrecognizedBoldFactBoundary(line: string): boolean {
  const match = boldProjectLabelPattern.exec(line);
  if (match === null || parseProjectLabel(line) !== undefined) return false;
  if (limitationLabelPattern.test(line) || projectConstraintLabelPattern.test(line)) return false;
  const rawTitle = match[1]?.trim() ?? "";
  const normalizedTitle = normalizePhrase(rawTitle.replace(/[,.]$/u, ""));
  return (
    declarativeProjectTitlePattern.test(normalizedTitle) ||
    normalizedTitle.split(" ").length > 8 ||
    /[,!?;:]/u.test(rawTitle.replace(/[.]$/u, ""))
  );
}

function normalizePhrase(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function meaningfulTerms(text: string, excluded: ReadonlySet<string> = new Set()): Set<string> {
  return new Set(
    (
      text
        .normalize("NFKC")
        .toLocaleLowerCase("en-US")
        .match(/[\p{L}\p{N}]+/gu) ?? []
    ).filter((term) => term.length > 2 && !genericJobTerms.has(term) && !excluded.has(term)),
  );
}

function overlapScore(queryTerms: ReadonlySet<string>, text: string, title: string): number {
  const titleTerms = meaningfulTerms(title);
  const contentTerms = meaningfulTerms(text, titleTerms);
  let score = 0;
  for (const term of queryTerms) if (contentTerms.has(term)) score += 1;
  return score;
}

function instructionOrder(title: string, instructions: string): number {
  const instructionTerms = normalizePhrase(instructions).split(" ").filter(Boolean);
  const aliases = title
    .split(/\s*\/\s*/u)
    .map(normalizePhrase)
    .map((alias) => alias.split(" ").filter(Boolean))
    .filter((alias) => alias.length > 0);
  const positions = aliases
    .map((alias) => {
      for (let index = 0; index <= instructionTerms.length - alias.length; index += 1) {
        if (alias.every((term, offset) => instructionTerms[index + offset] === term)) return index;
      }
      return -1;
    })
    .filter((position) => position >= 0);
  return positions.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...positions);
}

function isGlobalLimitation(block: CandidateRoleContributionBlock): boolean {
  return (
    globalConstraintLabelPattern.test(block.text) ||
    globalProductionLimitationPattern.test(block.text)
  );
}

function isProjectLimitation(block: CandidateRoleContributionBlock): boolean {
  return (
    limitationLabelPattern.test(block.text) ||
    projectConstraintLabelPattern.test(block.text) ||
    projectStatusLimitationPattern.test(block.text)
  );
}

function combineBlocks(
  blocks: readonly CandidateRoleContributionBlock[],
  sourceOrder: number,
): CandidateRoleContributionBlock {
  return {
    text: blocks.map(({ text }) => text).join("\n\n"),
    lineStart: Math.min(...blocks.map(({ lineStart }) => lineStart)),
    lineEnd: Math.max(...blocks.map(({ lineEnd }) => lineEnd)),
    sourceRanges: blocks.flatMap(({ sourceRanges }) => sourceRanges),
    sourceOrder,
  };
}

function renderProjectGroup(
  descriptor: CandidateRoleContributionBlock,
  selectedBody: readonly CandidateRoleContributionBlock[],
): CandidateRoleContributionBlock {
  return combineBlocks(
    [descriptor, ...[...selectedBody].sort((left, right) => left.sourceOrder - right.sourceOrder)],
    descriptor.sourceOrder,
  );
}

/** Select bounded, job-relevant complete projects from an explicit independent-work heading. */
export function selectCandidateIndependentProjectEvidence(
  roleHeading: CandidateKnowledgeLexicalHit,
  roleScopeChunks: readonly CandidateKnowledgeLexicalChunkInput[],
  jobQuery: string,
  candidateInstructions: string,
  maximumRecordCharacters: number,
): CandidateIndependentProjectSelection {
  const lines = flattenCandidateRoleContributionSourceLines(roleScopeChunks);
  if (lines === undefined) {
    return { foundRegion: false, blocks: [], decision: "no-project-groups", projectDecisions: [] };
  }
  const roleLineIndex = lines.findIndex((line) => line.lineNumber === roleHeading.lineStart);
  const roleLine = lines[roleLineIndex];
  if (roleLineIndex < 0 || roleLine === undefined || !independentRoleHeading(roleLine.text)) {
    return { foundRegion: false, blocks: [], decision: "no-project-groups", projectDecisions: [] };
  }
  const roleLevel = headingLevel(roleLine.text) ?? 0;
  let scopeEnd = lines.length;
  for (let index = roleLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const level = headingLevel(line.text);
    if (
      isDatedCandidateRoleHeading(line.text) ||
      (level !== undefined && level <= roleLevel) ||
      isAncillarySectionBoundary(line.text)
    ) {
      scopeEnd = index;
      break;
    }
  }
  const roleLines = lines.slice(roleLineIndex + 1, scopeEnd);
  const labels = roleLines.flatMap((line, index) => {
    const label = parseProjectLabel(line.text);
    return label === undefined ? [] : [{ line, index, ...label }];
  });
  if (labels.length === 0) {
    return { foundRegion: false, blocks: [], decision: "no-project-groups", projectDecisions: [] };
  }

  const globalBlocks: CandidateRoleContributionBlock[] = [];
  const globalKeys = new Set<string>();
  const addGlobal = (block: CandidateRoleContributionBlock) => {
    const key = JSON.stringify([block.lineStart, block.lineEnd, block.text, block.sourceRanges]);
    if (!globalKeys.has(key)) {
      globalKeys.add(key);
      globalBlocks.push(block);
    }
  };
  const prefixBlocks = parseCandidateRoleContributionBlocks(
    roleLines.slice(0, labels[0]?.index ?? 0),
    0,
  );
  for (const block of prefixBlocks)
    if (isGlobalLimitation(block) || limitationLabelPattern.test(block.text)) addGlobal(block);

  const queryTerms = meaningfulTerms(jobQuery);
  const groups: ProjectGroup[] = [];
  for (const [index, label] of labels.entries()) {
    const nextProjectLabelIndex = labels[index + 1]?.index ?? roleLines.length;
    let nextLabelIndex = nextProjectLabelIndex;
    for (let cursor = label.index + 1; cursor < nextLabelIndex; cursor += 1) {
      const line = roleLines[cursor];
      if (
        line !== undefined &&
        (isAncillarySectionBoundary(line.text) || isUnrecognizedBoldFactBoundary(line.text))
      ) {
        nextLabelIndex = cursor;
        break;
      }
    }
    const descriptorLines = [label.line];
    let bodyStartIndex = label.index + 1;
    while (bodyStartIndex < nextLabelIndex) {
      const line = roleLines[bodyStartIndex];
      const previous = roleLines[bodyStartIndex - 1];
      if (
        line === undefined ||
        previous === undefined ||
        line.text.trim() === "" ||
        line.lineNumber > previous.lineNumber + 1 ||
        listItemStartPattern.test(line.text) ||
        headingLevel(line.text) !== undefined
      ) {
        break;
      }
      descriptorLines.push(line);
      bodyStartIndex += 1;
    }
    const descriptor = createCandidateRoleContributionBlock(descriptorLines, label.line.lineNumber);
    const description = [label.description, ...descriptorLines.slice(1).map(({ text }) => text)]
      .join(" ")
      .trim();
    const parsedBody = parseCandidateRoleContributionBlocks(
      roleLines.slice(bodyStartIndex, nextLabelIndex),
      label.line.lineNumber + 1,
    ).filter((block) => block.text.trim() !== "");
    const bodyBlocks: CandidateRoleContributionBlock[] = [];
    const constraints: CandidateRoleContributionBlock[] = [];
    for (const block of parsedBody) {
      if (isGlobalLimitation(block)) addGlobal(block);
      else if (isProjectLimitation(block)) constraints.push(block);
      else bodyBlocks.push(block);
    }
    const titleTerms = meaningfulTerms(label.title);
    const descriptionTerms = meaningfulTerms(description, titleTerms);
    const bodyTerms = new Set(
      bodyBlocks.flatMap((block) => [...meaningfulTerms(block.text, titleTerms)]),
    );
    if (descriptionTerms.size + bodyTerms.size === 0) continue;

    const requestedOrder = instructionOrder(label.title, candidateInstructions);
    const isRequested = Number.isFinite(requestedOrder);
    const descriptorScore = overlapScore(queryTerms, description, label.title);
    const bodyUnits = bodyBlocks
      .map((block) => ({ block, score: overlapScore(queryTerms, block.text, label.title) }))
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) =>
          right.score - left.score || left.block.sourceOrder - right.block.sourceOrder,
      );
    const bestBody = bodyUnits[0];
    if (descriptorScore === 0 && bestBody === undefined && !isRequested) continue;
    const bestScore = Math.max(descriptorScore, bestBody?.score ?? 0);
    const firstBody = bodyBlocks[0];
    const mandatoryBody = isRequested
      ? bestBody === undefined
        ? firstBody === undefined
          ? []
          : [firstBody]
        : [bestBody.block]
      : descriptorScore > 0
        ? []
        : bestBody === undefined
          ? []
          : [bestBody.block];
    const minimum = renderProjectGroup(descriptor, mandatoryBody);
    const selectedBody = new Set(mandatoryBody);
    const extras = bodyUnits
      .map(({ block }) => block)
      .filter((block) => !selectedBody.has(block))
      .sort((left, right) => left.sourceOrder - right.sourceOrder);
    groups.push({
      labelIndex: index,
      title: label.title,
      descriptor,
      score: bestScore,
      minimum,
      minimumBody: mandatoryBody,
      extras,
      constraints,
      requestedOrder,
    });
  }

  if (groups.length === 0) {
    return {
      foundRegion: true,
      blocks: [],
      decision: "no-job-overlap",
      projectDecisions: labels.map(({ title }) => ({ title, decision: "no-job-overlap" as const })),
    };
  }

  const rankedGroups = [...groups].sort((left, right) => {
    const leftRequested = Number.isFinite(left.requestedOrder);
    const rightRequested = Number.isFinite(right.requestedOrder);
    if (leftRequested !== rightRequested) return leftRequested ? -1 : 1;
    if (leftRequested && rightRequested && left.requestedOrder !== right.requestedOrder) {
      return left.requestedOrder - right.requestedOrder;
    }
    return right.score - left.score || left.descriptor.sourceOrder - right.descriptor.sourceOrder;
  });
  const limitationCost = globalBlocks.reduce((sum, block) => sum + 2 + block.text.length, 0);
  const selectedGroups: { group: ProjectGroup; body: CandidateRoleContributionBlock[] }[] = [];
  const selectedGroupSet = new Set<ProjectGroup>();
  const projectDecisions: CandidateIndependentProjectSelection["projectDecisions"][number][] =
    labels.map(({ title }) => ({ title, decision: "no-job-overlap" }));
  let usedCharacters = 0;
  for (const group of rankedGroups) {
    const constraintCost = group.constraints.reduce((sum, block) => sum + 2 + block.text.length, 0);
    const nextCost =
      2 +
      group.minimum.text.length +
      constraintCost +
      (selectedGroups.length === 0 ? limitationCost : 0);
    if (roleLine.text.length + usedCharacters + nextCost > maximumRecordCharacters) continue;
    selectedGroups.push({ group, body: [...group.minimumBody] });
    selectedGroupSet.add(group);
    usedCharacters += nextCost;
  }
  if (selectedGroups.length === 0) {
    return {
      foundRegion: true,
      blocks: [],
      decision: "budget",
      projectDecisions: projectDecisions.map((entry, index) =>
        groups.some(({ labelIndex }) => labelIndex === index)
          ? { ...entry, decision: "budget" }
          : entry,
      ),
    };
  }

  const requestedOrder = [...selectedGroups].sort((left, right) => {
    const leftMentioned = Number.isFinite(left.group.requestedOrder);
    const rightMentioned = Number.isFinite(right.group.requestedOrder);
    if (leftMentioned !== rightMentioned) return leftMentioned ? -1 : 1;
    if (leftMentioned && rightMentioned && left.group.requestedOrder !== right.group.requestedOrder)
      return left.group.requestedOrder - right.group.requestedOrder;
    return left.group.descriptor.sourceOrder - right.group.descriptor.sourceOrder;
  });

  for (const item of requestedOrder) {
    const body = item.body;
    let current = renderProjectGroup(item.group.descriptor, body);
    for (const extra of item.group.extras) {
      if (body.includes(extra)) continue;
      const candidateBody = [...body, extra];
      const candidate = renderProjectGroup(item.group.descriptor, candidateBody);
      const increase = candidate.text.length - current.text.length;
      if (roleLine.text.length + usedCharacters + increase <= maximumRecordCharacters) {
        body.push(extra);
        usedCharacters += increase;
        current = candidate;
      }
    }
  }

  const output: CandidateRoleContributionBlock[] = [];
  for (const item of requestedOrder) {
    const group = item.group;
    output.push(renderProjectGroup(group.descriptor, item.body));
    output.push(...group.constraints);
    projectDecisions[group.labelIndex] = { title: group.title, decision: "selected" };
  }
  output.push(...globalBlocks.sort((left, right) => left.sourceOrder - right.sourceOrder));
  for (const group of groups) {
    if (!selectedGroupSet.has(group)) {
      projectDecisions[group.labelIndex] = { title: group.title, decision: "budget" };
    }
  }
  return { foundRegion: true, blocks: output, decision: "selected", projectDecisions };
}
