import { describe, expect, it } from "vitest";
import { DeploymentAuthModeConfigError, readDeploymentAuthMode } from "./deployment-auth-mode.js";

describe("readDeploymentAuthMode", () => {
  it("is owner mode unless the deployment says oidc", () => {
    expect(readDeploymentAuthMode({})).toBe("owner");
    expect(readDeploymentAuthMode({ DRAFT_LOOP_AUTH_MODE: "" })).toBe("owner");
    expect(readDeploymentAuthMode({ DRAFT_LOOP_AUTH_MODE: "owner" })).toBe("owner");
    expect(readDeploymentAuthMode({ DRAFT_LOOP_AUTH_MODE: "oidc" })).toBe("oidc");
  });

  it("refuses any other mode", () => {
    expect(() => readDeploymentAuthMode({ DRAFT_LOOP_AUTH_MODE: "password" })).toThrow(
      DeploymentAuthModeConfigError,
    );
  });
});
