import { type ModelCompany, modelCompanies, type WorkspaceConfigureModelsInput } from "./bridge.js";
import type { DesktopReviewState } from "./model.js";

export interface WorkspaceModelSettingsDraft {
  readonly authorCompany: ModelCompany;
  readonly authorModel: string;
  readonly criticCompany: ModelCompany;
  readonly criticModel: string;
  readonly localEndpoint: string;
  readonly independenceOverrideRationale: string;
}

export interface WorkspaceModelSettingsPreview {
  readonly status: "idle" | "loading" | "ready" | "unavailable";
  readonly result?: { readonly lineagesDistinct: boolean };
}

function modelCompany(value: string): ModelCompany {
  const normalized = value.trim().toLowerCase();
  if ((modelCompanies as readonly string[]).includes(normalized)) return normalized as ModelCompany;
  throw new Error("The current model settings are unavailable.");
}

function loopbackEndpoint(value: string): string {
  const candidate = value.trim();
  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase();
    const octets = hostname.split(".");
    const loopbackIpv4 =
      octets.length === 4 &&
      octets[0] === "127" &&
      octets.every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) <= 255);
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      (hostname === "localhost" || hostname === "[::1]" || loopbackIpv4)
    ) {
      return candidate;
    }
  } catch {
    // A provider-facing label is not a usable local endpoint.
  }
  return "";
}

function validModelId(value: string): boolean {
  const model = value.trim();
  return (
    model.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(model) &&
    !model.includes("..") &&
    !model.includes("//") &&
    !model.endsWith("/")
  );
}

function validRationale(value: string): boolean {
  return (
    value.length <= 500 &&
    ![...value].some(
      (character) =>
        (character < " " && character !== "\n" && character !== "\t") || character === "\u007f",
    )
  );
}

/** Starts from the current preflight pair, never from a prior run's exposure. */
export function workspaceModelSettingsDraft(
  state: DesktopReviewState,
): WorkspaceModelSettingsDraft {
  const preflight = state.providerTransmissionPreflight;
  const authorCompany = modelCompany(preflight.author.company);
  const criticCompany = modelCompany(preflight.critic.company);
  const localIdentity =
    authorCompany === "local"
      ? preflight.author
      : criticCompany === "local"
        ? preflight.critic
        : undefined;
  return {
    authorCompany,
    authorModel: preflight.author.model,
    criticCompany,
    criticModel: preflight.critic.model,
    localEndpoint: localIdentity === undefined ? "" : loopbackEndpoint(localIdentity.endpoint),
    independenceOverrideRationale: "",
  };
}

/** Setup-only constraints which still apply when editing an existing pair. */
export function workspaceModelSettingsBlocker(
  draft: WorkspaceModelSettingsDraft,
  preview: WorkspaceModelSettingsPreview,
): string | null {
  if (draft.authorModel.trim() === "" || draft.criticModel.trim() === "") {
    return "Name an author model and a critic model before saving model settings.";
  }
  if (!validModelId(draft.authorModel) || !validModelId(draft.criticModel)) {
    return "Enter exact model ids using letters, numbers, dots, underscores, colons, slashes, or hyphens.";
  }
  if (
    (draft.authorCompany === "local" || draft.criticCompany === "local") &&
    draft.localEndpoint.trim() !== "" &&
    loopbackEndpoint(draft.localEndpoint) === ""
  ) {
    return "Use a local server address on this machine, such as http://127.0.0.1:11434/v1.";
  }
  if (!validRationale(draft.independenceOverrideRationale)) {
    return "Keep the model pairing rationale under 500 characters without control characters.";
  }
  if (
    preview.status === "ready" &&
    preview.result !== undefined &&
    !preview.result.lineagesDistinct &&
    draft.independenceOverrideRationale.trim() === ""
  ) {
    return "Record why one lineage on both sides is acceptable before saving model settings.";
  }
  return null;
}

/** Builds a complete replacement; workspace name and round limits are excluded. */
export function workspaceModelSettingsInput(
  draft: WorkspaceModelSettingsDraft,
  preview: WorkspaceModelSettingsPreview,
): Omit<WorkspaceConfigureModelsInput, "workspaceId"> | null {
  if (workspaceModelSettingsBlocker(draft, preview) !== null) return null;
  const localEndpoint = draft.localEndpoint.trim();
  const rationale = draft.independenceOverrideRationale.trim();
  return {
    authorCompany: draft.authorCompany,
    authorModel: draft.authorModel.trim(),
    criticCompany: draft.criticCompany,
    criticModel: draft.criticModel.trim(),
    ...(draft.authorCompany === "local" || draft.criticCompany === "local"
      ? localEndpoint === ""
        ? {}
        : { localEndpoint }
      : {}),
    ...(rationale === "" ? {} : { independenceOverrideRationale: rationale }),
  };
}

/** Do not echo provider or user input from a native validation error. */
export function workspaceModelSettingsFailureMessage(): string {
  return "Model settings could not be saved. Check both model ids and the local server address, then try again.";
}
