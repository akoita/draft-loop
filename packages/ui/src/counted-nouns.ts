import { plural } from "@lingui/core/macro";

/**
 * Counted nouns for the screens, as catalog plurals so each language picks its own forms.
 * Modules the server loads stay macro-free and must not import this file.
 */
export const countedNouns = {
  source: (count: number) => plural(count, { one: "# source", other: "# sources" }),
  sourceFile: (count: number) => plural(count, { one: "# source file", other: "# source files" }),
  run: (count: number) => plural(count, { one: "# run", other: "# runs" }),
  chunk: (count: number) => plural(count, { one: "# chunk", other: "# chunks" }),
  fact: (count: number) => plural(count, { one: "# fact", other: "# facts" }),
  item: (count: number) => plural(count, { one: "# item", other: "# items" }),
  excerpt: (count: number) => plural(count, { one: "# excerpt", other: "# excerpts" }),
  requirement: (count: number) => plural(count, { one: "# requirement", other: "# requirements" }),
  responsibility: (count: number) =>
    plural(count, { one: "# responsibility", other: "# responsibilities" }),
  blockingFinding: (count: number) =>
    plural(count, { one: "# blocking finding", other: "# blocking findings" }),
  acceptedBlockingFinding: (count: number) =>
    plural(count, { one: "# accepted blocking finding", other: "# accepted blocking findings" }),
  warning: (count: number) => plural(count, { one: "# warning", other: "# warnings" }),
  file: (count: number) => plural(count, { one: "# file", other: "# files" }),
  issue: (count: number) => plural(count, { one: "# issue", other: "# issues" }),
  model: (count: number) => plural(count, { one: "# model", other: "# models" }),
  round: (count: number) => plural(count, { one: "# round", other: "# rounds" }),
  second: (count: number) => plural(count, { one: "# second", other: "# seconds" }),
  minute: (count: number) => plural(count, { one: "# minute", other: "# minutes" }),
  hour: (count: number) => plural(count, { one: "# hour", other: "# hours" }),
  day: (count: number) => plural(count, { one: "# day", other: "# days" }),
} as const;
