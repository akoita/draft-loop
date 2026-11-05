/**
 * The catalog of memory kinds (#2250): every kind of context DraftLoop keeps for a run, how long it
 * lives, who writes it, whether it may hold candidate content, and the module that owns it.
 *
 * The table in docs/architecture/memory.md lists the same kinds; a test keeps the two in step.
 * Nothing reads the catalog at runtime yet. Learned items (planned preference memory) are
 * preferences or lessons, never candidate facts.
 */

/** How long an item lives: one model call, one run, a workspace, or the candidate's record. */
export const memoryLifetimes = ["call", "run", "workspace", "candidate"] as const;
export type MemoryLifetime = (typeof memoryLifetimes)[number];

/** `person-confirmed`: proposed by the system, kept only after the person approves it. */
export const memoryWriters = ["system", "person", "person-confirmed"] as const;
export type MemoryWriter = (typeof memoryWriters)[number];

export interface MemoryKind {
  readonly id: string;
  readonly lifetime: MemoryLifetime;
  readonly writer: MemoryWriter;
  /** True when an item may quote candidate content, so it stays out of traces and logs. */
  readonly mayHoldCandidateContent: boolean;
  /** Repository path of the module that owns the kind. */
  readonly owningModule: string;
}

export const memoryKinds = [
  {
    id: "working-context",
    lifetime: "call",
    writer: "system",
    mayHoldCandidateContent: true,
    owningModule: "packages/domain/src/context-snapshot-references.ts",
  },
  {
    id: "run-revision",
    lifetime: "run",
    writer: "system",
    mayHoldCandidateContent: true,
    owningModule: "packages/application/src/author-revision-memory.ts",
  },
  {
    id: "candidate-direction",
    lifetime: "run",
    writer: "person",
    mayHoldCandidateContent: true,
    owningModule: "packages/application/src/candidate-direction.ts",
  },
  {
    id: "evidence-retrieval",
    lifetime: "run",
    writer: "system",
    mayHoldCandidateContent: true,
    owningModule: "packages/application/src/candidate-knowledge-retrieval.ts",
  },
  {
    id: "candidate-facts",
    lifetime: "candidate",
    writer: "person-confirmed",
    mayHoldCandidateContent: true,
    owningModule: "packages/domain/src/canonical-candidate-profile.ts",
  },
  {
    id: "pending-evidence",
    lifetime: "candidate",
    writer: "system",
    mayHoldCandidateContent: true,
    owningModule: "packages/application/src/work-journal.ts",
  },
  {
    id: "writing-policy",
    lifetime: "workspace",
    writer: "person",
    mayHoldCandidateContent: true,
    owningModule: "packages/application/src/writing-policy-file.ts",
  },
  {
    id: "run-history",
    lifetime: "workspace",
    writer: "system",
    mayHoldCandidateContent: true,
    owningModule: "packages/storage-postgres/src/run-history.ts",
  },
] as const satisfies readonly MemoryKind[];

export type MemoryKindId = (typeof memoryKinds)[number]["id"];

export function findMemoryKind(id: string): MemoryKind | undefined {
  return memoryKinds.find((kind) => kind.id === id);
}
