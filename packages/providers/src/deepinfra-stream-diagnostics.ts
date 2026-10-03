/** Fixed parser branches safe to retain as counts without storing stream data. */
export const deepInfraStreamRejectionReasonCodes = [
  "stream_chunk_envelope",
  "stream_chunk_identity",
  "stream_model_metadata",
  "stream_timestamp_metadata",
  "stream_usage_sequence",
  "stream_post_terminal_data",
  "stream_choice_count",
  "stream_choice_shape",
  "stream_delta_type",
  "stream_choice_index",
  "stream_role",
  "stream_tool_data",
  "stream_content_type",
  "stream_refusal_type",
  "stream_finish_marker",
] as const;

export type DeepInfraStreamRejectionReasonCode =
  (typeof deepInfraStreamRejectionReasonCodes)[number];

export interface DeepInfraStreamRejectionCount {
  readonly code: DeepInfraStreamRejectionReasonCode;
  readonly count: 1;
}

export function deepInfraStreamRejectionCount(
  code: DeepInfraStreamRejectionReasonCode,
): DeepInfraStreamRejectionCount {
  return { code, count: 1 };
}
