import type { PostgresMigration } from "./migrations.js";

/**
 * The live voice interview's daily use per member, shared by every API instance so a restart or
 * a second instance never resets the daily limit.
 *
 * - `live_voice_seconds`: seconds of a member's voice streamed to speech-to-text per UTC day. It
 *   holds an opaque member id, a date and a number, no words or audio, and rows older than
 *   yesterday are swept.
 * - Rows belong to no tenant: a member id is unique across the deployment.
 */
export const liveVoiceUsageMigration: PostgresMigration = {
  version: 60,
  name: "live voice daily use",
  sql: `
    CREATE TABLE live_voice_seconds (
      day DATE NOT NULL,
      member_id TEXT NOT NULL CHECK (length(member_id) BETWEEN 1 AND 128),
      seconds INTEGER NOT NULL CHECK (seconds > 0),
      PRIMARY KEY (day, member_id)
    );
    ALTER TABLE live_voice_seconds ENABLE ROW LEVEL SECURITY;
    ALTER TABLE live_voice_seconds FORCE ROW LEVEL SECURITY;
    CREATE POLICY deployment_wide ON live_voice_seconds USING (true) WITH CHECK (true);
  `,
};
