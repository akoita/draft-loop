// Generated from apps/api/openapi.json by `pnpm --filter @draft-loop/web api-types`. Do not edit.

export interface ApiSchemas {
  "ApiError": {
    readonly error: {
      readonly code: string;
      readonly message: string;
      readonly issues?: readonly ({
        readonly path: string;
        readonly message: string;
      })[];
    };
  };
  "Application": {
    readonly id: string;
    readonly name: string;
    readonly nameChosen: boolean;
    readonly status: string;
    readonly isDefault: boolean;
    readonly archivedAt: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly briefs: readonly ({
      readonly briefId: string;
      readonly latestVersion: number;
      readonly status: string;
      readonly createdAt: string;
    })[];
    readonly runs: readonly ({
      readonly id: string;
      readonly state: string;
      readonly startedAt: string;
      readonly updatedAt: string;
    })[];
    readonly chosenRunId: string | null;
  };
  "AuthConfig": {
    readonly mode: "owner";
  } | {
    readonly mode: "oidc";
    readonly issuer: string;
    readonly clientId: string;
  };
  "ConsentEntry": {
    readonly id: string;
    readonly kind: "material-storage" | "provider-transmission";
    readonly action: "granted" | "withdrawn";
    readonly basis: "candidate-consent" | "contract" | "legitimate-interest";
    readonly recordedBy: {
      readonly kind: "owner";
    } | {
      readonly kind: "member";
      readonly memberId: string;
    };
    readonly providers: readonly (string)[];
    readonly note?: string;
    readonly recordedAt: string;
  };
  "Consents": {
    readonly current: {
      readonly "material-storage": ApiSchemas["ConsentEntry"] | null;
      readonly "provider-transmission": ApiSchemas["ConsentEntry"] | null;
    };
    readonly history: readonly (ApiSchemas["ConsentEntry"])[];
  };
  "CreatedOrganisation": {
    readonly organisation: {
      readonly organisationId: string;
      readonly name: string;
      readonly createdAt: string;
    };
    readonly firstOwner: ApiSchemas["OrganisationMember"];
  };
  "Health": {
    readonly status: "ok";
  };
  "KnowledgeBase": {
    readonly id: string;
    readonly displayName: string;
    readonly description: string;
    readonly state: string;
    readonly createdAt: string;
    readonly archivedAt: string | null;
  };
  "KnowledgeSource": {
    readonly id: string;
    readonly knowledgeBaseId: string;
    readonly displayName: string;
    readonly kind: string;
    readonly versionId: string;
    readonly mediaType: string;
    readonly sizeBytes: number;
    readonly checksum: string;
    readonly createdAt: string;
  };
  "Me": {
    readonly kind: "owner";
  } | {
    readonly kind: "member";
    readonly organisationId: string;
    readonly memberId: string;
    readonly role: "owner" | "admin" | "member";
    readonly email?: string;
  };
  "MonthUsage": {
    readonly calls: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimatedUsd: number;
    readonly unpricedCalls: number;
    readonly lines: readonly (ApiSchemas["UsageLine"])[];
    readonly month: string;
  };
  "Opportunity": {
    readonly workspaceId: string;
    readonly checksum: string;
    readonly brief: {
      readonly schemaVersion: 1;
      readonly id: string;
      readonly version: number;
      readonly priorVersion: number | null;
      readonly status: "draft" | "reviewed";
      readonly createdAt: string;
      readonly reviewedAt: string | null;
      readonly sources: readonly ({
        readonly id: string;
        readonly classification: "job-posting" | "social-announcement" | "company-context" | "candidate-instruction" | "candidate-provided-fact";
        readonly status: "available" | "inaccessible" | "unsupported" | "failed" | "partial" | "stale";
        readonly provenance: {
          readonly kind: "approved-url";
          readonly originalUrl: string;
          readonly finalUrl?: string;
          readonly capturedAt: string;
          readonly contentChecksum: unknown | null;
          readonly textOrigin?: "job-posting-json-ld";
        } | {
          readonly kind: "local-file";
          readonly displayName: string;
          readonly capturedAt: string;
          readonly checksum: unknown | null;
          readonly textOrigin?: "job-posting-json-ld";
        } | {
          readonly kind: "pasted-content";
          readonly capturedAt: string;
          readonly checksum: unknown | null;
        } | {
          readonly kind: "candidate-input";
          readonly capturedAt: string;
          readonly checksum: unknown | null;
        };
      })[];
      readonly role: {
        readonly value: string;
        readonly sourceIds: readonly (string)[];
      } | null;
      readonly employer: {
        readonly value: string;
        readonly sourceIds: readonly (string)[];
      } | null;
      readonly responsibilities: readonly ({
        readonly id: string;
        readonly text: string;
        readonly sourceIds: readonly (string)[];
        readonly excerpt?: string;
      })[];
      readonly requirements: readonly ({
        readonly id: string;
        readonly text: string;
        readonly priority: "critical" | "high" | "medium" | "low";
        readonly sourceIds: readonly (string)[];
        readonly excerpt?: string;
      })[];
      readonly priorities: readonly ({
        readonly id: string;
        readonly text: string;
        readonly sourceIds: readonly (string)[];
      })[];
      readonly candidateInstructions: {
        readonly tone: {
          readonly value: string;
          readonly sourceIds: readonly (string)[];
        } | null;
        readonly applicationGoal: {
          readonly value: string;
          readonly sourceIds: readonly (string)[];
        } | null;
        readonly forbiddenLanguage: readonly ({
          readonly value: string;
          readonly sourceIds: readonly (string)[];
        })[];
        readonly focusAreas: readonly ({
          readonly value: string;
          readonly sourceIds: readonly (string)[];
        })[];
      };
      readonly issues: readonly ({
        readonly id: string;
        readonly code: "inaccessible-source" | "unsupported-source" | "fetch-failure" | "extraction-failure" | "duplicate-source" | "contradiction" | "stale-source" | "partial-fetch";
        readonly status: "open" | "acknowledged" | "resolved";
        readonly severity: "error" | "warning";
        readonly message: string;
        readonly sourceIds: readonly (string)[];
      })[];
    };
  };
  "OpportunityVersions": {
    readonly versions: readonly ({
      readonly version: number;
      readonly status: string;
      readonly createdAt: string;
      readonly reviewedAt: string | null;
    })[];
  };
  "OrganisationMember": {
    readonly memberId: string;
    readonly email: string;
    readonly role: "owner" | "admin" | "member";
    readonly status: "invited" | "active";
    readonly invitedAt: string;
    readonly activatedAt?: string;
  };
  "OrganisationMembers": {
    readonly organisationId: string;
    readonly members: readonly (ApiSchemas["OrganisationMember"])[];
  };
  "RecordAssignment": {
    readonly memberId: string;
    readonly email: string;
    readonly role: "owner" | "admin" | "member";
    readonly status: "invited" | "active";
    readonly assignedAt: string;
    readonly workspaceId: string;
  };
  "RecordMember": {
    readonly memberId: string;
    readonly email: string;
    readonly role: "owner" | "admin" | "member";
    readonly status: "invited" | "active";
    readonly assignedAt: string;
  };
  "RecordMembers": {
    readonly workspaceId: string;
    readonly members: readonly (ApiSchemas["RecordMember"])[];
  };
  "ReviewDraft": {
    readonly id: string;
    readonly version: number;
    readonly createdAt: string;
    readonly sections: readonly ({
      readonly id: string;
      readonly title: string;
      readonly kind: string;
      readonly blocks: readonly ({
        readonly id: string;
        readonly type: string;
        readonly text: string;
        readonly edited: boolean;
        readonly claimIds: readonly (string)[];
      })[];
    })[];
    readonly claims: readonly ({
      readonly id: string;
      readonly text: string;
      readonly status: string;
      readonly substantive: boolean;
      readonly evidence: readonly ({
        readonly sourcePath: string;
        readonly locator?: string;
        readonly excerpt: string;
      })[];
    })[];
  };
  "ReviewFinding": {
    readonly id: string;
    readonly code: string;
    readonly category: string;
    readonly severity: string;
    readonly message: string;
    readonly decision: "pending" | "accepted" | "rejected" | "deferred" | "overridden";
    readonly claimId?: string;
    readonly sectionId?: string;
    readonly requirement?: {
      readonly id: string;
      readonly text?: string;
    };
  };
  "Run": {
    readonly runId: string;
    readonly workspaceId: string;
    readonly state: string;
    readonly round: number;
    readonly currentStep: "author" | "critic" | "revision" | null;
    readonly approval: "pending" | "approved" | "rejected";
    readonly totalCostUsd: number;
    readonly routes: readonly ({
      readonly step: "author" | "critic" | "revision";
      readonly route: string;
      readonly fallback?: {
        readonly from: string;
        readonly cause: string;
      };
    })[];
    readonly findingCount: number;
    readonly hasDraft: boolean;
    readonly startedAt: string;
    readonly updatedAt: string;
    readonly lastError: {
      readonly code: string;
      readonly retryable: boolean;
      readonly usageLimitResetsAt: string | null;
      readonly failedCall?: {
        readonly role: "author" | "critic";
        readonly company: string;
        readonly model: string;
        readonly route: string | null;
        readonly status: number | null;
        readonly providerErrorType: string | null;
        readonly providerErrorCode: string | null;
        readonly rateLimit: string | null;
        readonly retryAfterSeconds: number | null;
      };
    } | null;
  };
  "RunExport": {
    readonly id: string;
    readonly runId: string;
    readonly format: string;
    readonly mimeType: string;
    readonly createdAt: string;
    readonly checksum: string;
    readonly sizeBytes: number;
    readonly artifactVersion?: number;
    readonly templateId?: string;
  };
  "RunExports": {
    readonly exports: readonly (ApiSchemas["RunExport"])[];
  };
  "RunReview": {
    readonly run: ApiSchemas["Run"];
    readonly draft: ApiSchemas["ReviewDraft"] | null;
    readonly findings: readonly (ApiSchemas["ReviewFinding"])[];
    readonly independentReview: {
      readonly authorLineage: string;
      readonly criticLineage: string;
      readonly lineagesDistinct: boolean;
      readonly required: boolean;
      readonly overrideRationale?: string;
    } | null;
    readonly readiness: {
      readonly status: string;
      readonly ready: boolean;
      readonly stopReason: string;
      readonly scores: readonly ({
        readonly dimension: string;
        readonly score: number;
        readonly threshold: number;
        readonly meets: boolean;
      })[];
    } | null;
    readonly approvalCheck: {
      readonly applicationReady: boolean;
      readonly blockers: readonly (string)[];
    } | null;
    readonly candidateDirection: string | null;
  };
  "RunUsage": {
    readonly calls: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimatedUsd: number;
    readonly unpricedCalls: number;
    readonly lines: readonly (ApiSchemas["UsageLine"])[];
    readonly runId: string;
    readonly workspaceId: string;
  };
  "SensitivityRule": {
    readonly id: string;
    readonly tier: "normal" | "sensitive" | "never-share";
    readonly match: ApiSchemas["SensitivityRuleMatch"];
  };
  "SensitivityRuleMatch": {
    readonly kind: "heading-contains";
    readonly text: string;
  } | {
    readonly kind: "heading-path";
    readonly path: readonly (string)[];
  };
  "SensitivityRuleMatchInput": {
    readonly kind: "heading-contains";
    readonly text: string;
  } | {
    readonly kind: "heading-path";
    readonly path: readonly (string)[];
  };
  "SensitivityRules": {
    readonly knowledgeBaseId: string;
    readonly version: number;
    readonly createdAt: string | null;
    readonly rules: readonly (ApiSchemas["SensitivityRule"])[];
  };
  "UsageLine": {
    readonly company: string;
    readonly model: string;
    readonly route: string | null;
    readonly calls: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimatedUsd: number;
    readonly unpricedCalls: number;
  };
  "Workspace": {
    readonly id: string;
    readonly language: string;
    readonly requiredSections: readonly (string)[];
    readonly maxRounds: number;
    readonly author: {
      readonly company: string;
      readonly model: string;
    };
    readonly critic: {
      readonly company: string;
      readonly model: string;
    };
    readonly fixtureMode: boolean;
    readonly knowledgeBaseIds: readonly (string)[];
  };
  "WorkspaceList": {
    readonly workspaces: readonly ({
      readonly id: string;
    })[];
  };
  "WritingPolicy": {
    readonly checksum: string;
    readonly version: string;
    readonly createdAt: string;
    readonly priorChecksum: string | null;
    readonly content: string;
  };
  "WritingPolicyVersion": {
    readonly checksum: string;
    readonly version: string;
    readonly createdAt: string;
    readonly priorChecksum: string | null;
  };
}

