import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * Set by `pnpm server:test` once the local stack is up (docs/operations/local-server-stack.md);
 * skipped otherwise. Fictional people from the stack's Keycloak realm sign in to the API in sign-in
 * mode, and each sees only their own organisation's workspaces (ADR 0011, D6).
 */
const apiUrl = process.env.DRAFT_LOOP_TEST_OIDC_API_URL;
const issuerUrl = process.env.DRAFT_LOOP_TEST_OIDC_ISSUER_URL;
const operatorToken = process.env.DRAFT_LOOP_TEST_API_OWNER_TOKEN ?? "";

const realm = "draft-loop-local";

/** A token from the realm's smoke-only client, which alone allows the password grant. */
async function signIn(username: string, password: string): Promise<string> {
  const response = await fetch(`${issuerUrl}/realms/${realm}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "draft-loop-local-smoke",
      username,
      password,
      scope: "openid email",
    }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function call(token: string, method: string, path: string, body?: object) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? {} : (JSON.parse(text) as unknown) };
}

describe.runIf(apiUrl !== undefined && issuerUrl !== undefined)(
  "sign-in on the local stack",
  () => {
    // The organisations persist with the stack's data; workspaces are fresh each run.
    const suffix = randomUUID().slice(0, 8);

    it("tells the web screen how to sign in", async () => {
      const response = await fetch(`${apiUrl}/v1/auth/config`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        mode: "oidc",
        issuer: `${issuerUrl}/realms/${realm}`,
        clientId: "draft-loop-web",
      });
    });

    it("creates two organisations with the operator token, which members cannot use", async () => {
      for (const [organisationId, firstOwnerEmail] of [
        ["smoke-org-a", "ada@org-a.example"],
        ["smoke-org-b", "ben@org-b.example"],
      ] as const) {
        const created = await call(operatorToken, "POST", "/v1/operator/organisations", {
          organisationId,
          name: `Smoke ${organisationId}`,
          firstOwnerEmail,
        });
        // A stack that kept its data already has them.
        expect([201, 409]).toContain(created.status);
      }
      const ada = await signIn("ada", "local-stack-password-a");
      const refused = await call(ada, "POST", "/v1/operator/organisations", {
        organisationId: "smoke-org-c",
        name: "Smoke org c",
        firstOwnerEmail: "ada@org-a.example",
      });
      expect(refused.status).toBe(401);
    });

    it("signs each member in to their own organisation and keeps the other's workspaces out of reach", async () => {
      const ada = await signIn("ada", "local-stack-password-a");
      const ben = await signIn("ben", "local-stack-password-b");
      expect(await call(ada, "GET", "/v1/me")).toMatchObject({
        status: 200,
        body: { kind: "member", organisationId: "smoke-org-a", role: "owner" },
      });
      expect(await call(ben, "GET", "/v1/me")).toMatchObject({
        status: 200,
        body: { kind: "member", organisationId: "smoke-org-b", role: "owner" },
      });

      const workspacePath = `/v1/workspaces/sign-in-${suffix}`;
      expect(await call(ada, "PUT", workspacePath, { fixtureMode: true })).toMatchObject({
        status: 201,
      });
      expect((await call(ada, "GET", workspacePath)).status).toBe(200);
      expect((await call(ben, "GET", workspacePath)).status).toBe(404);
      const members = (await call(ben, "GET", "/v1/organisation/members")).body as {
        readonly organisationId: string;
        readonly members: readonly { readonly email: string }[];
      };
      expect(members.organisationId).toBe("smoke-org-b");
      expect(members.members.map((member) => member.email)).toEqual(["ben@org-b.example"]);
    });

    it("refuses a person whose email is not verified, and the owner token outside operator routes", async () => {
      const ada = await signIn("ada", "local-stack-password-a");
      const invited = await call(ada, "POST", "/v1/organisation/members", {
        email: "una@org-a.example",
        role: "member",
      });
      expect([201, 409]).toContain(invited.status);
      const una = await signIn("una", "local-stack-password-u");
      expect((await call(una, "GET", "/v1/me")).status).toBe(403);
      expect((await call(operatorToken, "GET", "/v1/me")).status).toBe(401);
    });
  },
);
