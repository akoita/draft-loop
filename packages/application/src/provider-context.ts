import type { ContextSnapshot } from "@draft-loop/domain";

/** Remove local-only selection and operator lineage before provider transmission. */
export function modelFacingContext(context: ContextSnapshot): ContextSnapshot {
  const configuration = context.modelConfiguration;
  const { candidateKnowledgeSelection: _candidateKnowledgeSelection, ...withoutSelection } =
    context;
  const withoutLineage = <T extends { readonly lineage?: string }>(selection: T): T => {
    const { lineage: _lineage, ...rest } = selection;
    return rest as T;
  };
  return {
    ...withoutSelection,
    modelConfiguration: {
      author: withoutLineage(configuration.author),
      critic: withoutLineage(configuration.critic),
      requireProviderDiversity: configuration.requireProviderDiversity,
    },
  };
}
