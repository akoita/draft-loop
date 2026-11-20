import { ApiConfigError } from "./config.js";

/**
 * Each member's daily allowance of live voice (the live career interview's speech), counted in
 * seconds of their voice streamed to speech-to-text. The live route refuses a new conversation
 * once the day's allowance is spent, and ends a running one when it runs out.
 */

/** The store of today's seconds per member; storage-postgres shares it across API instances. */
export interface LiveVoiceUsage {
  secondsToday(memberId: string, now: Date): Promise<number>;
  addSeconds(memberId: string, seconds: number, now: Date): Promise<void>;
}

export interface LiveVoiceAllowance {
  readonly usage: LiveVoiceUsage;
  readonly minutesPerDay: number;
  readonly now?: () => Date;
}

/** Thirty minutes a day: one long topic or a few short ones, about US$0.50 of speech at most. */
export const defaultLiveMinutesPerDay = 30;
const maximumLiveMinutesPerDay = 600;

/** Reads `DRAFT_LOOP_LIVE_MINUTES_PER_DAY`, whole minutes from 1 to 600; unset is 30. */
export function readLiveMinutesPerDay(env: NodeJS.ProcessEnv): number {
  const text = (env.DRAFT_LOOP_LIVE_MINUTES_PER_DAY ?? "").trim();
  if (text === "") return defaultLiveMinutesPerDay;
  const minutes = Number(text);
  if (!/^\d+$/u.test(text) || minutes < 1 || minutes > maximumLiveMinutesPerDay) {
    throw new ApiConfigError(
      `DRAFT_LOOP_LIVE_MINUTES_PER_DAY must be whole minutes from 1 to ${maximumLiveMinutesPerDay}.`,
    );
  }
  return minutes;
}

/** The seconds a member has left today; 0 when the allowance is spent. */
export async function liveSecondsLeft(
  allowance: LiveVoiceAllowance,
  memberId: string,
): Promise<number> {
  const now = allowance.now?.() ?? new Date();
  const used = await allowance.usage.secondsToday(memberId, now);
  return Math.max(0, allowance.minutesPerDay * 60 - used);
}

/**
 * Today's seconds in this API instance's memory, like the request rate limits: owner-token mode
 * and tests use it; sign-in mode uses the shared store.
 */
export function createMemoryLiveVoiceUsage(): LiveVoiceUsage {
  let day = "";
  const seconds = new Map<string, number>();
  const today = (now: Date) => {
    const current = now.toISOString().slice(0, 10);
    if (current !== day) {
      day = current;
      seconds.clear();
    }
  };
  return {
    async secondsToday(memberId, now) {
      today(now);
      return seconds.get(memberId) ?? 0;
    },
    async addSeconds(memberId, added, now) {
      today(now);
      if (!Number.isFinite(added) || added <= 0) return;
      seconds.set(memberId, (seconds.get(memberId) ?? 0) + Math.ceil(added));
    },
  };
}
