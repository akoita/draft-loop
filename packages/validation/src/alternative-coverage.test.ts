import { describe, expect, it } from "vitest";
import { alternativeRequirementBranches } from "./alternative-coverage.js";

describe("permitted alternative branches", () => {
  it.each([
    [
      "Experience with Prometheus or OpenTelemetry.",
      ["Experience with Prometheus.", "Experience with OpenTelemetry."],
    ],
    [
      "Production experience with Prometheus, OpenTelemetry, or Datadog.",
      [
        "Production experience with Prometheus.",
        "Production experience with OpenTelemetry.",
        "Production experience with Datadog.",
      ],
    ],
    [
      "Experience with Prometheus, OpenTelemetry or Datadog.",
      ["Experience with Prometheus.", "Experience with OpenTelemetry.", "Experience with Datadog."],
    ],
    ["Kubernetes or Nomad experience.", ["Kubernetes experience.", "Nomad experience."]],
    ["python or go for services", ["python for services", "go for services"]],
    ["Node.js or Deno tooling.", ["Node.js tooling.", "Deno tooling."]],
  ] as const)("keeps conditions outside the enumeration for %s", (requirement, branches) => {
    expect(alternativeRequirementBranches(requirement)).toEqual(branches);
  });

  it.each([
    "Experience with Prometheus.",
    "Experience with Prometheus and OpenTelemetry.",
    "Experience with Prometheus, OpenTelemetry, and Datadog.",
    "Observability tooling and/or tracing.",
    "Experience with Prometheus or OpenTelemetry or Datadog.",
    "Experience with Google Cloud or AWS.",
    "Experience with Prometheus or Google Cloud.",
    "Strong Python or Go skills.",
    "or",
    "",
  ])("leaves unrecognized phrasing to ordinary matching: %s", (requirement) => {
    expect(alternativeRequirementBranches(requirement)).toBeUndefined();
  });

  it("does not enumerate more alternatives than the closed grammar allows", () => {
    expect(
      alternativeRequirementBranches("Experience with a, b, c, d, e, f, or g."),
    ).toBeUndefined();
  });
});
