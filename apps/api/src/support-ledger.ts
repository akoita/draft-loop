import type { SupportUsageLedger } from "@draft-loop/support";

/** The deployment-wide store behind the shared ledger; storage-postgres implements it. */
export interface SharedSupportUsage {
  questionsToday(memberId: string, now: Date): Promise<number>;
  countQuestion(memberId: string, now: Date): Promise<void>;
  costTodayUsd(now: Date): Promise<number>;
  addCost(estimatedUsd: number, now: Date): Promise<void>;
}

const minuteMs = 60_000;

/**
 * Each member's questions in the last minute, in this instance's memory. The burst limit stops a
 * script hammering one instance; the daily limits, shared across instances, bound the rest.
 */
function createMinuteWindows(now: () => Date) {
  const asked = new Map<string, number[]>();
  let lastSweep = 0;
  const recent = (memberId: string, at: number) =>
    (asked.get(memberId) ?? []).filter((time) => at - time < minuteMs);
  return {
    count(memberId: string): number {
      const at = now().getTime();
      if (at - lastSweep >= minuteMs) {
        for (const [member, times] of asked) {
          if (times.every((time) => at - time >= minuteMs)) asked.delete(member);
        }
        lastSweep = at;
      }
      return recent(memberId, at).length;
    },
    add(memberId: string): void {
      const at = now().getTime();
      asked.set(memberId, [...recent(memberId, at), at]);
    },
  };
}

/**
 * Today's use in this API instance's memory, like the request rate limits (`rate-limit.ts`): each
 * instance holds its own count, which resets at the UTC day and on restart. Owner-token mode and
 * tests use it; sign-in mode uses the shared ledger.
 */
export function createMemorySupportLedger(now: () => Date = () => new Date()): SupportUsageLedger {
  const minute = createMinuteWindows(now);
  let day = "";
  let costUsd = 0;
  const questions = new Map<string, number>();
  const today = () => {
    const current = now().toISOString().slice(0, 10);
    if (current !== day) {
      day = current;
      costUsd = 0;
      questions.clear();
    }
  };
  return {
    async questionsLastMinute(memberId) {
      return minute.count(memberId);
    },
    async questionsToday(memberId) {
      today();
      return questions.get(memberId) ?? 0;
    },
    async costTodayUsd() {
      today();
      return costUsd;
    },
    async countQuestion(memberId) {
      today();
      minute.add(memberId);
      questions.set(memberId, (questions.get(memberId) ?? 0) + 1);
    },
    async record(entry) {
      today();
      costUsd += entry.estimatedUsd ?? 0;
    },
  };
}

/**
 * The daily counts in the deployment-wide store, so a restart or a second instance never resets
 * a member's questions or the day's spend; the burst window stays in memory.
 */
export function createSharedSupportLedger(
  store: SharedSupportUsage,
  now: () => Date = () => new Date(),
): SupportUsageLedger {
  const minute = createMinuteWindows(now);
  return {
    async questionsLastMinute(memberId) {
      return minute.count(memberId);
    },
    questionsToday: (memberId) => store.questionsToday(memberId, now()),
    costTodayUsd: () => store.costTodayUsd(now()),
    async countQuestion(memberId) {
      minute.add(memberId);
      await store.countQuestion(memberId, now());
    },
    record: (entry) => store.addCost(entry.estimatedUsd ?? 0, now()),
  };
}
