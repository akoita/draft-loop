/**
 * The explanation shared by Home and the two career pages: Career evidence is what the candidate
 * provides, the Career profile is the reviewed record built from it, and Applications reuse that
 * record. Wording lives here so the intros, the Home card subtitles and the flow strip agree.
 */

export type CareerFlowStep = "evidence" | "profile" | "applications";

const flowSteps: readonly { readonly step: CareerFlowStep; readonly label: string }[] = [
  { step: "evidence", label: "Career evidence" },
  { step: "profile", label: "Career profile" },
  { step: "applications", label: "Applications" },
];

export const careerEvidenceIntro =
  "Your career evidence is the raw material you provide — CVs, career-fact files, exports and links. DraftLoop searches it during reviews and builds your career profile from it.";

export const careerProfileIntro =
  "Your career profile is the structured, verified record DraftLoop extracts from your evidence — roles, dates, achievements and skills, each with an exact quote. You review it once, and every application reuses the reviewed version.";

export const careerEvidenceCardSubtitle =
  "The raw material you provide: CVs, career-fact files, exports and links. DraftLoop searches it and builds your profile from it.";

export const careerProfileCardSubtitle =
  "The verified record DraftLoop extracts from your evidence, with an exact quote for each fact. You review it once; every application reuses it.";

/** "Career evidence → Career profile → Applications", with the current step marked for assistive technology. */
export function CareerFlowStrip({ current }: { readonly current: CareerFlowStep }) {
  return (
    <ol className="career-flow" aria-label="Career flow">
      {flowSteps.map(({ step, label }, index) => (
        <li
          key={step}
          className="career-flow-step"
          {...(step === current ? { "aria-current": "step" as const } : {})}
        >
          {index === 0 ? null : (
            <span className="career-flow-arrow" aria-hidden="true">
              →
            </span>
          )}
          {label}
        </li>
      ))}
    </ol>
  );
}
