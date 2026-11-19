import { createContext, useContext } from "react";

/**
 * Opens the job step's "Replace the job description" inputs, so a step whose job page could not
 * be read offers Paste text or Attach file in place (#2942). Null outside a job step.
 */
export const OpenJobReplacement = createContext<(() => void) | null>(null);

export function useOpenJobReplacement(): (() => void) | null {
  return useContext(OpenJobReplacement);
}
