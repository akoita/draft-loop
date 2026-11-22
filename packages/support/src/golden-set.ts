import type { HelpSectionId } from "@draft-loop/user-guide";

import type { SupportLanguage } from "./ports.js";

/**
 * Questions members are expected to ask, with the guide sections a good answer relies on or the
 * refusal it must give (#2882). The fake-provider test checks that guide search reaches an
 * expected section for each answerable question; the paid evaluation (#2884) checks the real
 * model's answers, refusals included.
 */
export interface SupportGoldenQuestion {
  readonly id: string;
  readonly language: SupportLanguage;
  readonly question: string;
  readonly expect:
    | { readonly sections: readonly HelpSectionId[] }
    | { readonly refuse: "off_topic" | "cv_content" };
}

export const supportGoldenSet: readonly SupportGoldenQuestion[] = [
  {
    id: "en-upload-cv",
    language: "en",
    question: "How do I upload my CV?",
    expect: { sections: ["evidence"] },
  },
  {
    id: "en-no-cv",
    language: "en",
    question: "I don't have a resume, can I still start?",
    expect: { sections: ["evidence"] },
  },
  {
    id: "en-fix-fact",
    language: "en",
    question: "A fact in my profile is wrong, how do I fix it?",
    expect: { sections: ["evidence"] },
  },
  {
    id: "en-add-job",
    language: "en",
    question: "Where do I paste the job posting?",
    expect: { sections: ["job"] },
  },
  {
    id: "en-job-link",
    language: "en",
    question: "Can I add a job from its link?",
    expect: { sections: ["job"] },
  },
  {
    id: "en-start-run",
    language: "en",
    question: "How do I generate a CV for a job?",
    expect: { sections: ["draft", "job"] },
  },
  {
    id: "en-critic",
    language: "en",
    question: "What is the critic model?",
    expect: { sections: ["draft"] },
  },
  {
    id: "en-approve",
    language: "en",
    question: "How do I approve the findings?",
    expect: { sections: ["review"] },
  },
  {
    id: "en-pdf",
    language: "en",
    question: "How can I download my CV as a PDF?",
    expect: { sections: ["review"] },
  },
  {
    id: "en-word",
    language: "en",
    question: "Can I export to Word?",
    expect: { sections: ["review"] },
  },
  {
    id: "en-cover-letter",
    language: "en",
    question: "Can Redakloop write a cover letter?",
    expect: { sections: ["prepare"] },
  },
  {
    id: "en-interview",
    language: "en",
    question: "How do I prepare for the interview?",
    expect: { sections: ["prepare"] },
  },
  {
    id: "en-simple",
    language: "en",
    question: "How do I see fewer options on screen?",
    expect: { sections: ["display"] },
  },
  {
    id: "en-theme",
    language: "en",
    question: "How do I change the theme or the language?",
    expect: { sections: ["display"] },
  },
  {
    id: "en-mcp",
    language: "en",
    question: "How do I connect Claude or Codex through MCP?",
    expect: { sections: ["agents"] },
  },
  {
    id: "en-token",
    language: "en",
    question: "Where do I create an agent token?",
    expect: { sections: ["agents"] },
  },
  {
    id: "en-price",
    language: "en",
    question: "How much does it cost?",
    expect: { sections: ["credits"] },
  },
  {
    id: "en-refund",
    language: "en",
    question: "Can I get a refund on credits?",
    expect: { sections: ["credits"] },
  },
  {
    id: "en-delete",
    language: "en",
    question: "How do I delete my data and my account?",
    expect: { sections: ["privacy"] },
  },
  {
    id: "en-stuck",
    language: "en",
    question: "My run failed with an error, what now?",
    expect: { sections: ["problems"] },
  },
  {
    id: "en-contact",
    language: "en",
    question: "How can I contact support?",
    expect: { sections: ["problems"] },
  },
  {
    id: "en-off-topic",
    language: "en",
    question: "What's the weather in Paris tomorrow?",
    expect: { refuse: "off_topic" },
  },
  {
    id: "en-code",
    language: "en",
    question: "Write me a Python script that sorts a list.",
    expect: { refuse: "off_topic" },
  },
  {
    id: "en-rewrite-cv",
    language: "en",
    question: "Rewrite this bullet so it sounds better: led a team of five engineers.",
    expect: { refuse: "cv_content" },
  },
  {
    id: "fr-upload-cv",
    language: "fr",
    question: "Comment ajouter mon CV ?",
    expect: { sections: ["evidence"] },
  },
  {
    id: "fr-no-cv",
    language: "fr",
    question: "Je n'ai pas de CV, est-ce que je peux commencer ?",
    expect: { sections: ["evidence"] },
  },
  {
    id: "fr-add-job",
    language: "fr",
    question: "Où coller l'annonce du poste ?",
    expect: { sections: ["job"] },
  },
  {
    id: "fr-start-run",
    language: "fr",
    question: "Comment lancer un brouillon ?",
    expect: { sections: ["draft"] },
  },
  {
    id: "fr-export",
    language: "fr",
    question: "Comment exporter mon CV en PDF ?",
    expect: { sections: ["review"] },
  },
  {
    id: "fr-letter",
    language: "fr",
    question: "Pouvez-vous rédiger une lettre de motivation ?",
    expect: { sections: ["prepare"] },
  },
  {
    id: "fr-interview",
    language: "fr",
    question: "Comment préparer mon entretien ?",
    expect: { sections: ["prepare"] },
  },
  {
    id: "fr-display",
    language: "fr",
    question: "Comment changer le thème de l'écran ?",
    expect: { sections: ["display"] },
  },
  {
    id: "fr-agent",
    language: "fr",
    question: "Comment utiliser Redakloop avec un agent comme Claude ?",
    expect: { sections: ["agents"] },
  },
  {
    id: "fr-price",
    language: "fr",
    question: "Combien coûtent les crédits ?",
    expect: { sections: ["credits"] },
  },
  {
    id: "fr-refund",
    language: "fr",
    question: "Puis-je être remboursé ?",
    expect: { sections: ["credits"] },
  },
  {
    id: "fr-data",
    language: "fr",
    question: "Où sont stockées mes données ?",
    expect: { sections: ["privacy"] },
  },
  {
    id: "fr-error",
    language: "fr",
    question: "J'ai une erreur, le brouillon est bloqué.",
    expect: { sections: ["problems"] },
  },
  {
    id: "fr-off-topic",
    language: "fr",
    question: "Quelle est la capitale de l'Australie ?",
    expect: { refuse: "off_topic" },
  },
  {
    id: "fr-rewrite-cv",
    language: "fr",
    question: "Corrige mon CV : j'ai géré une équipe de cinq personnes.",
    expect: { refuse: "cv_content" },
  },
  {
    id: "fr-recipe",
    language: "fr",
    question: "Donne-moi une recette de crêpes.",
    expect: { refuse: "off_topic" },
  },
];
