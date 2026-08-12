export type ProviderId = "anthropic" | "openai" | (string & {});

export type AgentRole = "author" | "critic";

export interface ModelSelection {
  readonly provider: ProviderId;
  readonly model: string;
  readonly role: AgentRole;
}

export function usesDifferentProviders(author: ModelSelection, critic: ModelSelection): boolean {
  return author.provider !== critic.provider;
}
