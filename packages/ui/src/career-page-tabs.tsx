import { t } from "@lingui/core/macro";
import type { CareerFlowStep } from "./career-flow.js";

type CareerPage = Extract<CareerFlowStep, "evidence" | "profile">;

const tabs = (): readonly {
  readonly page: CareerPage;
  readonly number: 1 | 2;
  readonly label: string;
}[] => [
  { page: "evidence", number: 1, label: t`Career evidence` },
  { page: "profile", number: 2, label: t`Career profile` },
];

/**
 * The shared header of the two career pages: "1 Career evidence" and "2 Career profile" as tabs,
 * so a person who opened the wrong one is one click from the right one. Each tab is its own page,
 * so this is page navigation with `aria-current`, not an ARIA tablist. A tab without a handler in
 * `onOpen` is left out, such as Career profile on a host with no profile workflow.
 */
export function CareerPageTabs({
  current,
  onOpen = {},
}: {
  readonly current: CareerPage;
  readonly onOpen?: Partial<Readonly<Record<CareerFlowStep, () => void>>>;
}) {
  const openApplications = onOpen.applications;
  return (
    <nav className="career-tabs" aria-label={t`Your career`}>
      <ul className="career-tabs-list">
        {tabs().map(({ page, number, label }) => {
          const open = onOpen[page];
          if (page !== current && open === undefined) return null;
          const content = (
            <>
              <span className="career-step-number" aria-hidden="true">
                {number}
              </span>
              {label}
            </>
          );
          return (
            <li key={page}>
              {page === current ? (
                <span className="career-tab career-tab-current" aria-current="page">
                  {content}
                </span>
              ) : (
                <button className="career-tab" type="button" onClick={open}>
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {openApplications === undefined ? null : (
        <button
          className="career-tabs-applications"
          type="button"
          onClick={openApplications}
        >{t`Applications`}</button>
      )}
    </nav>
  );
}
