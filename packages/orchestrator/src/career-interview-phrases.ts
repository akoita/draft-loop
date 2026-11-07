/**
 * The career interview's fixed sentences in the conversation's language (#2419, #2420): the
 * interviewer's safe turns, said and spoken without a model, and the evidence file's labels. The
 * server words these, so they live in a typed table rather than the screens' catalogs. English is
 * the default for any other language.
 */
export interface CareerInterviewPhrases {
  readonly fallbackQuestion: string;
  readonly summaryRequest: string;
  readonly leaveTopic: string;
  readonly evidence: {
    readonly title: string;
    readonly intro: string;
    readonly topic: string;
    readonly summary: string;
    readonly conversation: string;
    readonly interviewer: string;
    readonly candidate: string;
    readonly skipped: string;
    readonly unknown: string;
    readonly noWords: string;
  };
}

const english: CareerInterviewPhrases = {
  fallbackQuestion: "What would you like to tell me about this, in your own words?",
  summaryRequest: "Here is what I noted. Is it right, or would you like to change anything?",
  leaveTopic: "Let us leave this topic for now. We can come back to it whenever you like.",
  evidence: {
    title: "Career interview",
    intro:
      "Candidate-provided evidence: a topic from a guided career interview, summarised and confirmed by the candidate.",
    topic: "Topic",
    summary: "Confirmed summary",
    conversation: "Conversation",
    interviewer: "Interviewer",
    candidate: "Candidate",
    skipped: "(skipped this question)",
    unknown: "(said they did not know)",
    noWords: "No words recorded.",
  },
};

const french: CareerInterviewPhrases = {
  fallbackQuestion: "Que voudriez-vous m’en dire, avec vos propres mots ?",
  summaryRequest: "Voici ce que j’ai noté. Est-ce juste, ou voulez-vous changer quelque chose ?",
  leaveTopic:
    "Laissons ce sujet pour le moment. Nous pourrons y revenir quand vous le souhaiterez.",
  evidence: {
    title: "Entretien de parcours",
    intro:
      "Élément fourni par le candidat : un sujet d’un entretien de parcours guidé, résumé et confirmé par le candidat.",
    topic: "Sujet",
    summary: "Résumé confirmé",
    conversation: "Conversation",
    interviewer: "Intervieweur",
    candidate: "Candidat",
    skipped: "(a passé cette question)",
    unknown: "(a dit ne pas savoir)",
    noWords: "Aucune parole enregistrée.",
  },
};

/** The fixed sentences for a language code such as `fr` or `fr-FR`; English otherwise. */
export function careerInterviewPhrases(language: string | undefined): CareerInterviewPhrases {
  return language?.trim().toLowerCase().split("-")[0] === "fr" ? french : english;
}
