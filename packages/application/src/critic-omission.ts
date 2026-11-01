/**
 * The omission review that `cli-critic-v7` adds (#2026): does the CV leave out an accomplishment
 * the evidence supports and the job values? On the 2026-10-30 run of private reference G the
 * critic accepted a one-round draft that recalled 19 of 34 reference accomplishments: the claim
 * review checks what the draft says and the emphasis review what it leads with, and nothing asked
 * what it dropped. A blocking omission makes the round revise instead of ending ready.
 */

/** A supported, job-relevant accomplishment the CV leaves out or reduces to a bare mention. */
export const omittedAccomplishmentCode = "coverage-omitted-accomplishment";

/** The most omission findings one critique may report. */
export const maximumOmissionFindings = 5;

/** The most omission findings one critique may block with; every later one becomes a warning. */
export const maximumBlockingOmissionFindings = 3;

export const omissionReviewInstructions =
  ` Also review omissions: whether the CV leaves out what the evidence supports and the job values. Compare the whole CV with retrievedEvidence, role by role and project by project, and find each accomplishment that the evidence states with its scope, method or result, that serves a central theme (applicationPlan.themes when the input carries the plan, otherwise the job's requirements and responsibilities), and that the CV leaves out or reduces to a bare mention. Report each as a coverage finding with code ${omittedAccomplishmentCode} whose message quotes the accomplishment in the evidence's words (at most 80 characters), names the retrievedEvidence ID, the role or project it belongs to and the theme or requirement id it serves, and gives one concrete move: the role or section that should carry it, and the descriptive detail to shorten when the CV is already at its length target. ` +
  `Severity is error when the accomplishment proves a supported central theme (a plan theme with gap false, or without a plan a requirement of critical or high priority) that the CV shows thinly or not at all, and warning otherwise. Report at most ${maximumOmissionFindings} omission findings, the most job-relevant first. Never report what applicationPlan.cuts drops or compresses, what the job does not ask for, or anything the evidence does not state, and report an omission once: not also as editorial-missing-evidence or as an emphasis finding.`;

/** The most omission findings one `cli-critic-v8` critique may report (#2031). */
export const maximumFocusedOmissionFindings = 8;

/**
 * The focused omission review of `cli-critic-v8` (#2031). On the 2026-11-01 run of private
 * reference G, v7's one-pass comparison of the whole CV with 316 chunks reported one omission as
 * a warning while the draft left out 13 reference accomplishments, 10 of them stated in chunks
 * the plan's own themes cite and cited by the author without their substance. v8 narrows the
 * review to those candidate chunks and asks for an enumeration per chunk, so the critic judges
 * each stated accomplishment rather than scanning for anything missing.
 */
export const focusedOmissionReviewInstructions =
  ` Also review omissions, chunk by chunk: whether the CV leaves out what the evidence supports and the job values. The candidate chunks are the retrievedEvidence chunks that applicationPlan.themes cite in evidenceChunkIds when the input carries the plan, otherwise the chunks achievementPlan names. For each candidate chunk, list every accomplishment it states with its scope, method or result, and decide for each whether the CV states it with that substance, mentions it only, or leaves it out. A citation is not a statement: a claim may cite a chunk without carrying its accomplishment. Report each left-out or bare-mention accomplishment as a coverage finding with code ${omittedAccomplishmentCode} whose message quotes the accomplishment in the evidence's words (at most 80 characters), names the retrievedEvidence ID, the role or project it belongs to and the theme or requirement id it serves, and gives one concrete move: the role or section that should carry it, and the descriptive detail to shorten when the CV is already at its length target. ` +
  `Severity is error when the accomplishment serves a supported central theme (a plan theme with gap false, or without a plan a requirement of critical or high priority), and warning otherwise. Report at most ${maximumFocusedOmissionFindings} omission findings, the most job-relevant first. Never report what applicationPlan.cuts drops or compresses, what the job does not ask for, or anything the evidence does not state, and report an omission once: not also as editorial-missing-evidence or as an emphasis finding.`;

export function isOmissionFindingCode(code: string): boolean {
  return code === omittedAccomplishmentCode;
}

/**
 * Enforce the blocking cap on a parsed critique: the first `maximumBlockingOmissionFindings`
 * omission errors, in the critic's order, keep blocking and every later one becomes a warning, so
 * one critique cannot fill the blockers with omissions. Every other finding is returned untouched.
 */
export function capBlockingOmissions<
  T extends { readonly code: string; readonly severity: string },
>(findings: readonly T[]): readonly T[] {
  let blocking = 0;
  return findings.map((finding) => {
    if (!isOmissionFindingCode(finding.code) || finding.severity !== "error") return finding;
    blocking += 1;
    return blocking <= maximumBlockingOmissionFindings
      ? finding
      : { ...finding, severity: "warning" };
  });
}
