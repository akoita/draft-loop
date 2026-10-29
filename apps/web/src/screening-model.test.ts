import { describe, expect, it, vi } from "vitest";

import { type ApiClient, ApiRequestError, type ApiSchemas } from "./api-client.js";
import {
  canReleaseScreening,
  type QuarantinedMaterial,
  quarantinedStatus,
  quarantineRefusal,
  releaseRefusal,
  releaseRequest,
  releaseScreening,
  type ScreeningStatus,
  screeningBadge,
  signalNames,
  sourceStatus,
} from "./screening-model.js";

const flaggedBrief: ScreeningStatus = {
  kind: "job-source",
  briefId: "brief-1",
  sourceId: "job-posting",
  resultId: "result-1",
  verdict: "flagged",
  signals: ["instruction-override", "hidden-text"],
  quarantined: true,
};

const flaggedUpload: ScreeningStatus = {
  kind: "knowledge-source-version",
  knowledgeBaseId: "kb-1",
  sourceId: "source-1",
  sourceVersionId: "version-2",
  resultId: "result-2",
  verdict: "flagged",
  signals: ["role-change"],
  quarantined: true,
};

describe("screening badges", () => {
  it("names the signals in plain words", () => {
    expect(signalNames(["instruction-override", "exfiltration-link", "screener-unavailable"])).toBe(
      "instruction override, link that could send data out, screening unavailable",
    );
  });

  it("shows a quarantined flag with its signals", () => {
    expect(screeningBadge(flaggedBrief)).toEqual({
      kind: "flagged",
      label: "Quarantined: flagged",
      detail: "instruction override, hidden text",
      quarantined: true,
    });
  });

  it("shows an unscreened result as quarantined, and no result as not screened", () => {
    expect(
      screeningBadge({
        ...flaggedBrief,
        verdict: "unscreened",
        signals: ["screener-unavailable"],
      }),
    ).toMatchObject({ kind: "unscreened", label: "Quarantined: not screened", quarantined: true });
    expect(screeningBadge(undefined)).toEqual({
      kind: "none",
      label: "Not screened",
      detail: "",
      quarantined: false,
    });
  });

  it("shows clear text as clear", () => {
    expect(
      screeningBadge({ ...flaggedBrief, verdict: "clear", signals: [], quarantined: false }),
    ).toMatchObject({ kind: "clear", label: "Screened: clear", quarantined: false });
  });

  it("shows a release as released, whatever the verdict was", () => {
    const release = { memberId: "member-1", releasedAt: "2026-10-24T10:00:00.000Z" };
    const flagged = screeningBadge({ ...flaggedBrief, quarantined: false, release });
    const unscreened = screeningBadge({
      ...flaggedBrief,
      verdict: "unscreened",
      signals: ["screener-unavailable"],
      quarantined: false,
      release,
    });

    expect(flagged).toMatchObject({ kind: "released", label: "Released", quarantined: false });
    expect(flagged.detail).toContain("instruction override, hidden text");
    expect(unscreened).toMatchObject({ kind: "released", quarantined: false });
  });

  it("reads a refused run's material like any other status", () => {
    const material: QuarantinedMaterial = {
      kind: "knowledge-source-version",
      knowledgeBaseId: "kb-1",
      sourceId: "source-1",
      sourceVersionId: "version-1",
      resultId: "result-9",
      verdict: "flagged",
      signals: ["hidden-text"],
    };

    expect(screeningBadge(quarantinedStatus(material))).toMatchObject({
      label: "Quarantined: flagged",
      detail: "hidden text",
      quarantined: true,
    });
  });
});

describe("finding a status", () => {
  const statuses = [flaggedBrief, flaggedUpload];

  it("finds a source by its base, id and uploaded version", () => {
    const source = { id: "source-1", knowledgeBaseId: "kb-1", versionId: "version-2" };

    expect(sourceStatus(statuses, source)).toBe(flaggedUpload);
    expect(sourceStatus(statuses, { ...source, versionId: "version-1" })).toBeUndefined();
    expect(sourceStatus(statuses, { ...source, knowledgeBaseId: "kb-2" })).toBeUndefined();
  });
});

describe("who releases", () => {
  it("is the owner token and an organisation's owners and admins", () => {
    const member = (role: "owner" | "admin" | "member"): ApiSchemas["Me"] =>
      ({ kind: "member", role }) as ApiSchemas["Me"];

    expect(canReleaseScreening({ kind: "owner" } as ApiSchemas["Me"])).toBe(true);
    expect(canReleaseScreening(member("owner"))).toBe(true);
    expect(canReleaseScreening(member("admin"))).toBe(true);
    expect(canReleaseScreening(member("member"))).toBe(false);
  });
});

