import type { ApiSchemas } from "./api-client.js";

export type WritingPolicy = ApiSchemas["WritingPolicy"];

/** The API's limit on a policy's text, in UTF-8 bytes. */
export const writingPolicyLimitBytes = 64 * 1024;

/** Why the text cannot be saved as the policy, or `undefined` when it can. */
export function policyTextProblem(text: string): string | undefined {
  if (text.trim() === "") return "Write the policy before saving it.";
  if (new TextEncoder().encode(text).byteLength > writingPolicyLimitBytes)
    return "The writing policy is larger than 64 KiB; shorten it.";
  return undefined;
}

/** One line on the policy runs follow. */
export function policyStatus(policy: WritingPolicy | undefined): string {
  if (policy === undefined) return "No writing policy yet: runs follow the built-in guidance only.";
  return `Runs follow version ${policy.version}, saved ${policy.createdAt.slice(0, 10)}.`;
}

/** Whether the text differs from the saved policy, so saving would make a new version. */
export function policyChanged(policy: WritingPolicy | undefined, text: string): boolean {
  return text.trim() !== (policy?.content ?? "").trim();
}
