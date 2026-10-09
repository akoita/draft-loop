import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CliUserError,
  JobRequirementUserError,
  SourceIngestionUserError,
} from "@draft-loop/application";
import { SemanticValidationError } from "@draft-loop/domain";
import { ProviderAdapterError } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";
import { DesktopBridgeError } from "../native.js";
import { createHostErrorLogger } from "./diagnostics.js";

const filenames = ["host-errors.jsonl", "host-errors.1.jsonl"] as const;

function tempUserData(): string {
  return mkdtempSync(join(tmpdir(), "draft-loop-diagnostics-"));
}

function readRecords(
  userDataDirectory: string,
  filename: string,
): readonly Record<string, unknown>[] {
  return readFileSync(join(userDataDirectory, "diagnostics", filename), "utf8")
    .trim()
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("packaged desktop host diagnostics", () => {
  it("records only bounded classifications and safe capability values", () => {
    const userDataDirectory = tempUserData();
    try {
      const logger = createHostErrorLogger(userDataDirectory);
      const error = new ProviderAdapterError(
        "anthropic",
        "authentication",
        "private response /home/candidate/source.pdf secret-token",
        { requestId: "private-request-id" },
      );

      expect(logger.record(error, "review.dispatch")).toBe(true);
      expect(
        logger.record(new DesktopBridgeError("not-found", "private path"), "not-a-capability"),
      ).toBe(true);

      const current = readFileSync(join(userDataDirectory, "diagnostics", filenames[0]), "utf8");
      const records = readRecords(userDataDirectory, filenames[0]);
      expect(records).toHaveLength(2);
      expect(records[0]).toEqual({
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
        capability: "review.dispatch",
        errorClass: "ProviderAdapterError",
        code: "authentication",
      });
      expect(records[1]).toMatchObject({
        capability: "unknown",
        errorClass: "DesktopBridgeError",
        code: "not-found",
      });
      for (const record of records) {
        expect(Object.keys(record).sort()).toEqual([
          "capability",
          "code",
          "errorClass",
          "timestamp",
        ]);
      }
      expect(current).not.toMatch(
        /private response|candidate|source\.pdf|secret-token|private-request-id|private path/u,
      );
      if (process.platform !== "win32") {
        const directoryMode = statSync(join(userDataDirectory, "diagnostics")).mode & 0o777;
        const fileMode =
          statSync(join(userDataDirectory, "diagnostics", filenames[0])).mode & 0o777;
        expect(directoryMode).toBe(0o700);
        expect(fileMode).toBe(0o600);
      }
    } finally {
      rmSync(userDataDirectory, { recursive: true, force: true });
    }
  });

  it("names application user errors by class without their messages", () => {
    const userDataDirectory = tempUserData();
    try {
      const logger = createHostErrorLogger(userDataDirectory);
      logger.record(new JobRequirementUserError("private job words"), "review.dispatch");
      logger.record(new SourceIngestionUserError("/private/source.pdf"), "review.dispatch");
      logger.record(new CliUserError("private user error"), "review.dispatch");

      const current = readFileSync(join(userDataDirectory, "diagnostics", filenames[0]), "utf8");
      expect(
        readRecords(userDataDirectory, filenames[0]).map((record) => record.errorClass),
      ).toEqual(["JobRequirementUserError", "SourceIngestionUserError", "CliUserError"]);
      expect(current).not.toMatch(/private/u);
    } finally {
      rmSync(userDataDirectory, { recursive: true, force: true });
    }
  });

  it("uses only closed class and code labels even for hostile errors", () => {
    const userDataDirectory = tempUserData();
    try {
      const logger = createHostErrorLogger(userDataDirectory);
      const hostile = new Proxy(
        {},
        {
          get() {
            throw new Error("private getter sentinel");
          },
          getPrototypeOf() {
            throw new Error("private prototype sentinel");
          },
        },
      );
      let hostileRecordResult = false;
      expect(() => {
        hostileRecordResult = logger.record(hostile, "private capability sentinel");
      }).not.toThrow();
      expect(hostileRecordResult).toBe(true);
      expect(logger.record(new TypeError("private type text"), "knowledge.readiness")).toBe(true);
      expect(
        logger.record(
          new CustomDiagnosticError("private custom class", "private-name", "private-code"),
          "run.start",
        ),
      ).toBe(true);
      const nativeHostError = Object.assign(new Error("private native host error"), {
        name: "NativeHostError",
        code: "operation-failed",
      });
      expect(logger.record(nativeHostError, "knowledge.readiness")).toBe(true);

      const current = readFileSync(join(userDataDirectory, "diagnostics", filenames[0]), "utf8");
      const records = readRecords(userDataDirectory, filenames[0]);
      expect(records[0]).toMatchObject({
        capability: "unknown",
        errorClass: "UnknownError",
        code: "unknown",
      });
      expect(records[1]).toMatchObject({
        capability: "knowledge.readiness",
        errorClass: "TypeError",
        code: "unknown",
      });
      expect(records[2]).toMatchObject({
        capability: "run.start",
        errorClass: "UnknownError",
        code: "unknown",
      });
      expect(records[3]).toMatchObject({
        capability: "knowledge.readiness",
        errorClass: "NativeHostError",
        code: "operation-failed",
      });
      expect(current).not.toMatch(
        /private getter|private prototype|private capability|private type|private custom|private-name|private-code|private native host/u,
      );
    } finally {
      rmSync(userDataDirectory, { recursive: true, force: true });
    }
  });

  it("rotates before appending and keeps both local files within the configured cap", () => {
    const userDataDirectory = tempUserData();
    const limit = 256;
    try {
      const logger = createHostErrorLogger(userDataDirectory, limit);
      for (let index = 0; index < 24; index += 1) {
        expect(logger.record(new Error(`private repeated payload ${index}`), "run.status")).toBe(
          true,
        );
      }

      for (const filename of filenames) {
        const path = join(userDataDirectory, "diagnostics", filename);
        expect(statSync(path).size).toBeLessThanOrEqual(limit);
        expect(readRecords(userDataDirectory, filename).length).toBeGreaterThan(0);
      }
      const current = readFileSync(join(userDataDirectory, "diagnostics", filenames[0]), "utf8");
      expect(current).not.toContain("private repeated payload");
    } finally {
      rmSync(userDataDirectory, { recursive: true, force: true });
    }
  });

  it("swallows filesystem failures without disturbing the host operation", () => {
    const userDataDirectory = tempUserData();
    try {
      writeFileSync(join(userDataDirectory, "diagnostics"), "not a directory", "utf8");
      const logger = createHostErrorLogger(userDataDirectory);
      expect(() => logger.record(new RangeError("private"), "run.start")).not.toThrow();
      expect(logger.record(new RangeError("private"), "run.start")).toBe(false);
    } finally {
      rmSync(userDataDirectory, { recursive: true, force: true });
    }
  });

  it("removes oversized existing files and never accepts a cap above the production limit", () => {
    const userDataDirectory = tempUserData();
    const limit = 256;
    const diagnosticsDirectory = join(userDataDirectory, "diagnostics");
    try {
      const logger = createHostErrorLogger(userDataDirectory, limit);
      mkdirSync(diagnosticsDirectory, { mode: 0o700 });
      expect(
        createHostErrorLogger(userDataDirectory, 64 * 1024 + 1).record(new Error(), "run.start"),
      ).toBe(false);
      writeFileSync(join(diagnosticsDirectory, filenames[0]), "x".repeat(limit + 1), "utf8");
      writeFileSync(join(diagnosticsDirectory, filenames[1]), "y".repeat(limit + 1), "utf8");

      expect(logger.record(new Error("private"), "run.start")).toBe(true);
      expect(statSync(join(diagnosticsDirectory, filenames[0])).size).toBeLessThanOrEqual(limit);
      expect(() => statSync(join(diagnosticsDirectory, filenames[1]))).toThrow();
    } finally {
      rmSync(userDataDirectory, { recursive: true, force: true });
    }
  });

  describe("error cause summaries", () => {
    function recordCause(cause: unknown): Record<string, unknown> {
      const userDataDirectory = tempUserData();
      try {
        const logger = createHostErrorLogger(userDataDirectory);
        const error = new Error("private derivation message", { cause });
        expect(logger.record(error, "profile.derive")).toBe(true);
        const current = readFileSync(join(userDataDirectory, "diagnostics", filenames[0]), "utf8");
        expect(current).not.toMatch(/private/u);
        const [record] = readRecords(userDataDirectory, filenames[0]);
        if (record === undefined) throw new Error("expected a record");
        return record;
      } finally {
        rmSync(userDataDirectory, { recursive: true, force: true });
      }
    }

    it("records semantic validation issue locations without array indices", () => {
      const record = recordCause(
        new SemanticValidationError([
          {
            code: "invalid-value",
            field: "facts[12].provenance",
            message: "must reference a selected source.",
          },
          { code: "invalid-value", field: "facts[3].skills[40]", message: "must be unique." },
        ]),
      );
      expect(record).toMatchObject({
        capability: "profile.derive",
        errorClass: "Error",
        code: "unknown",
        causeClass: "SemanticValidationError",
        causeDetails: [
          "facts[].provenance: must reference a selected source.",
          "facts[].skills[]: must be unique.",
        ],
      });
    });

    it("records Zod-like issue codes and paths with numeric segments hidden", () => {
      const cause = Object.assign(new Error("private zod message"), {
        name: "ZodError",
        issues: [
          { code: "invalid_type", path: ["facts", 7, "category"], message: "private value" },
          { code: "too_big", path: [], message: "private" },
        ],
      });
      expect(recordCause(cause)).toMatchObject({
        causeClass: "ZodError",
        causeDetails: ["invalid_type at facts[].category", "too_big at "],
      });
    });

    it("drops unsafe details, caps the list, and restricts the class name", () => {
      const safe = Array.from({ length: 8 }, (_, index) => ({
        field: `facts[${index}].label`,
        message: "must be present.",
      }));
      const cause = Object.assign(new Error("private"), {
        name: "Bad Name",
        issues: [
          { field: "facts[0]", message: 'contains "a quoted value"' },
          { field: "facts[1]", message: "it's a quoted value" },
          { field: "facts[2]", message: "x".repeat(201) },
          ...safe,
        ],
      });
      const record = recordCause(cause);
      expect(record.causeClass).toBe("UnknownError");
      expect(record.causeDetails).toEqual(Array(5).fill("facts[].label: must be present."));
    });

    it("omits cause fields when the error has no Error cause", () => {
      expect(Object.keys(recordCause("a string cause")).sort()).toEqual([
        "capability",
        "code",
        "errorClass",
        "timestamp",
      ]);
      const userDataDirectory = tempUserData();
      try {
        const logger = createHostErrorLogger(userDataDirectory);
        expect(logger.record(new Error("private"), "run.start")).toBe(true);
        const [record] = readRecords(userDataDirectory, filenames[0]);
        expect(record).not.toHaveProperty("causeClass");
        expect(record).not.toHaveProperty("causeDetails");
      } finally {
        rmSync(userDataDirectory, { recursive: true, force: true });
      }
    });
  });
});

class CustomDiagnosticError extends Error {
  constructor(message: string, name: string, code: string) {
    super(message);
    this.name = name;
    Object.assign(this, { code });
  }
}
