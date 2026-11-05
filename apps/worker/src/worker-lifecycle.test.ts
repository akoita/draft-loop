import type { RunWorkerOptions } from "@draft-loop/run-queue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BriefExtractionHandlerOptions } from "./brief-extraction-handler.js";
import type { ProfileDerivationHandlerOptions } from "./profile-derivation-handler.js";
import type { RunJobHandlerOptions } from "./run-job-handler.js";
import { startWorker, stopOnSignals } from "./worker.js";

/** Each job handler settles when the test releases it, so a job can be held in flight. */
const queue = vi.hoisted(() => ({
  stop: vi.fn(async (_options?: { graceMs?: number }) => undefined),
  startRunWorker: vi.fn(),
  release: [] as ((fail?: boolean) => void)[],
}));

const held = (name: string) => async () => {
  await new Promise<void>((resolve, reject) =>
    queue.release.push((fail) => (fail === true ? reject(new Error("Job failed.")) : resolve())),
  );
  return name;
};

vi.mock("@draft-loop/run-queue", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  startRunWorker: queue.startRunWorker,
}));
vi.mock("./run-job-handler.js", () => ({ createRunJobHandler: () => held("run") }));
vi.mock("./brief-extraction-handler.js", () => ({
  createBriefExtractionHandler: () => held("brief"),
}));
vi.mock("./profile-derivation-handler.js", () => ({
  createProfileDerivationHandler: () => held("profile"),
}));

type Handler = (job: unknown, control?: unknown) => Promise<unknown>;
interface Handlers {
  readonly briefExtraction?: Handler;
  readonly profileDerivation?: Handler;
}

const options = {
  queue: { connectionString: "postgres://placeholder" } as RunWorkerOptions,
  runs: {} as RunJobHandlerOptions,
};

beforeEach(() => {
  queue.startRunWorker.mockImplementation(async () => ({ stop: queue.stop }));
});

afterEach(() => {
  vi.clearAllMocks();
  queue.release.length = 0;
});

function startedWith(): { handle: Handler; handlers: Handlers } {
  const [, handle, handlers] = queue.startRunWorker.mock.calls[0] as [unknown, Handler, Handlers];
  return { handle, handlers };
}

describe("startWorker", () => {
  it("takes run jobs only when given no brief or profile options", async () => {
    await startWorker(options);

    expect(queue.startRunWorker).toHaveBeenCalledWith(options.queue, expect.any(Function), {});
  });

  it("takes briefs and profiles too when given their options", async () => {
    await startWorker({
      ...options,
      briefs: {} as BriefExtractionHandlerOptions,
      profiles: {} as ProfileDerivationHandlerOptions,
    });

    const { handlers } = startedWith();
    expect(Object.keys(handlers).sort()).toEqual(["briefExtraction", "profileDerivation"]);
  });

  it("is idle only while no job of any kind runs, counting from the last one's end", async () => {
    let clock = 1_000;
    const worker = await startWorker(
      {
        ...options,
        briefs: {} as BriefExtractionHandlerOptions,
        profiles: {} as ProfileDerivationHandlerOptions,
      },
      () => clock,
    );
    const { handle, handlers } = startedWith();

    clock = 1_500;
    expect(worker.idleMs()).toBe(500);

    const run = handle({ runId: "run-1" }, {});
    const brief = handlers.briefExtraction?.({ briefId: "brief-1" });
    expect(worker.idleMs()).toBeUndefined();

    clock = 2_000;
    queue.release[0]?.();
    await expect(run).resolves.toBe("run");
    expect(worker.idleMs()).toBeUndefined();

    clock = 3_000;
    queue.release[1]?.();
    await expect(brief).resolves.toBe("brief");
    clock = 3_250;
    expect(worker.idleMs()).toBe(250);

    const profile = handlers.profileDerivation?.({ profileId: "profile-1" }, {});
    expect(worker.idleMs()).toBeUndefined();
    queue.release[2]?.();
    await expect(profile).resolves.toBe("profile");
    expect(worker.idleMs()).toBe(0);
  });

  it("counts a failed job as ended", async () => {
    let clock = 0;
    const worker = await startWorker(options, () => clock);
    const { handle } = startedWith();

    const run = handle({ runId: "run-1" }, {});
    clock = 400;
    queue.release[0]?.(true);
    await expect(run).rejects.toThrow("Job failed.");
    clock = 500;

    expect(worker.idleMs()).toBe(100);
  });

  it("stops the queue's worker with the options given", async () => {
    const worker = await startWorker(options);

    await worker.stop({ graceMs: 5_000 });

    expect(queue.stop).toHaveBeenCalledWith({ graceMs: 5_000 });
  });
});

describe("stopOnSignals", () => {
  it("stops once on the first signal, with the grace period, then reports", async () => {
    const stop = vi.fn(async () => undefined);
    const onStopped = vi.fn();
    const signals: NodeJS.Signals[] = ["SIGUSR2", "SIGWINCH"];
    const remove = stopOnSignals({ stop }, { graceMs: 2_000, signals, onStopped });

    process.emit("SIGUSR2", "SIGUSR2");
    process.emit("SIGWINCH", "SIGWINCH");
    await vi.waitFor(() => expect(onStopped).toHaveBeenCalledWith());
    remove();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledWith({ graceMs: 2_000 });
  });

  it("reports a failed stop, giving no grace period when none is set", async () => {
    const failure = new Error("Stop failed.");
    const stop = vi.fn(async () => {
      throw failure;
    });
    const onStopped = vi.fn();
    const remove = stopOnSignals({ stop }, { signals: ["SIGUSR2"], onStopped });

    process.emit("SIGUSR2", "SIGUSR2");
    await vi.waitFor(() => expect(onStopped).toHaveBeenCalledWith(failure));
    remove();

    expect(stop).toHaveBeenCalledWith({});
  });

  it("listens for SIGTERM and SIGINT by default, and stops listening when removed", () => {
    const before = {
      term: process.listenerCount("SIGTERM"),
      int: process.listenerCount("SIGINT"),
    };
    const remove = stopOnSignals({ stop: async () => undefined }, { onStopped: () => undefined });

    expect(process.listenerCount("SIGTERM")).toBe(before.term + 1);
    expect(process.listenerCount("SIGINT")).toBe(before.int + 1);
    remove();
    expect(process.listenerCount("SIGTERM")).toBe(before.term);
    expect(process.listenerCount("SIGINT")).toBe(before.int);
  });
});
