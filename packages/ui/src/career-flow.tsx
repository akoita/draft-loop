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
  "Your career evidence is the documents you provide: CVs, career-fact files, exports and links. DraftLoop searches them during reviews and builds your career profile from them.";

export const careerProfileIntro =
  "Your career profile is the facts DraftLoop extracts from your documents: roles, dates, achievements and skills, each with an exact quote. You review it once, and every application reuses the reviewed version.";

/** Shown on the Career evidence page while a profile generation reads the evidence. */
export const careerEvidenceLockedDuringGeneration =
  "Your career profile is being generated from this evidence. You can look around; changes to your evidence are available again once it is generated.";

export const careerEvidenceCardSubtitle =
  "Your documents: CVs, career-fact files, exports and links. DraftLoop searches them and builds your profile from them.";

export const careerProfileCardSubtitle =
  "The facts DraftLoop extracts from your documents, each with its exact quote. You review them once; every application reuses them.";

/** The Your career panel on Home: one line on how the two steps relate. */
export const careerPanelSummary =
  "You give the documents, DraftLoop builds the facts, and every application reuses them.";

/** Who does the work in each step of the Your career panel. */
export const careerEvidenceRole = "What you give";
export const careerProfileRole = "What DraftLoop builds, you check";

/**
 * "Career evidence → Career profile → Applications", with the current step marked for assistive
 * technology. A step with a handler in `onOpen` is a button that opens its page directly; the
 * current step never is.
 */
export function CareerFlowStrip({
  current,
  onOpen = {},
}: {
  readonly current: CareerFlowStep;
  readonly onOpen?: Partial<Readonly<Record<CareerFlowStep, () => void>>>;
}) {
  return (
    <ol className="career-flow" aria-label="Career flow">
      {flowSteps.map(({ step, label }, index) => {
        const open = step === current ? undefined : onOpen[step];
        return (
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
            {open === undefined ? (
              label
            ) : (
              <button className="career-flow-link" type="button" onClick={open}>
                {label}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
