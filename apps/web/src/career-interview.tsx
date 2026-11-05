import type {
  CareerInterviewAction,
  CareerInterviewConflictView,
  CareerInterviewSessionView,
} from "@draft-loop/ui/career-interview-model";
import { careerInterviewRefusal } from "@draft-loop/ui/career-interview-model";
import { CareerInterviewPanel } from "@draft-loop/ui/career-interview-panel";
import type { SpeechInput } from "@draft-loop/ui/speech-to-text";
import { useCallback, useState } from "react";

import { type ApiClient, ApiRequestError, type ApiSchemas, describeError } from "./api-client.js";
import { createMicrophoneRecorder, microphoneSupported } from "./microphone.js";
import { useRecordId } from "./record-context.js";
import { createWhisperSpeechToText, speechModelAvailable } from "./whisper-speech.js";

/**
 * The web host's career interview (#2189): starts or resumes the record's conversation through
 * the API and sends each choice to the actions route. The server asks the model and publishes.
 */

export interface CareerInterviewSectionProps {
  readonly client: ApiClient;
  /** The record's selected knowledge bases, the first preselected; undefined until read. */
  readonly bases: readonly ApiSchemas["KnowledgeBase"][] | undefined;
}

/** What to tell the candidate when a career interview call is refused. */
export function careerInterviewProblem(error: unknown): string {
  return error instanceof ApiRequestError
    ? careerInterviewRefusal(error.code, error.message)
    : describeError(error);
}

/** The screen's view of the API's session: the fields the panel reads. */
export function careerInterviewSessionView(
  read: ApiSchemas["CareerInterviewSessionView"]["session"],
): CareerInterviewSessionView {
  return {
    id: read.id,
    status: read.status,
    topics: read.topics.map((topic) => ({
      key: topic.key,
      kind: topic.kind,
      reason: topic.reason,
      status: topic.status,
      turns: topic.turns.map((turn) => ({ role: turn.role, text: turn.text, mark: turn.mark })),
      summary: topic.summary,
    })),
    model: read.model,
  };
}

// One engine for the page, so the model loads once however often the panel renders.
let pageSpeech: SpeechInput | undefined;

/** Voice input on this page: Whisper in the browser, offered when the server serves its model. */
export function webSpeechInput(): SpeechInput | undefined {
  if (!microphoneSupported()) return undefined;
  pageSpeech ??= {
    recorder: createMicrophoneRecorder(),
    engine: createWhisperSpeechToText(),
    available: speechModelAvailable,
  };
  return pageSpeech;
}

export function CareerInterviewSection({ client, bases }: CareerInterviewSectionProps) {
  const workspaceId = useRecordId();
  const [session, setSession] = useState<CareerInterviewSessionView | undefined>(undefined);
  const [proposal, setProposal] = useState<string | undefined>(undefined);

  const show = useCallback((read: ApiSchemas["CareerInterviewSessionView"]) => {
    setSession(careerInterviewSessionView(read.session));
    setProposal(read.proposal);
  }, []);

  const loadConflicts = useCallback(
    async (topicKey: string): Promise<readonly CareerInterviewConflictView[]> => {
      if (session === undefined) return [];
      try {
        const read = await client.call(
          "GET /v1/workspaces/{workspaceId}/career-interview/sessions/{sessionId}/conflicts",
          { path: { workspaceId, sessionId: session.id }, query: { topic_key: topicKey } },
        );
        return read.conflicts.map((conflict) => ({
          summaryValue: conflict.summary_value,
          factValue: conflict.fact_value,
        }));
      } catch {
        // A difference not shown never blocks a confirmation; the candidate still reads the summary.
        return [];
      }
    },
    [client, workspaceId, session],
  );

  return (
    <CareerInterviewPanel
      session={session}
      proposal={proposal}
      knowledgeBases={(bases ?? []).map((base) => ({ id: base.id, name: base.displayName }))}
      onStart={async () => {
        try {
          show(
            await client.call("POST /v1/workspaces/{workspaceId}/career-interview/sessions", {
              path: { workspaceId },
            }),
          );
          return undefined;
        } catch (error) {
          return careerInterviewProblem(error);
        }
      }}
      onAction={async (action: CareerInterviewAction) => {
        if (session === undefined) return undefined;
        try {
          show(
            await client.call(
              "POST /v1/workspaces/{workspaceId}/career-interview/sessions/{sessionId}/actions",
              {
                path: { workspaceId, sessionId: session.id },
                body: action as ApiSchemas["CareerInterviewActionInput"],
              },
            ),
          );
          return undefined;
        } catch (error) {
          return careerInterviewProblem(error);
        }
      }}
      loadConflicts={loadConflicts}
      speech={webSpeechInput()}
    />
  );
}
