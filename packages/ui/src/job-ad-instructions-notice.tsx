import { plural, t } from "@lingui/core/macro";
/**
 * The Job tab's notice for instructions in a job ad written for AI tools (#3336).
 *
 * Some job ads ask AI writing tools to add a word or start with a phrase, often in text the reader
 * cannot see, so an AI-written application gives itself away. The models never read these
 * sentences; the notice tells the person what was left out and why, without judging the employer.
 */

import type { JSX } from "react";
import type { JobAdInstruction } from "./application-job-contract.js";

export function JobAdInstructionsNotice({
  instructions,
}: {
  readonly instructions: readonly JobAdInstruction[];
}): JSX.Element | null {
  if (instructions.length === 0) return null;
  const count = instructions.length;
  return (
    <section className="job-ai-notice" aria-label={t`Instructions written for AI tools`}>
      <p className="job-ai-notice-title">
        {plural(count, {
          one: "This job ad has # instruction written for AI tools",
          other: "This job ad has # instructions written for AI tools",
        })}
      </p>
      <p className="job-ai-notice-copy">{t`Some job ads include requests meant for AI writing tools, often in text you can't see on the page. A draft that follows one can show the reader that AI wrote it. Redakloop leaves them out of what its models read.`}</p>
      <ul className="job-ai-notice-list">
        {instructions.map((instruction) => (
          <li
            key={`${instruction.hidden ? "hidden" : "shown"}-${instruction.text}`}
            className="job-ai-notice-item"
          >
            <span className="job-ai-notice-where">
              {instruction.hidden ? t`Hidden on the page` : t`In the job ad`}
            </span>
            <q className="job-ai-notice-text">{instruction.text}</q>
            {instruction.words.length === 0 ? null : (
              <span className="job-ai-notice-words">
                {t`Words it asks for:`} {instruction.words.join(", ")}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="job-ai-notice-copy">{t`If one is a real request from the employer, such as a word to show you read the ad, add it yourself when you write. Check my letter points out these words in your letter.`}</p>
    </section>
  );
}