export interface ApiOperations {
  "GET /v1/health": {
    readonly response: ApiSchemas["Health"];
  };
  "GET /v1/auth/config": {
    readonly response: ApiSchemas["AuthConfig"];
  };
  "GET /v1/workspaces": {
    readonly response: ApiSchemas["WorkspaceList"];
  };
  "GET /v1/workspaces/{workspaceId}/members": {
    readonly path: {
      readonly workspaceId: string;
    };
    readonly response: ApiSchemas["RecordMembers"];
  };
  "PUT /v1/workspaces/{workspaceId}/members/{memberId}": {
    readonly path: {
      readonly workspaceId: string;
      readonly memberId: string;
    };
    readonly response: ApiSchemas["RecordAssignment"];
  };
  "DELETE /v1/workspaces/{workspaceId}/members/{memberId}": {
    readonly path: {
      readonly workspaceId: string;
      readonly memberId: string;
    };
    readonly response: void;
  };
  "PUT /v1/workspaces/{workspaceId}": {
    readonly path: {
      readonly workspaceId: string;
    };
    readonly body: {
      readonly language?: string;
      readonly instructions?: string;
      readonly truthfulnessPolicy?: string;
      readonly author?: {
        readonly company: "anthropic" | "openai";
        readonly model: string;
      };
      readonly critic?: {
        readonly company: "anthropic" | "openai";
        readonly model: string;
      };
      readonly maxRounds?: number;
      readonly maxCostUsd?: number;
      readonly maxDurationMs?: number;
      readonly maxWords?: number;
      readonly maxCharacters?: number;
      readonly requiredSections?: readonly (string)[];
      readonly fixtureMode?: boolean;
      readonly autopilot?: boolean;
    };
    readonly response: ApiSchemas["Workspace"];
  };
  "GET /v1/workspaces/{workspaceId}": {
    readonly path: {
      readonly workspaceId: string;
    };
    readonly response: ApiSchemas["Workspace"];
  };
  "PUT /v1/workspaces/{workspaceId}/knowledge-selection": {
    readonly path: {
      readonly workspaceId: string;
    };
    readonly body: {
      readonly knowledgeBaseIds: readonly (string)[];
      readonly combinationApproved?: boolean;
    };
    readonly response: ApiSchemas["Workspace"];
  };
  "PUT /v1/workspaces/{workspaceId}/writing-policy": {
    readonly path: {
      readonly workspaceId: string;
    };
    readonly body: {
      readonly content: string;
    };
    readonly response: ApiSchemas["WritingPolicy"];
  };
  "GET /v1/workspaces/{workspaceId}/writing-policy": {
    readonly path: {
      readonly workspaceId: string;
    };
    readonly response: ApiSchemas["WritingPolicy"];
  };
  "GET /v1/workspaces/{workspaceId}/writing-policy/versions": {
    readonly path: {
      readonly workspaceId: string;
    };
    readonly response: {
      readonly versions: readonly (ApiSchemas["WritingPolicyVersion"])[];
    };
  };
  "POST /v1/workspaces/{workspaceId}/opportunities": {
    readonly path: {
      readonly workspaceId: string;
    };
    readonly body: {
      readonly sources: readonly ({
        readonly id: string;
        readonly kind: "pasted-content";
        readonly classification: "job-posting" | "social-announcement" | "company-context";
        readonly capturedAt?: string;
        readonly content: string;
      } | {
        readonly id: string;
        readonly kind: "candidate-input";
        readonly classification: "candidate-instruction";
        readonly capturedAt?: string;
        readonly content: string;
        readonly instructions?: {
          readonly tone?: string;
          readonly applicationGoal?: string;
          readonly forbiddenLanguage?: readonly (string)[];
          readonly focusAreas?: readonly (string)[];
        };
      })[];
      readonly applicationId?: string;
    };
    readonly response: ApiSchemas["Opportunity"];
  };
  "GET /v1/workspaces/{workspaceId}/opportunities/{briefId}": {
    readonly path: {
      readonly workspaceId: string;
      readonly briefId: string;
    };
    readonly query?: {
      readonly version?: number;
    };
    readonly response: ApiSchemas["Opportunity"];
  };
  "PATCH /v1/workspaces/{workspaceId}/opportunities/{briefId}": {
    readonly path: {
      readonly workspaceId: string;
      readonly briefId: string;
    };
    readonly body: {
      readonly expectedVersion: number;
      readonly patch: {
        readonly role?: {
          readonly value: string;
          readonly sourceIds: readonly (string)[];
        } | null;
        readonly employer?: {
          readonly value: string;
          readonly sourceIds: readonly (string)[];
        } | null;
        readonly candidateEmployer?: string;
        readonly responsibilities?: readonly ({
          readonly id: string;
          readonly text: string;
          readonly sourceIds: readonly (string)[];
          readonly excerpt?: string;
        })[];
        readonly requirements?: readonly ({
          readonly id: string;
          readonly text: string;
          readonly priority: "critical" | "high" | "medium" | "low";
          readonly sourceIds: readonly (string)[];
          readonly excerpt?: string;
        })[];
        readonly priorities?: readonly ({
          readonly id: string;
          readonly text: string;
          readonly sourceIds: readonly (string)[];
        })[];
        readonly candidateInstructions?: {
          readonly tone: {
            readonly value: string;
            readonly sourceIds: readonly (string)[];
          } | null;
          readonly applicationGoal: {
            readonly value: string;
            readonly sourceIds: readonly (string)[];
          } | null;
          readonly forbiddenLanguage: readonly ({
            readonly value: string;
            readonly sourceIds: readonly (string)[];
          })[];
          readonly focusAreas: readonly ({
            readonly value: string;
            readonly sourceIds: readonly (string)[];
          })[];
        };
        readonly issues?: readonly ({
          readonly id: string;
          readonly code: "inaccessible-source" | "unsupported-source" | "fetch-failure" | "extraction-failure" | "duplicate-source" | "contradiction" | "stale-source" | "partial-fetch";
          readonly status: "open" | "acknowledged" | "resolved";
          readonly severity: "error" | "warning";
          readonly message: string;
          readonly sourceIds: readonly (string)[];
        })[];
      };
    };
    readonly response: ApiSchemas["Opportunity"];
  };
  "GET /v1/workspaces/{workspaceId}/opportunities/{briefId}/versions": {
    readonly path: {
      readonly workspaceId: string;
      readonly briefId: string;
    };
    readonly response: ApiSchemas["OpportunityVersions"];
  };
  "POST /v1/workspaces/{workspaceId}/opportunities/{briefId}/review": {
    readonly path: {
      readonly workspaceId: string;
      readonly briefId: string;
    };
    readonly body: {
      readonly expectedVersion: number;
    };
    readonly response: ApiSchemas["Opportunity"];
  };
  "GET /v1/workspaces/{workspaceId}/applications": {
    readonly path: {
      readonly workspaceId: string;
    };
    readonly response: {
      readonly applications: readonly (ApiSchemas["Application"])[];
    };
  };
  "GET /v1/workspaces/{workspaceId}/applications/{applicationId}": {
    readonly path: {
      readonly workspaceId: string;
      readonly applicationId: string;
    };
    readonly response: ApiSchemas["Application"];
  };
  "POST /v1/workspaces/{workspaceId}/runs": {
    readonly path: {
      readonly workspaceId: string;
    };
    readonly header: {
      readonly "idempotency-key": string;
    };
    readonly body: {
      readonly applicationId?: string;
      readonly opportunityBrief?: {
        readonly briefId: string;
        readonly version: number;
      };
      readonly modelProfiles?: {
        readonly author: {
          readonly id: string;
          readonly version: number;
        };
        readonly critic: {
          readonly id: string;
          readonly version: number;
        };
      };
    };
    readonly response: ApiSchemas["Run"];
  };
  "GET /v1/workspaces/{workspaceId}/runs/{runId}": {
    readonly path: {
      readonly workspaceId: string;
      readonly runId: string;
    };
    readonly response: ApiSchemas["Run"];
  };
  "GET /v1/workspaces/{workspaceId}/runs/{runId}/review": {
    readonly path: {
      readonly workspaceId: string;
      readonly runId: string;
    };
    readonly response: ApiSchemas["RunReview"];
  };
  "PUT /v1/workspaces/{workspaceId}/runs/{runId}/findings/{findingId}/decision": {
    readonly path: {
      readonly workspaceId: string;
      readonly runId: string;
      readonly findingId: string;
    };
    readonly body: {
      readonly decision: "pending" | "accepted" | "rejected" | "deferred" | "overridden";
      readonly rationale?: string;
    };
    readonly response: ApiSchemas["RunReview"];
  };
  "PUT /v1/workspaces/{workspaceId}/runs/{runId}/edits/{blockId}": {
    readonly path: {
      readonly workspaceId: string;
      readonly runId: string;
      readonly blockId: string;
    };
    readonly body: {
      readonly text: string;
    };
    readonly response: ApiSchemas["RunReview"];
  };
  "POST /v1/workspaces/{workspaceId}/runs/{runId}/approve": {
    readonly path: {
      readonly workspaceId: string;
      readonly runId: string;
    };
    readonly body: {
      readonly readinessOverrideRationale?: string;
    };
    readonly response: ApiSchemas["Run"];
  };
  "POST /v1/workspaces/{workspaceId}/runs/{runId}/stop": {
    readonly path: {
      readonly workspaceId: string;
      readonly runId: string;
    };
    readonly response: ApiSchemas["Run"];
  };
  "POST /v1/workspaces/{workspaceId}/runs/{runId}/revision": {
    readonly path: {
      readonly workspaceId: string;
      readonly runId: string;
    };
    readonly header: {
      readonly "idempotency-key": string;
    };
    readonly body: {
      readonly candidateDirection?: string;
    };
    readonly response: ApiSchemas["Run"];
  };
  "POST /v1/workspaces/{workspaceId}/runs/{runId}/pause": {
    readonly path: {
      readonly workspaceId: string;
      readonly runId: string;
    };
    readonly response: ApiSchemas["Run"];
  };
  "POST /v1/workspaces/{workspaceId}/runs/{runId}/resume": {
    readonly path: {
      readonly workspaceId: string;
      readonly runId: string;
    };
    readonly header: {
      readonly "idempotency-key": string;
    };
    readonly response: ApiSchemas["Run"];
  };
  "POST /v1/workspaces/{workspaceId}/runs/{runId}/exports": {
    readonly path: {
      readonly workspaceId: string;
      readonly runId: string;
    };
    readonly header: {
      readonly "idempotency-key": string;
    };
    readonly body: {
      readonly format: "markdown" | "docx" | "pdf";
      readonly templateId?: string;
    };
    readonly response: ApiSchemas["RunExport"];
  };
  "GET /v1/workspaces/{workspaceId}/runs/{runId}/exports": {
    readonly path: {
      readonly workspaceId: string;
      readonly runId: string;
    };
    readonly response: ApiSchemas["RunExports"];
  };
  "GET /v1/workspaces/{workspaceId}/runs/{runId}/exports/{exportId}/content": {
    readonly path: {
      readonly workspaceId: string;
      readonly runId: string;
      readonly exportId: string;
    };
    readonly response: Blob;
  };
  "GET /v1/workspaces/{workspaceId}/runs/{runId}/usage": {
    readonly path: {
      readonly workspaceId: string;
      readonly runId: string;
    };
    readonly response: ApiSchemas["RunUsage"];
  };
  "GET /v1/usage": {
    readonly query: {
      readonly month: string;
    };
    readonly response: ApiSchemas["MonthUsage"];
  };
  "POST /v1/knowledge-bases": {
    readonly body: {
      readonly displayName: string;
      readonly description?: string;
      readonly workspaceId?: string;
    };
    readonly response: ApiSchemas["KnowledgeBase"];
  };
  "GET /v1/knowledge-bases": {
    readonly query?: {
      readonly workspaceId?: string;
    };
    readonly response: {
      readonly knowledgeBases: readonly (ApiSchemas["KnowledgeBase"])[];
    };
  };
  "GET /v1/knowledge-bases/{knowledgeBaseId}/sources": {
    readonly path: {
      readonly knowledgeBaseId: string;
    };
    readonly response: {
      readonly sources: readonly (ApiSchemas["KnowledgeSource"])[];
    };
  };
  "POST /v1/knowledge-bases/{knowledgeBaseId}/sources": {
    readonly path: {
      readonly knowledgeBaseId: string;
    };
    readonly query: {
      readonly name: string;
    };
    readonly body: Blob;
    readonly contentType: "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | "text/markdown" | "text/plain";
    readonly response: ApiSchemas["KnowledgeSource"];
  };
  "GET /v1/knowledge-bases/{knowledgeBaseId}/sensitivity-rules": {
    readonly path: {
      readonly knowledgeBaseId: string;
    };
    readonly response: ApiSchemas["SensitivityRules"];
  };
  "POST /v1/knowledge-bases/{knowledgeBaseId}/sensitivity-rules": {
    readonly path: {
      readonly knowledgeBaseId: string;
    };
    readonly body: {
      readonly tier: "normal" | "sensitive" | "never-share";
      readonly match: ApiSchemas["SensitivityRuleMatchInput"];
      readonly id?: string;
    };
    readonly response: ApiSchemas["SensitivityRules"];
  };
  "DELETE /v1/knowledge-bases/{knowledgeBaseId}/sensitivity-rules/{ruleId}": {
    readonly path: {
      readonly knowledgeBaseId: string;
      readonly ruleId: string;
    };
    readonly response: ApiSchemas["SensitivityRules"];
  };
  "GET /v1/workspaces/{workspaceId}/consents": {
    readonly path: {
      readonly workspaceId: string;
    };
    readonly response: ApiSchemas["Consents"];
  };
  "POST /v1/workspaces/{workspaceId}/consents": {
    readonly path: {
      readonly workspaceId: string;
    };
    readonly body: {
      readonly kind: "material-storage" | "provider-transmission";
      readonly action: "granted" | "withdrawn";
      readonly basis: "candidate-consent" | "contract" | "legitimate-interest";
      readonly providers?: readonly ("anthropic" | "openai")[];
      readonly note?: string;
    };
    readonly response: ApiSchemas["ConsentEntry"];
  };
  "GET /v1/workspaces/{workspaceId}/archive": {
    readonly path: {
      readonly workspaceId: string;
    };
    readonly response: Blob;
  };
  "GET /v1/me": {
    readonly response: ApiSchemas["Me"];
  };
  "GET /v1/organisation/members": {
    readonly response: ApiSchemas["OrganisationMembers"];
  };
  "POST /v1/organisation/members": {
    readonly body: {
      readonly email: string;
      readonly role: "owner" | "admin" | "member";
    };
    readonly response: ApiSchemas["OrganisationMember"];
  };
  "PATCH /v1/organisation/members/{memberId}": {
    readonly path: {
      readonly memberId: string;
    };
    readonly body: {
      readonly role: "owner" | "admin" | "member";
    };
    readonly response: ApiSchemas["OrganisationMember"];
  };
  "DELETE /v1/organisation/members/{memberId}": {
    readonly path: {
      readonly memberId: string;
    };
    readonly response: void;
  };
  "POST /v1/operator/organisations": {
    readonly body: {
      readonly organisationId: string;
      readonly name: string;
      readonly firstOwnerEmail: string;
    };
    readonly response: ApiSchemas["CreatedOrganisation"];
  };
}
