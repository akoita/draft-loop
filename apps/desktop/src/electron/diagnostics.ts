import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

import {
  CliUserError,
  JobRequirementUserError,
  SourceIngestionUserError,
} from "@draft-loop/application";
import { ProviderAdapterError, type ProviderErrorCode } from "@draft-loop/providers";
import { type BridgeErrorCode, bridgeCapabilities } from "../bridge.js";
import { DesktopBridgeError } from "../native.js";

const maximumLogBytes = 64 * 1024;
const knownCapabilities = new Set<string>(bridgeCapabilities);
const bridgeErrorCodes = [
  "invalid-command",
  "invalid-input",
  "capability-unavailable",
  "permission-denied",
  "not-found",
  "operation-failed",
] satisfies readonly BridgeErrorCode[];
const providerErrorCodes = [
  "authentication",
  "permission",
  "rate-limit",
  "quota-exhausted",
  "timeout",
  "cancelled",
  "transient",
  "invalid-request",
  "invalid-response",
  "policy",
  "unknown",
] satisfies readonly ProviderErrorCode[];
const knownErrorCodes = new Set<string>([...bridgeErrorCodes, ...providerErrorCodes]);

type LoggedErrorClass =
  | "ProviderAdapterError"
  | "NativeHostError"
  | "DesktopBridgeError"
  | "JobRequirementUserError"
  | "SourceIngestionUserError"
  | "CliUserError"
  | "TypeError"
  | "RangeError"
  | "Error"
  | "UnknownError";

function safeTest(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

function safeStringProperty(value: unknown, property: string): string | undefined {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }
  try {
    const candidate: unknown = Reflect.get(value, property);
    return typeof candidate === "string" ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function classifyError(value: unknown): LoggedErrorClass {
  if (safeTest(() => value instanceof ProviderAdapterError)) return "ProviderAdapterError";
  if (safeTest(() => value instanceof DesktopBridgeError)) return "DesktopBridgeError";
  if (safeTest(() => value instanceof JobRequirementUserError)) return "JobRequirementUserError";
  if (safeTest(() => value instanceof SourceIngestionUserError)) return "SourceIngestionUserError";
  if (safeTest(() => value instanceof CliUserError)) return "CliUserError";
  if (safeTest(() => value instanceof TypeError)) return "TypeError";
  if (safeTest(() => value instanceof RangeError)) return "RangeError";
  if (!safeTest(() => value instanceof Error)) return "UnknownError";
  if (safeStringProperty(value, "name") === "NativeHostError") return "NativeHostError";
  try {
    return Object.getPrototypeOf(value) === Error.prototype ? "Error" : "UnknownError";
  } catch {
    return "UnknownError";
  }
}

function classifyCode(value: unknown): string {
  const code = safeStringProperty(value, "code");
  return code !== undefined && knownErrorCodes.has(code) ? code : "unknown";
}

function fileSize(path: string): number | undefined {
  if (!existsSync(path)) return undefined;
  const metadata = statSync(path);
  if (!metadata.isFile()) throw new Error("diagnostic target is not a file");
  return metadata.size;
}

function setPrivateMode(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // Creation modes still protect new files on platforms without chmod support.
  }
}

export function createHostErrorLogger(
  userDataDirectory: string,
  fileLimitBytes = maximumLogBytes,
): { readonly record: (error: unknown, capability: unknown) => boolean } {
  return {
    record: (error, capability) => {
      try {
        if (
          !Number.isSafeInteger(fileLimitBytes) ||
          fileLimitBytes <= 0 ||
          fileLimitBytes > maximumLogBytes
        ) {
          return false;
        }
        const diagnosticsDirectory = join(userDataDirectory, "diagnostics");
        const currentPath = join(diagnosticsDirectory, "host-errors.jsonl");
        const backupPath = join(diagnosticsDirectory, "host-errors.1.jsonl");
        const record = {
          timestamp: new Date().toISOString(),
          capability:
            typeof capability === "string" && knownCapabilities.has(capability)
              ? capability
              : "unknown",
          errorClass: classifyError(error),
          code: classifyCode(error),
        };
        const line = `${JSON.stringify(record)}\n`;
        const lineBytes = Buffer.byteLength(line, "utf8");
        if (lineBytes > fileLimitBytes) return false;

        mkdirSync(diagnosticsDirectory, { recursive: true, mode: 0o700 });
        setPrivateMode(diagnosticsDirectory, 0o700);
        const backupBytes = fileSize(backupPath);
        if (backupBytes !== undefined && backupBytes > fileLimitBytes) unlinkSync(backupPath);
        const currentBytes = fileSize(currentPath);
        if (currentBytes !== undefined && currentBytes + lineBytes > fileLimitBytes) {
          if (existsSync(backupPath)) unlinkSync(backupPath);
          if (currentBytes <= fileLimitBytes) {
            renameSync(currentPath, backupPath);
            setPrivateMode(backupPath, 0o600);
          } else {
            unlinkSync(currentPath);
          }
        }
        appendFileSync(currentPath, line, { encoding: "utf8", flag: "a", mode: 0o600 });
        setPrivateMode(currentPath, 0o600);
        return true;
      } catch {
        return false;
      }
    },
  };
}