describe("the run refusal", () => {
  const brief: QuarantinedMaterial = {
    kind: "job-source",
    briefId: "brief-1",
    sourceId: "job-posting",
    resultId: "result-1",
    verdict: "flagged",
    signals: ["instruction-override"],
  };
  const upload: QuarantinedMaterial = {
    kind: "knowledge-source-version",
    knowledgeBaseId: "kb-1",
    sourceId: "source-1",
    sourceVersionId: "version-1",
    resultId: "result-2",
    verdict: "unscreened",
    signals: ["screener-unavailable"],
  };

  it("names what is quarantined", () => {
    const refusal = quarantineRefusal(
      new ApiRequestError(409, "material_quarantined", "Quarantined.", [brief, upload]),
    );

    expect(refusal?.message).toBe(
      "This run was not started. Injection screening quarantined the job brief and 1 knowledge source. Release it, or replace it, then start the run again.",
    );
    expect(refusal?.items).toEqual([brief, upload]);
  });

  it("counts several knowledge sources", () => {
    const refusal = quarantineRefusal(
      new ApiRequestError(409, "material_quarantined", "Quarantined.", [
        upload,
        { ...upload, sourceId: "source-2", resultId: "result-3" },
      ]),
    );

    expect(refusal?.message).toContain("quarantined 2 knowledge sources.");
  });

  it("leaves other failures to their own messages", () => {
    expect(quarantineRefusal(new ApiRequestError(409, "stale-version", "Reload."))).toBeUndefined();
    expect(quarantineRefusal(new Error("offline"))).toBeUndefined();
  });
});

describe("releasing", () => {
  it("sends the trimmed reason for the record's result", () => {
    expect(releaseRequest("owner", "result-1", "  Read it; ordinary.  ")).toEqual({
      request: {
        path: { workspaceId: "owner", resultId: "result-1" },
        body: { reason: "Read it; ordinary." },
      },
    });
  });

  it("asks for a reason of 1 to 500 characters", () => {
    expect(releaseRequest("owner", "result-1", "   ")).toEqual({
      problem: "Write why this text is safe to use.",
    });
    expect(releaseRequest("owner", "result-1", "a".repeat(500))).toHaveProperty("request");
    expect(releaseRequest("owner", "result-1", "a".repeat(501))).toEqual({
      problem: "Keep the reason to 500 characters or fewer.",
    });
  });

  it("maps the API's refusals to friendly messages", () => {
    expect(releaseRefusal(new ApiRequestError(403, "forbidden", "x"))).toContain(
      "Only owners and admins",
    );
    expect(releaseRefusal(new ApiRequestError(404, "not_found", "x"))).toContain("not found");
    expect(releaseRefusal(new ApiRequestError(409, "result_superseded", "x"))).toContain(
      "newer screening result",
    );
    expect(releaseRefusal(new ApiRequestError(409, "not_releasable", "x"))).toContain(
      "nothing to release",
    );
    expect(releaseRefusal(new ApiRequestError(400, "invalid_request", "Bad reason."))).toBe(
      "Bad reason.",
    );
    expect(releaseRefusal(new Error("offline"))).toContain("could not be reached");
  });

  it("calls the release route, and sends nothing for a blank reason", async () => {
    const call = vi.fn(async () => ({ resultId: "result-1" }));
    const client = { call } as unknown as ApiClient;

    expect(await releaseScreening(client, "owner", "result-1", " ")).toBe(
      "Write why this text is safe to use.",
    );
    expect(call).not.toHaveBeenCalled();

    expect(
      await releaseScreening(client, "owner", "result-1", "Ordinary posting."),
    ).toBeUndefined();
    expect(call).toHaveBeenCalledWith(
      "POST /v1/workspaces/{workspaceId}/screening/{resultId}/release",
      {
        path: { workspaceId: "owner", resultId: "result-1" },
        body: { reason: "Ordinary posting." },
      },
    );
  });

  it("answers with the friendly message when the API refuses", async () => {
    const client: ApiClient = {
      call: async () => {
        throw new ApiRequestError(409, "result_superseded", "A newer result exists.");
      },
    };

    expect(await releaseScreening(client, "owner", "result-1", "Ordinary.")).toContain(
      "newer screening result",
    );
  });
});
