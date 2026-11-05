import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { sendError } from "./errors.js";

/** A route that fails the way Postgres does, as node-postgres reports it. */
async function failingWith(error: Record<string, unknown>) {
  const logs: unknown[] = [];
  const app = Fastify({
    logger: { level: "warn", stream: { write: (line: string) => logs.push(JSON.parse(line)) } },
  });
  app.setErrorHandler(sendError);
  app.put("/decision", async () => {
    throw Object.assign(new Error("insert violates foreign key constraint"), error);
  });
  const response = await app.inject({ method: "PUT", url: "/decision" });
  await app.close();
  return { response, logs };
}

describe("database errors", () => {
  it("answers a missing parent row with a retryable 409 and logs only the constraint (#2210)", async () => {
    const { response, logs } = await failingWith({
      code: "23503",
      constraint: "decisions_artifact_id_fkey",
      detail: "Key (artifact_id)=(artifact-secret) is not present",
    });

    expect(response.statusCode).toBe(409);
    expect(response.headers["retry-after"]).toBe("1");
    expect(response.json().error.code).toBe("not_ready");
    expect(JSON.stringify(logs)).toContain("decisions_artifact_id_fkey");
    expect(JSON.stringify(logs)).not.toContain("artifact-secret");
  });

  it("still answers any other database failure with a 500 that names the constraint", async () => {
    const { response, logs } = await failingWith({ code: "23505", constraint: "runs_pkey" });

    expect(response.statusCode).toBe(500);
    expect(JSON.stringify(logs)).toContain("runs_pkey");
  });
});
