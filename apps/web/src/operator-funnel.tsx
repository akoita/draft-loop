import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";

import type { ApiClient, ApiSchemas } from "./api-client.js";

export type UsageFunnelReport = ApiSchemas["UsageFunnel"];
type Step = UsageFunnelReport["cohort"][number]["step"];

export type FunnelState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly funnel: UsageFunnelReport };

/** Reads the content-free usage funnel for the last eight weeks (#2834). */
export async function readUsageFunnel(client: ApiClient): Promise<FunnelState> {
  try {
    const funnel = await client.call("GET /v1/operator/usage-funnel", { query: { weeks: 8 } });
    return { kind: "ready", funnel };
  } catch {
    return { kind: "failed" };
  }
}

function stepLabel(step: Step): string {
  switch (step) {
    case "signedIn":
      return t`Signed in`;
    case "evidence":
      return t`Added career evidence`;
    case "briefReviewed":
      return t`Reviewed a job brief`;
    case "draftFinished":
      return t`Finished a draft`;
    case "approved":
      return t`Approved a draft`;
    case "exported":
      return t`Exported`;
    case "prepared":
      return t`Saved a Prepare item`;
  }
}

function percent(share: number | null): string {
  return share === null ? "" : `${Math.round(share * 100)}%`;
}

/** The funnel: where this window's new organisations stopped, then each week's first steps. */
export function UsageFunnelView({ state }: { readonly state: FunnelState }) {
  if (state.kind === "loading") return <p role="status">{t`Reading…`}</p>;
  if (state.kind === "failed") {
    return (
      <p className="problem" role="alert">
        {t`The usage funnel could not be read. Try Refresh.`}
      </p>
    );
  }
  const { funnel } = state;
  const steps = funnel.cohort.map((each) => each.step);
  return (
    <section className="operator-funnel" aria-label={t`Usage`}>
      <p className="muted">
        {t`Counts only, from existing records: no organisation is named or shown alone, and no candidate material is read. Weeks run Monday to Sunday, UTC.`}
      </p>
      <h2>{t`Where new organisations stop`}</h2>
      <p className="muted">{t`Organisations first signed in during the last 8 weeks, and how far each got.`}</p>
      <table className="operator-funnel-table">
        <thead>
          <tr>
            <th scope="col">{t`Step`}</th>
            <th scope="col">{t`Organisations`}</th>
            <th scope="col">{t`Of the step before`}</th>
          </tr>
        </thead>
        <tbody>
          {funnel.cohort.map((each) => (
            <tr key={each.step}>
              <th scope="row">{stepLabel(each.step)}</th>
              <td>{each.reached}</td>
              <td>{percent(each.fromPrevious)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>{t`Week by week`}</h2>
      <p className="muted">{t`Members who first signed in, organisations reaching each step for the first time, and organisations active that week.`}</p>
      <div className="operator-funnel-scroll">
        <table className="operator-funnel-table">
          <thead>
            <tr>
              <th scope="col">{t`Week of`}</th>
              <th scope="col">{t`Sign-ups`}</th>
              {steps
                .filter((step) => step !== "signedIn")
                .map((step) => (
                  <th scope="col" key={step}>
                    {stepLabel(step)}
                  </th>
                ))}
              <th scope="col">{t`Active`}</th>
            </tr>
          </thead>
          <tbody>
            {funnel.weeks.map((week) => (
              <tr key={week.weekStart}>
                <th scope="row">{week.weekStart}</th>
                <td>{week.signUps}</td>
                {steps
                  .filter((step) => step !== "signedIn")
                  .map((step) => (
                    <td key={step}>{week.firsts[step]}</td>
                  ))}
                <td>{week.activeOrganisations}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">{t`${funnel.organisations} organisations read in all.`}</p>
    </section>
  );
}

/** The Usage section of the Operator screen: reads the funnel when it opens. */
export function UsageFunnelSection({ client }: { readonly client: ApiClient }) {
  const [state, setState] = useState<FunnelState>({ kind: "loading" });
  useEffect(() => {
    let current = true;
    void readUsageFunnel(client).then((next) => {
      if (current) setState(next);
    });
    return () => {
      current = false;
    };
  }, [client]);
  return <UsageFunnelView state={state} />;
}
