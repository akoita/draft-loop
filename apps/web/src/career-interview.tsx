import type { CareerInterviewLiveVoice } from "@draft-loop/ui/career-interview-live";
import type {
  CareerInterviewAction,
  CareerInterviewConflictView,
  CareerInterviewSessionView,
} from "@draft-loop/ui/career-interview-model";
import { careerInterviewRefusal } from "@draft-loop/ui/career-interview-model";
import { CareerInterviewPanel } from "@draft-loop/ui/career-interview-panel";
import type { SpeechInput } from "@draft-loop/ui/speech-to-text";
import { useCallback, useMemo, useState } from "react";

import { type ApiClient, ApiRequestError, type ApiSchemas, describeError } from "./api-client.js";
import { isConsentProvider } from "./consent-model.js";
import {
  createBrowserPlayer,
  liveVoiceSupported,
  openBrowserMicrophone,
  startLiveVoiceCall,
} from "./live-voice.js";
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
  interviewerAvailable?: boolean,
  liveVoiceAvailable?: boolean,
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
    interviewerAvailable,
    liveVoiceAvailable,
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

/** The language the interviewer speaks in: the browser's, French or English. */
export function liveLanguage(languages: readonly string[]): "fr" | "en" {
  return languages[0]?.toLowerCase().startsWith("fr") === true ? "fr" : "en";
}

/** Live voice on this page, when the browser can capture audio and the client opens sockets. */
function liveVoice(
  client: ApiClient,
  workspaceId: string,
  sessionId: string,
  show: (read: ApiSchemas["CareerInterviewSessionView"]) => void,
): CareerInterviewLiveVoice | undefined {
  const openSocket = client.openSocket?.bind(client);
  if (openSocket === undefined || !liveVoiceSupported()) return undefined;
  return {
    listener: "Google Cloud in the EU",
    start: (topicKey, events) =>
      startLiveVoiceCall({
        socket: openSocket(
          "/v1/workspaces/{workspaceId}/career-interview/sessions/{sessionId}/live",
          {
            path: { workspaceId, sessionId },
            query: { topic_key: topicKey, language: liveLanguage(navigator.languages) },
          },
          "draft-loop.live",
        ),
        microphone: openBrowserMicrophone,
        player: createBrowserPlayer(),
        events,
        onSession: (view) => show(view as ApiSchemas["CareerInterviewSessionView"]),
      }),
    allow: () => allowLiveListener(client, workspaceId, "google"),
  };
}

/**
 * Adds the live listener to the record's transmission grant, keeping every provider it named:
 * the candidate pressed the button that says their voice goes there.
 */
export async function allowLiveListener(
  client: ApiClient,
  workspaceId: string,
  listener: "google",
): Promise<string | undefined> {
  try {
    const consents = await client.call("GET /v1/workspaces/{workspaceId}/consents", {
      path: { workspaceId },
    });
    const current = consents.current["provider-transmission"];
    const providers =
      current?.action === "granted"
        ? [...new Set([...current.providers, listener])].filter(isConsentProvider).sort()
        : [];
    if (providers.length === 0) {
      return "Record the permission to send material to model providers on the consent step first.";
    }
    await client.call("POST /v1/workspaces/{workspaceId}/consents", {
      path: { workspaceId },
      body: {
        kind: "provider-transmission",
        action: "granted",
        basis: "candidate-consent",
        providers,
        note: "Live voice in the career interview",
      },
    });
    return undefined;
  } catch (error) {
    return describeError(error);
  }
}

export function CareerInterviewSection({ client, bases }: CareerInterviewSectionProps) {
  const workspaceId = useRecordId();
  const [session, setSession] = useState<CareerInterviewSessionView | undefined>(undefined);
  const [proposal, setProposal] = useState<string | undefined>(undefined);

  const show = useCallback((read: ApiSchemas["CareerInterviewSessionView"]) => {
    setSession(
      careerInterviewSessionView(
        read.session,
        read.interviewer_available,
        read.live_voice_available,
      ),
    );
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

  const sessionId = session?.id;
  const live = useMemo(
    () => (sessionId === undefined ? undefined : liveVoice(client, workspaceId, sessionId, show)),
    [client, workspaceId, sessionId, show],
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
      live={live}
    />
  );
}
