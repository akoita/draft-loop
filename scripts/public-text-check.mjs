#!/usr/bin/env node

// Scans text bound for this public repository (issues, PR bodies, comments, reviews, commit
// messages) for private data. It reports the rule and the line, never the matched value, because
// workflow logs are public. Usage:
//   node scripts/public-text-check.mjs [--strict] [file ...]   reads the files, or stdin
//   node scripts/public-text-check.mjs --github-event          reads $GITHUB_EVENT_PATH
// A private deny-list (one term per line or comma) comes from $PUBLIC_TEXT_DENYLIST.

import console from "node:console";
import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const allowedEmailDomains = [
  "example.test",
  "example.com",
  "example.org",
  "example.net",
  "users.noreply.github.com",
  "noreply.github.com",
];
const allowedEmails = ["noreply@anthropic.com", "git@github.com"];

function isAllowedEmail(value) {
  const email = value.toLowerCase();
  if (allowedEmails.includes(email)) return true;
  const domain = email.slice(email.lastIndexOf("@") + 1);
  return (
    domain.endsWith(".example") ||
    domain.endsWith(".test") ||
    domain.endsWith(".invalid") ||
    domain === "localhost" ||
    allowedEmailDomains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`))
  );
}

function isPublicIpv4(value) {
  const octets = value.split(".").map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  // Documentation ranges (RFC 5737) are safe to show.
  if (value.startsWith("192.0.2.") || value.startsWith("198.51.100.")) return false;
  if (value.startsWith("203.0.113.")) return false;
  return true;
}

/** Each rule matches one kind of private value. `keep` returns true for a harmless match. */
export const PUBLIC_TEXT_RULES = [
  {
    name: "Identifier (UUID)",
    regex: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu,
    keep: (value) => /^[0-]+$/u.test(value),
  },
  {
    name: "Trace or request id (32 hex)",
    regex: /\b[0-9a-f]{32}\b/giu,
  },
  {
    name: "Email address or service account",
    regex: /\b[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b/gu,
    keep: isAllowedEmail,
  },
  {
    name: "Cloud Storage bucket",
    regex: /\bgs:\/\/[a-z0-9][a-z0-9._-]{2,}/giu,
  },
  {
    name: "Cloud Run host",
    regex: /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.run\.app\b/giu,
  },
  {
    name: "Cloud project path",
    regex: /\bprojects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\b/gu,
  },
  {
    name: "Cloud SQL connection name",
    regex: /\b[a-z][a-z0-9-]{4,28}[a-z0-9]:[a-z]+-[a-z]+\d:[a-z0-9-]+\b/gu,
  },
  {
    name: "Public IP address",
    regex: /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/gu,
    keep: (value) => !isPublicIpv4(value),
  },
  {
    name: "Phone number",
    regex: /(?<![\w.+])(?:\+\d{2,3}(?:[\s.-]?\d{1,4}){3,6}|0[1-9](?:[\s.-]?\d{2}){4})(?![\w.])/gu,
  },
];

/** Strict rules, for text an agent drafts from production data: no quoted passages at all. */
export const STRICT_RULES = [
  { name: "Quoted passage (blockquote)", regex: /^\s*>\s*\S.{40,}$/gmu },
  { name: "Quoted passage", regex: /["“«][^"”»\n]{40,}["”»]/gu },
];

export function parseDenylist(raw = "") {
  return raw
    .split(/[\n,]/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3);
}

/**
 * Returns one finding per rule hit: `{ rule, line, field }`. The matched value is deliberately
 * absent, so a caller cannot echo it into a public log.
 */
export function scanPublicText(text, { strict = false, denylist = [], field = "text" } = {}) {
  const findings = [];
  const lines = text.split("\n");
  const rules = strict ? [...PUBLIC_TEXT_RULES, ...STRICT_RULES] : PUBLIC_TEXT_RULES;
  const lowered = denylist.map((term) => term.toLowerCase());
  lines.forEach((line, index) => {
    for (const rule of rules) {
      for (const match of line.matchAll(rule.regex)) {
        if (rule.keep?.(match[0])) continue;
        findings.push({ rule: rule.name, line: index + 1, field });
        break;
      }
    }
    const lowerLine = line.toLowerCase();
    if (lowered.some((term) => lowerLine.includes(term))) {
      findings.push({ rule: "Private deny-list term", line: index + 1, field });
    }
  });
  return findings;
}

/** The user-written text fields of a GitHub webhook event. */
export function eventTexts(event) {
  const fields = [
    ["issue title", event.issue?.title],
    ["issue body", event.issue?.body],
    ["pull request title", event.pull_request?.title],
    ["pull request body", event.pull_request?.body],
    ["comment", event.comment?.body],
    ["review", event.review?.body],
  ];
  return fields
    .filter(([, text]) => typeof text === "string" && text.length > 0)
    .map(([field, text]) => ({ field, text }));
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const strict = argv.includes("--strict");
  const denylist = parseDenylist(env.PUBLIC_TEXT_DENYLIST);
  const files = argv.filter((arg) => !arg.startsWith("--"));
  let inputs;
  if (argv.includes("--github-event")) {
    inputs = eventTexts(JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")));
  } else if (files.length > 0) {
    inputs = files.map((file) => ({ field: file, text: readFileSync(file, "utf8") }));
  } else {
    inputs = [{ field: "stdin", text: readStdin() }];
  }
  const findings = inputs.flatMap(({ field, text }) =>
    scanPublicText(text, { strict, denylist, field }),
  );
  const annotate = env.GITHUB_ACTIONS === "true" ? "::error::" : "";
  for (const finding of findings) {
    console.error(`${annotate}${finding.rule} in ${finding.field}, line ${finding.line}`);
  }
  if (findings.length > 0) {
    console.error(
      `public-text-check: ${findings.length} possible private value(s). Remove them before posting; the values are not printed.`,
    );
    return 1;
  }
  console.log(`public-text-check: no private values found in ${inputs.length} text(s).`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
