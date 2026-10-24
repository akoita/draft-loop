import type { ApiSchemas } from "./api-client.js";
import { latestBrief } from "./brief-model.js";
import { latestRunId } from "./run-model.js";

type Application = ApiSchemas["Application"];

/** The brief and run this browser last worked on, so the screen reopens them after a reload. */
export interface Remembered {
  readonly briefId?: string;
  readonly runId?: string;
}

export interface ScreenMemory {
  read(): Remembered;
  rememberBrief(briefId: string): void;
  rememberRun(runId: string): void;
  /** Forgets both, such as when the screen switches to another candidate record. */
  forget(): void;
}

const storageKey = "draft-loop.screen";

/**
 * Keeps the ids in the browser's local storage. They are no secret and the API stays the source
 * of truth; storage can be missing or refuse access, and the screen then starts afresh.
 */
export function createScreenMemory(storage: () => Storage | undefined): ScreenMemory {
  const read = (): Remembered => {
    try {
      const value = JSON.parse(storage()?.getItem(storageKey) ?? "{}") as unknown;
      if (typeof value !== "object" || value === null) return {};
      const { briefId, runId } = value as Record<string, unknown>;
      return {
        ...(typeof briefId === "string" ? { briefId } : {}),
        ...(typeof runId === "string" ? { runId } : {}),
      };
    } catch {
      return {};
    }
  };
  const write = (next: Remembered) => {
    try {
      storage()?.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Nothing is remembered; the API still holds the work.
    }
  };
  return {
    read,
    rememberBrief: (briefId) => write({ ...read(), briefId }),
    rememberRun: (runId) => write({ ...read(), runId }),
    forget: () => write({}),
  };
}

/** The screen's memory in a browser; nothing is kept where there is no local storage. */
export const screenMemory = createScreenMemory(() => globalThis.localStorage);

/**
 * The brief the screen opens: the application's newest, or the one this browser last worked on.
 * The application lists its briefs and runs; the memory only fills in when it lists none.
 */
export function currentBriefId(
  application: Application | undefined,
  remembered: Remembered,
): string | undefined {
  return (
    (application === undefined ? undefined : latestBrief(application)?.briefId) ??
    remembered.briefId
  );
}

/** The run the screen follows: the application's newest, or the one this browser last followed. */
export function currentRunId(
  application: Application | undefined,
  remembered: Remembered,
): string | undefined {
  return (application === undefined ? undefined : latestRunId(application)) ?? remembered.runId;
}
