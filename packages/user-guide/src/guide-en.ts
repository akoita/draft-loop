import type { HelpGuide } from "./guide.js";

export const englishHelpGuide: HelpGuide = {
  intro:
    "DraftLoop turns your career evidence into a CV for one job. Follow the first five steps in order the first time, or search for what you need.",
  sections: [
    {
      id: "evidence",
      title: "Add your career evidence",
      paragraphs: [
        "From Home, open Career evidence. Add a CV or other documents, paste text, or start a conversation and tell your story if you have no CV.",
        "DraftLoop reads what you add and lists the facts it found. Then open Career profile and confirm or fix each fact. Your CVs use only the facts you keep.",
      ],
      keywords: [
        "CV",
        "resume",
        "upload",
        "file",
        "document",
        "paste",
        "interview",
        "facts",
        "profile",
      ],
      screenshot: {
        alt: "Home, Your career: one document in Career evidence and a reviewed Career profile built from it.",
      },
    },
    {
      id: "job",
      title: "Add a job",
      paragraphs: [
        "On Home, select New application. Give the job a name, paste its description or its link, then select Create application.",
        "DraftLoop lists the job's requirements. Read them and fix any that look wrong, since the draft is written against them.",
        "DraftLoop is tuned and tested on software and tech roles so far. It works for other jobs too, such as nursing, sales, teaching or a trade, so check those drafts a little more closely. Support for more professions is on our roadmap.",
      ],
      keywords: [
        "application",
        "job offer",
        "posting",
        "link",
        "URL",
        "requirements",
        "role",
        "profession",
        "sector",
        "non-tech",
      ],
      screenshot: {
        alt: "The New application dialog with a role name and a pasted job description.",
      },
    },
    {
      id: "draft",
      title: "Run a draft",
      paragraphs: [
        "On the application, start a run. One model writes the CV and a second model checks each claim against your evidence.",
        "A run takes a few minutes, and you can leave the page while it works. If a run stops, the screen says whether it will recover by itself and how long to wait.",
      ],
      keywords: ["run", "start", "generate", "write", "model", "author", "critic"],
      screenshot: {
        alt: "An application's run header: draft, critique and revise are done, and approval is next.",
      },
    },
    {
      id: "review",
      title: "Review and export",
      paragraphs: [
        "When the run is ready, read the draft and each finding. Accept or reject each finding, then select Approve artifact.",
        "Once it is approved, pick a template and select Export to save the file. You can export again later in another template.",
      ],
      keywords: ["finding", "approve", "download", "PDF", "Word", "template", "save"],
      screenshot: {
        alt: "The Findings panel: two blocking findings to accept, reject, defer or override, then Approve artifact.",
      },
    },
    {
      id: "prepare",
      title: "Prepare for the job",
      paragraphs: [
        "On an application, open Prepare to draft a cover letter or an interview preparation guide from the same evidence. It is folded by default.",
        "Each paid application includes 20 Prepare drafts, guides and research runs.",
      ],
      keywords: ["cover letter", "letter", "interview", "questions", "preparation"],
      screenshot: {
        alt: "The Prepare panel of an application, with Cover letter and Interview preparation guide.",
      },
    },
    {
      id: "display",
      title: "Choose how much you see",
      paragraphs: [
        "In Settings, Display offers three choices. Guided shows one thing to do at a time, Simple shows the basic path, and Show everything opens every option.",
        "Technical choices, such as models, sit under Advanced options at the bottom of a card. You never need them for the basic path.",
      ],
      keywords: ["settings", "guided", "simple", "advanced", "options", "language", "theme"],
      screenshot: { alt: "Settings, Display: Guide me step by step, Simple and Show everything." },
    },
    {
      id: "agents",
      title: "Work with an agent",
      paragraphs: [
        "An AI agent such as Claude Code or Codex can use DraftLoop for you through MCP. In Settings, open Agents, create a token for the agent and follow the setup steps shown there.",
        "A connected agent can list your applications, add a job, start a CV run and draft cover letters. It can also note work you shipped in your Work journal; a note becomes career evidence only after you approve it.",
      ],
      keywords: ["MCP", "Claude", "Codex", "token", "work journal", "assistant", "automation"],
      screenshot: {
        alt: "Settings, Agents: notes from agents, connected agents and Connect an agent.",
      },
    },
    {
      id: "credits",
      title: "Plans and credits",
      paragraphs: [
        "Your plan sets what you can use. Credits and consent shows your plan, its limits and your credit balance.",
        "Before a run starts, DraftLoop shows the credits it will reserve; a started run counts at once. A run that leaves no draft is refunded. Where the service sells them, Buy credits lists the credit packs.",
      ],
      keywords: ["price", "cost", "pay", "buy", "billing", "plan", "limit", "free", "refund"],
    },
    {
      id: "privacy",
      title: "Privacy and your data",
      paragraphs: [
        "DraftLoop stores your material only after you give consent, and keeps it in the EU. It sends model providers only the material a step needs.",
        "Mark a section as private to keep it out of drafts and away from model providers. From the account menu you can download everything. To delete all your documents and applications, or your account, open Account settings in that menu: both sit in its Danger zone and ask you to type a confirmation first.",
      ],
      keywords: [
        "consent",
        "GDPR",
        "delete",
        "erase",
        "export",
        "private",
        "sensitive",
        "security",
      ],
    },
    {
      id: "problems",
      title: "When something goes wrong",
      paragraphs: [
        "If a step fails, read the message on the screen first: it says whether the step will recover by itself or what to do. A refused upload often means consent is not recorded yet.",
        "If this guide does not answer your question, open Help in the header and choose Send feedback and describe what happened. The people who run DraftLoop read every note.",
        "A note goes with technical details: the page, the version, the last error codes and your browser family. Open What we include in the dialog to see each value. Your CV, job descriptions, page text and screenshots are never sent.",
      ],
      keywords: ["error", "bug", "failed", "stuck", "broken", "support", "contact", "feedback"],
    },
  ],
};
