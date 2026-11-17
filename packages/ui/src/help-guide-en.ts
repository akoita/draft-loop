import type { HelpGuide } from "./help-guide.js";

export const englishHelpGuide: HelpGuide = {
  intro:
    "DraftLoop turns your career evidence into a CV for one job. Follow these steps in order the first time.",
  sections: [
    {
      id: "evidence",
      title: "Add your career evidence",
      paragraphs: [
        "From Home, open Career evidence. Add a CV or other documents, paste text, or start a conversation and tell your story if you have no CV.",
        "DraftLoop reads what you add and lists the facts it found. Then open Career profile and confirm or fix each fact. Your CVs use only the facts you keep.",
      ],
    },
    {
      id: "job",
      title: "Add a job",
      paragraphs: [
        "On Home, select New application. Give the job a name, paste its description or its link, then select Create application.",
        "DraftLoop lists the job's requirements. Read them and fix any that look wrong, since the draft is written against them.",
      ],
    },
    {
      id: "draft",
      title: "Run a draft",
      paragraphs: [
        "On the application, start a run. One model writes the CV and a second model checks each claim against your evidence.",
        "A run takes a few minutes, and you can leave the page while it works. If a run stops, the screen says whether it will recover by itself and how long to wait.",
      ],
    },
    {
      id: "review",
      title: "Review and export",
      paragraphs: [
        "When the run is ready, read the draft and each finding. Accept or reject each finding, then select Approve artifact.",
        "Once it is approved, pick a template and select Export to save the file. You can export again later in another template.",
      ],
    },
    {
      id: "prepare",
      title: "Prepare for the job",
      paragraphs: [
        "On an application, open Prepare to draft a cover letter or an interview preparation guide from the same evidence. It is folded by default.",
        "Each paid application includes 20 Prepare drafts, guides and research runs.",
      ],
    },
    {
      id: "display",
      title: "Choose how much you see",
      paragraphs: [
        "In Workspace settings, Display offers three choices. Guided shows one thing to do at a time, Simple shows the basic path, and Show everything opens every option.",
        "Technical choices, such as models, sit under Advanced options at the bottom of a card. You never need them for the basic path.",
      ],
    },
  ],
};
