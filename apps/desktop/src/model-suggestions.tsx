import {
  defaultModelProfileRegistry,
  type ModelProfileRegistry,
} from "@draft-loop/application/model-profiles";
import type { AgentRole } from "@draft-loop/domain";
import type { ModelProfile } from "@draft-loop/domain/model-profile";
import type { ModelCompany } from "./bridge.js";

export interface RegisteredModelSuggestion {
  readonly modelId: string;
  readonly tiers: readonly ModelProfile["tier"][];
  readonly roles: readonly AgentRole[];
  readonly profileCount: number;
  readonly registeredForRole: boolean;
  readonly label: string;
}

export type ModelProfileSource = readonly ModelProfile[] | Pick<ModelProfileRegistry, "list">;

function sourceProfiles(source: ModelProfileSource): readonly ModelProfile[] {
  return Array.isArray(source) ? source : (source as Pick<ModelProfileRegistry, "list">).list();
}

function readableRole(role: AgentRole): string {
  return role === "author" ? "Author" : "Critic";
}

function suggestionLabel(
  tiers: readonly ModelProfile["tier"][],
  roles: readonly AgentRole[],
  role: AgentRole,
): string {
  const tierLabel = tiers
    .map((tier) => `${tier[0]?.toUpperCase() ?? ""}${tier.slice(1)}`)
    .join(", ");
  const roleLabel = roles.map(readableRole).join(", ");
  const roleStatus = roles.includes(role)
    ? `registered for ${readableRole(role)}`
    : `not registered for ${readableRole(role)}`;
  return `${tierLabel} tier · ${roleLabel} profile${roles.length === 1 ? "" : "s"} · ${roleStatus}`;
}

/** Groups exact model IDs across profile versions without losing tier or role facts. */
export function projectModelSuggestions(
  source: ModelProfileSource,
  company: ModelCompany,
  role: AgentRole,
): readonly RegisteredModelSuggestion[] {
  if (company === "local") return [];
  const groups = new Map<
    string,
    { tiers: Set<ModelProfile["tier"]>; roles: Set<AgentRole>; profileCount: number }
  >();
  for (const profile of sourceProfiles(source)) {
    if (profile.provider !== company) continue;
    const group = groups.get(profile.modelId) ?? {
      tiers: new Set<ModelProfile["tier"]>(),
      roles: new Set<AgentRole>(),
      profileCount: 0,
    };
    group.tiers.add(profile.tier);
    for (const registeredRole of profile.roles) group.roles.add(registeredRole);
    group.profileCount += 1;
    groups.set(profile.modelId, group);
  }
  return [...groups].map(([modelId, group]) => {
    const tiers = [...group.tiers];
    const roles = [...group.roles];
    return {
      modelId,
      tiers,
      roles,
      profileCount: group.profileCount,
      registeredForRole: group.roles.has(role),
      label: suggestionLabel(tiers, roles, role),
    };
  });
}

export function hasFallbackModelSuggestions(
  company: ModelCompany,
  discoveryStatus: "idle" | "loading" | "ready" | "unavailable",
  discoveredModelCount: number,
): boolean {
  if (company === "local") return false;
  if (
    discoveryStatus !== "unavailable" &&
    !(discoveryStatus === "ready" && discoveredModelCount === 0)
  ) {
    return false;
  }
  return projectModelSuggestions(defaultModelProfileRegistry, company, "author").length > 0;
}

export function ModelSuggestionDatalist({
  id,
  company,
  role,
}: {
  readonly id: string;
  readonly company: ModelCompany;
  readonly role: AgentRole;
}) {
  const suggestions = projectModelSuggestions(defaultModelProfileRegistry, company, role);
  if (suggestions.length === 0) return null;
  return (
    <datalist id={id}>
      {suggestions.map((suggestion) => (
        <option key={suggestion.modelId} value={suggestion.modelId} label={suggestion.label} />
      ))}
    </datalist>
  );
}
