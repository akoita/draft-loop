import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApplicationIo, ApplicationService } from "./index.js";
import { configureWorkspaceWritingPolicy } from "./local.js";

/**
 * The writing policy every new real workspace starts with. It is written in the
 * ordinary directive format, so a candidate can read it, replace it with
 * `policy activate`, and see its version recorded on every run.
 */
export const defaultWritingPolicyContent = `# Default CV writing policy

DraftLoop applies this policy to new workspaces. Edit it to make it yours.

Tone: professional
Verbosity: concise
Page target: two-page
Anti-formulaic defaults: enabled

## Rules

- No em dashes.
- State facts exactly as the sources do. Do not round up, exaggerate, or add numbers the sources do not contain.
- Distinguish employment, consulting assignments, training, certifications, open-source work and personal projects, and attribute client work to the employer that placed the candidate.
- Keep every certification listed in the sources unless the candidate removes it; reorder them for relevance.
- Lead with the most relevant recent work for the target role.
- Prefer the job post's own names for skills and section headings where that is accurate.
- Write accomplishment bullets that say what was built or changed and how, not lists of technologies.
- Leave out personal circumstances such as health, family, salary and reasons for leaving a job.
`;

/** Activates the default policy in an initialized workspace, leaving no temporary file behind. */
export async function activateDefaultWritingPolicy(
  root: string,
  io?: ApplicationIo,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "draft-loop-default-policy-"));
  try {
    const sourcePath = join(directory, "default-writing-policy.md");
    await writeFile(sourcePath, defaultWritingPolicyContent, "utf8");
    await configureWorkspaceWritingPolicy({ root, sourcePath, activate: true }, io);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Wraps an application service so newly initialized real workspaces start with
 * the default writing policy. Fixture and demo workspaces, and workspaces that
 * already exist, are left exactly as they were.
 */
export function withDefaultWritingPolicy<Service extends ApplicationService>(
  service: Service,
): Service {
  return {
    ...service,
    initialize: async (command, io) => {
      const descriptor = await service.initialize(command, io);
      if (descriptor.fixtureMode) return descriptor;
      await activateDefaultWritingPolicy(command.root, io);
      return service.readWorkspace(command.root);
    },
  };
}
