/**
 * What the support assistant (#2882) reads and calls, as ports the host fills. The host binds
 * each port to the member who asked, so no tool can name another member or workspace. Every
 * value a port returns is a code, an id, a count or a date, never candidate material.
 */

export const supportLanguages = ["en", "fr"] as const;
export type SupportLanguage = (typeof supportLanguages)[number];

/** One countable allowance, such as drafts used on an application this month. */
export interface SupportCounter {
  readonly name: string;
  /** `null` when the host counts the allowance but cannot read its use. */
  readonly used: number | null;
  /** `null` when the plan sets no limit. */
  readonly limit: number | null;
}

export interface SupportAccountSummary {
  readonly plan: string;
  /** Credits left to start applications; `null` when the plan does not use credits. */
  readonly credits: number | null;
  readonly counters: readonly SupportCounter[];
}

/** Where one run stands, in the closed words the run screens use. */
export interface SupportRunStatus {
  readonly run_id: string;
  readonly application_id: string;
  readonly state: string;
  /** The run's closed error code when it stopped on one. */
  readonly error_code: string | null;
  /** Whether the error clears on its own; `null` when there is no error. */
  readonly recoverable: boolean | null;
  /** Seconds before an automatic retry, when one is planned. */
  readonly wait_seconds: number | null;
  readonly updated_at: string;
}

export interface SupportServiceStatus {
  readonly state: "operational" | "degraded" | "down";
  /** Closed codes for known incidents, such as `model-route-slow`. */
  readonly codes: readonly string[];
}

/** The member's own account, already bound to them by the host. */
/**
 * The member's next step, as Redakloop's screens name it (#3227): the application they worked on
 * last and its stage code, or `job` when they have none.
 */
export interface SupportNextStep {
  readonly application_id: string | null;
  /** `job`, or an application stage: start-review, drafting, reviewing, review-ended, export, done. */
  readonly stage: string;
}

export interface SupportAccountPort {
  accountSummary(): Promise<SupportAccountSummary>;
  nextStep(): Promise<SupportNextStep>;
  recentRuns(limit: number): Promise<readonly SupportRunStatus[]>;
  /** `null` when the run does not exist or belongs to someone else. */
  runStatus(runId: string): Promise<SupportRunStatus | null>;
  serviceStatus(): Promise<SupportServiceStatus>;
}

/** Hands the conversation to a person (#2883). Without it the assistant cannot open a ticket. */
export interface SupportHandoffPort {
  open(input: {
    readonly conversationId: string;
    /** The assistant's one-paragraph summary of what the member needs. */
    readonly summary: string;
  }): Promise<{ readonly ticket_id: string }>;
}

/** One call to the model: a fixed system prompt, a JSON turn and a schema for the answer. */
export interface SupportModelRequest {
  readonly systemPrompt: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly outputName: string;
  readonly maxOutputTokens: number;
  readonly signal?: AbortSignal;
}

export interface SupportModelResponse {
  /** The structured answer, checked again by the assistant. */
  readonly output: unknown;
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** `null` when the route has no pricing for the call. */
  readonly estimatedUsd: number | null;
}

/** The model route; the host adapts the model gateway to it. Any throw falls back to search. */
export type SupportModel = (request: SupportModelRequest) => Promise<SupportModelResponse>;

/** Today's use, for the per-member and global daily limits. */
export interface SupportUsageLedger {
  /** Questions the member asked in the last 60 seconds, for the burst limit. */
  questionsLastMinute(memberId: string): Promise<number>;
  questionsToday(memberId: string): Promise<number>;
  costTodayUsd(): Promise<number>;
  /** Counts one question against the member's day, once it passed the limits. */
  countQuestion(memberId: string): Promise<void>;
  /** Adds one model call's cost to the day. */
  record(entry: SupportUsageEntry): Promise<void>;
}

export interface SupportUsageEntry {
  readonly memberId: string;
  readonly conversationId: string;
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedUsd: number | null;
  readonly at: string;
}

/** One audit line, written for every tool call and every reply; never any words. */
export type SupportAuditEvent =
  | {
      readonly kind: "tool";
      readonly conversationId: string;
      readonly tool: string;
      readonly status: "ok" | "not-found" | "failed" | "not-offered";
      readonly at: string;
    }
  | {
      readonly kind: "reply";
      readonly conversationId: string;
      readonly mode: "assistant" | "guide_search";
      /** The outcome for an assistant reply, the fallback reason for a guide search. */
      readonly result: string;
      /**
       * Why a model call failed, without its words: `call_failed:<error class>` or
       * `invalid_step:<field path>`.
       */
      readonly failure?: string;
      readonly modelCalls: number;
      readonly estimatedUsd: number | null;
      readonly at: string;
    };
