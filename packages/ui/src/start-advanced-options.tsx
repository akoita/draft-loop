import { t } from "@lingui/core/macro";

import { AdvancedOption, AdvancedOptions } from "./advanced-options.js";
import {
  rawJobDescriptionChoiceLabel,
  rawJobDescriptionChoiceNote,
  rawJobDescriptionOverDraftLabel,
} from "./start-requirements-model.js";

/** The choice to start from the raw job description while the brief is still a draft. */
export interface RawJobDescriptionOption {
  readonly chosen: boolean;
  readonly disabled?: boolean;
  readonly onChange: (chosen: boolean) => void;
}

/** A writing policy version imported for this job only. */
export interface PolicyOverrideOption {
  /** True once the opportunity brief is reviewed; an override needs a reviewed brief. */
  readonly reviewed: boolean;
  /** The override selected for the next run, when one is pending. */
  readonly pending: { readonly version: string | number; readonly checksumLabel: string } | null;
  readonly disabled: boolean;
  readonly onImport: () => void;
}

export interface StartAdvancedOptionsProps {
  /** Absent when the run has reviewed requirements or no job description to fall back to. */
  readonly rawJobDescription?: RawJobDescriptionOption | null;
  /** Absent where the screen offers the override elsewhere. */
  readonly policyOverride?: PolicyOverrideOption | null;
}

/** What is not at its default before a start, for the folded Advanced options line. */
export function startAdvancedNote(props: StartAdvancedOptionsProps): string | null {
  const notes = [
    props.rawJobDescription?.chosen === true ? t`raw job description` : null,
    props.policyOverride?.pending == null ? null : t`policy override`,
  ].filter((note) => note !== null);
  return notes.length === 0 ? null : notes.join(" · ");
}

/**
 * The review step's one Advanced options section: the requirements a run starts from and the
 * per-job writing policy override. Starting from the raw job description is never a silent
 * fallback, so the line under the fold states it while it is chosen.
 */
export function StartAdvancedOptions(props: StartAdvancedOptionsProps) {
  const { rawJobDescription = null, policyOverride = null } = props;
  if (rawJobDescription === null && policyOverride === null) return null;
  return (
    <section aria-label={t`Advanced options for this run`}>
      <AdvancedOptions note={startAdvancedNote(props)}>
        {rawJobDescription === null ? null : (
          <AdvancedOption
            title={rawJobDescriptionChoiceLabel()}
            state={rawJobDescription.chosen ? t`On` : t`Off`}
            effect={rawJobDescriptionChoiceNote()}
          >
            <button
              className="button button-outline"
              type="button"
              aria-pressed={rawJobDescription.chosen}
              disabled={rawJobDescription.disabled ?? false}
              onClick={() => rawJobDescription.onChange(!rawJobDescription.chosen)}
            >
              {rawJobDescription.chosen
                ? t`Wait for the reviewed requirements`
                : t`Use the raw job description`}
            </button>
          </AdvancedOption>
        )}
        {policyOverride === null ? null : (
          <AdvancedOption
            title={t`Writing policy override for this job`}
            state={
              policyOverride.pending === null
                ? null
                : `${policyOverride.pending.version} (${policyOverride.pending.checksumLabel})`
            }
            effect={
              policyOverride.reviewed
                ? t`Import a policy version for this reviewed job without changing the workspace policy.`
                : t`Review the requirements before importing an override.`
            }
          >
            <button
              className="button button-outline"
              type="button"
              disabled={policyOverride.disabled || !policyOverride.reviewed}
              onClick={policyOverride.onImport}
            >{t`Import opportunity override`}</button>
          </AdvancedOption>
        )}
      </AdvancedOptions>
      {rawJobDescription?.chosen === true ? (
        <p className="start-requirements-line" role="status">
          {rawJobDescriptionOverDraftLabel()}
        </p>
      ) : null}
    </section>
  );
}
