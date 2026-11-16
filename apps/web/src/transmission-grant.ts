import type { ApiClient } from "./api-client.js";
import { type ConsentProvider, isConsentProvider } from "./consent-model.js";

/**
 * Adds providers to the candidate record's transmission grant and keeps every provider it already
 * names. Callers use it only after the candidate pressed a control whose words say where their
 * material goes, such as the career interview's allow button or the profile's send approval.
 * Throws the API's error unchanged.
 */
export async function addTransmissionProviders(
  client: ApiClient,
  workspaceId: string,
  wanted: readonly ConsentProvider[],
  note: string,
): Promise<void> {
  const consents = await client.call("GET /v1/workspaces/{workspaceId}/consents", {
    path: { workspaceId },
  });
  const current = consents.current["provider-transmission"];
  const named = current?.action === "granted" ? current.providers : [];
  const providers = [...new Set([...named, ...wanted])].filter(isConsentProvider).sort();
  await client.call("POST /v1/workspaces/{workspaceId}/consents", {
    path: { workspaceId },
    body: {
      kind: "provider-transmission",
      action: "granted",
      basis: "candidate-consent",
      providers,
      note,
    },
  });
}
