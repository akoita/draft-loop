import type { SqlSession } from "./sql-client.js";

/**
 * The live voice interview's daily use across the deployment: seconds of each member's voice
 * streamed to speech-to-text, per UTC day. Every API instance reads the same counts.
 */
export interface LiveVoiceUsage {
  readonly secondsToday: (memberId: string, now: Date) => Promise<number>;
  /** Adds whole seconds; the first add of a day also sweeps rows that are no longer needed. */
  readonly addSeconds: (memberId: string, seconds: number, now: Date) => Promise<void>;
}

export class LiveVoiceUsageError extends Error {
  override readonly name = "LiveVoiceUsageError";
}

function utcDay(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new LiveVoiceUsageError("A clock must be a valid date.");
  return now.toISOString().slice(0, 10);
}

function memberKey(memberId: string): string {
  if (memberId.length < 1 || memberId.length > 128) {
    throw new LiveVoiceUsageError("A member id must be 1 to 128 characters.");
  }
  return memberId;
}

export function createLiveVoiceUsage(client: SqlSession): LiveVoiceUsage {
  let sweptDay = "";
  return {
    secondsToday: async (memberId, now) => {
      const [row] = await client.query(
        "SELECT seconds FROM live_voice_seconds WHERE day = $1 AND member_id = $2",
        [utcDay(now), memberKey(memberId)],
      );
      return Number(row?.seconds ?? 0);
    },
    addSeconds: async (memberId, seconds, now) => {
      if (!Number.isFinite(seconds) || seconds < 0) {
        throw new LiveVoiceUsageError("Seconds must be a finite number of 0 or more.");
      }
      const whole = Math.ceil(seconds);
      if (whole === 0) return;
      const day = utcDay(now);
      await client.query(
        `INSERT INTO live_voice_seconds (day, member_id, seconds) VALUES ($1, $2, $3)
         ON CONFLICT (day, member_id) DO UPDATE
           SET seconds = live_voice_seconds.seconds + EXCLUDED.seconds`,
        [day, memberKey(memberId), whole],
      );
      if (sweptDay === day) return;
      sweptDay = day;
      await client.query("DELETE FROM live_voice_seconds WHERE day < $1::date - 1", [day]);
    },
  };
}
