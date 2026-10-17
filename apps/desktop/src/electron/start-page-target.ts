import {
  type ApplicationIo,
  type ApplicationService,
  activateWritingPolicyContent,
  defaultWritingPolicyContent,
  type WorkspaceDescriptor,
} from "@draft-loop/application";

import { readPolicySelectorValues, setPolicySelectorValue } from "../writing-policy-directives.js";

/*
 * The length chosen on the Start confirmation (#1366). The author writes to the writing policy's
 * page target (#1364), so the choice is saved as that target before the run begins: the run then
 * records the exact policy version it used, and later runs keep the choice. Only a change is
 * saved; picking the target the policy already has leaves it untouched.
 */

export type StartPageTarget = "one-page" | "two-page";

/** The policy text with its page target set, or undefined when it already has that target. */
export function policyContentWithPageTarget(
  content: string,
  pageTarget: StartPageTarget,
): string | undefined {
  const current = readPolicySelectorValues(content).pageTarget?.toLowerCase();
  return current === pageTarget
    ? undefined
    : setPolicySelectorValue(content, "pageTarget", pageTarget);
}

/** Save the chosen target as a new active policy version when it differs; returns the new descriptor. */
export async function applyStartPageTarget(
  service: Pick<ApplicationService, "configureWritingPolicy" | "getWritingPolicy">,
  root: string,
  pageTarget: StartPageTarget,
  io?: ApplicationIo,
): Promise<WorkspaceDescriptor | undefined> {
  if (service.getWritingPolicy === undefined) {
    throw new Error("Reading the writing policy is unavailable.");
  }
  const current = await service.getWritingPolicy({ root, includeContent: true });
  const content = current === undefined ? defaultWritingPolicyContent : current.policy?.content;
  if (typeof content !== "string") throw new Error("The writing policy could not be read.");
  const next = policyContentWithPageTarget(content, pageTarget);
  if (next === undefined) return undefined;
  let descriptor: WorkspaceDescriptor | undefined;
  await activateWritingPolicyContent(root, next, io, async (command, commandIo) => {
    descriptor = await service.configureWritingPolicy(command, commandIo);
    return descriptor;
  });
  return descriptor;
}
