/**
 * The knowledge base a save goes to: the one the candidate chose while it is still offered,
 * otherwise the first offered. Hosts read the bases after a form first renders, so a form derives
 * the choice on every render instead of capturing the first base once; a captured value stays
 * empty while the select already shows the first base.
 */
export function knowledgeBaseChoice(
  knowledgeBases: readonly { readonly id: string }[],
  chosenId: string,
): string {
  return knowledgeBases.some((base) => base.id === chosenId)
    ? chosenId
    : (knowledgeBases[0]?.id ?? "");
}
