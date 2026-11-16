import { t } from "@lingui/core/macro";

import { DisplayChoiceCard, useDisplayPreference } from "./display-preference.js";

/**
 * The one question a new person answers on their first Home (#2790): be guided step by step, or
 * see everything. "Decide later" keeps the simple view. Each answer saves the preference, so the
 * question never comes back; change it later in Workspace settings > Display.
 */
export function FirstRunQuestion() {
  const { preference, choose } = useDisplayPreference();
  if (choose === undefined || preference.mode !== null) return null;
  return (
    <div className="first-run-question">
      <DisplayChoiceCard
        heading={t`How would you like to start?`}
        headingLevel={2}
        wording="first-run"
        current={null}
        quietLabel={t`Decide later`}
        onChoose={(mode) => choose({ ...preference, mode })}
      />
      <p className="subtle">{t`You can change this any time in Workspace settings.`}</p>
    </div>
  );
}
