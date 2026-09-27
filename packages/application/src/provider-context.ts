import type { ContextSnapshot } from "@draft-loop/domain";
import type { DraftArtifact } from "@draft-loop/schemas";

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
    evidenceManifest: context.evidenceManifest.map((source, index) => ({
      ...source,
      path: `evidence-source-${index + 1}`,
    })),
    modelConfiguration: {
      author: withoutLineage(configuration.author),
      critic: withoutLineage(configuration.critic),
      requireProviderDiversity: configuration.requireProviderDiversity,
    },
  };
}

/** Replace local source paths in claim evidence before an artifact reaches a provider. */
export function modelFacingArtifact(
  artifact: DraftArtifact,
  context: ContextSnapshot,
): DraftArtifact {
  const manifestAliases = new Map<string, string>();
  context.evidenceManifest.forEach((source, index) => {
    const key = JSON.stringify([source.path, source.checksum]);
    if (!manifestAliases.has(key)) manifestAliases.set(key, `evidence-source-${index + 1}`);
  });

  const unknownAliases = new Map<string, string>();
  let nextUnknownAlias = 1;
  return {
    ...artifact,
    claims: artifact.claims.map((claim) => ({
      ...claim,
      evidence: claim.evidence.map((reference) => {
        const key = JSON.stringify([reference.sourcePath, reference.sourceChecksum ?? null]);
        let sourcePath = manifestAliases.get(key);
        if (sourcePath === undefined) {
          sourcePath = unknownAliases.get(key);
          if (sourcePath === undefined) {
            sourcePath = `artifact-evidence-source-${nextUnknownAlias}`;
            nextUnknownAlias += 1;
            unknownAliases.set(key, sourcePath);
          }
        }
        return { ...reference, sourcePath };
      }),
    })),
  };
}
