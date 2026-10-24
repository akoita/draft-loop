import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { ApiAuthOptions } from "./request-auth.js";

/** The one public route under `/v1` besides health: the web screen asks it how to sign in. */
export const authConfigPath = "/v1/auth/config";

const authConfigSchema = z
  .discriminatedUnion("mode", [
    z.object({ mode: z.literal("owner") }).describe("Sign in with the deployment's owner token."),
    z
      .object({
        mode: z.literal("oidc"),
        issuer: z.string().describe("The identity provider's issuer."),
        clientId: z.string().describe("The web screen's public client id at that provider."),
      })
      .describe("Sign in through the identity provider, with the authorization code and PKCE."),
  ])
  .meta({ id: "AuthConfig" });

export type AuthConfig = z.infer<typeof authConfigSchema>;

/** What the screen needs to sign in; never the audience, keys or any secret. */
export function authConfig(auth: ApiAuthOptions): AuthConfig {
  return auth.mode === "owner"
    ? { mode: "owner" }
    : { mode: "oidc", issuer: auth.issuer, clientId: auth.webClientId };
}

/** Tells the web screen how this deployment signs people in (ADR 0011, D6 and D9). */
export function registerAuthConfigRoutes(app: FastifyInstance, auth: ApiAuthOptions): void {
  const config = authConfig(auth);
  app.withTypeProvider<ZodTypeProvider>().get(
    authConfigPath,
    {
      schema: {
        summary: "How the web screen signs people in",
        security: [],
        response: { 200: authConfigSchema },
      },
    },
    async () => config,
  );
}
