import type { ModelProfileSupportResult } from "./bridge.js";
import {
  modelProfileEntryForReference,
  modelProfileRouteIsSupported,
} from "./model-profile-picker-state.js";

/** One exact profile's identity, runtime controls, and route support, for a Details disclosure. */
export function ProfileDetails({
  reference,
  profileRole,
  support,
}: {
  readonly reference: { readonly id: string; readonly version: number };
  readonly profileRole: "author" | "critic";
  readonly support: ModelProfileSupportResult | undefined;
}) {
  const entry = modelProfileEntryForReference(reference, profileRole);
  if (entry === undefined) return null;
  const { profile } = entry;
  const supported =
    support === undefined ? undefined : modelProfileRouteIsSupported(reference, support);
  const thinking = profile.runtime.thinking;
  const thinkingDescription =
    thinking.mode === "budgeted" ? `budgeted (${thinking.maxTokens} tokens)` : thinking.mode;
  return (
    <div className="model-profile-picker-details">
      <strong>
        {profile.id}@{profile.version}
      </strong>
      <dl>
        <div>
          <dt>Provider and model</dt>
          <dd>
            {profile.provider}/{profile.modelId}
          </dd>
        </div>
        <div>
          <dt>Tier and role</dt>
          <dd>
            {profile.tier} · {profile.roles.join(", ")}
          </dd>
        </div>
        <div>
          <dt>Runtime controls</dt>
          <dd>
            effort {profile.runtime.effort}; output {profile.runtime.maxOutputTokens} tokens;
            thinking {thinkingDescription}
          </dd>
        </div>
        <div>
          <dt>Route support</dt>
          <dd>
            {supported === undefined
              ? "Not checked"
              : supported
                ? "Supported with the configured authentication route"
                : "Unsupported with the configured authentication route"}
          </dd>
        </div>
        <div>
          <dt>Validation and availability</dt>
          <dd>Quality unvalidated; account availability unchecked</dd>
        </div>
      </dl>
    </div>
  );
}
