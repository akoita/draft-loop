import { describe, expect, it, vi } from "vitest";

import type { OpportunityExtractionRequest } from "./opportunity-extraction.js";
import {
  createOpportunityDraft,
  OpportunityJobTextGarbledError,
  opportunityJobTextGarbledMessage,
} from "./opportunity-intake.js";

// Shaped like the job text a broken PDF text layer produced.
const garbled = `Pays / FsaocG / ViHHG Tch Ld FsaocG ViHHG Pays dvlppmnt Fsc ViHHG
FsaocG Pays rsNP / ViHHG xprnc FsaocG mnGT Pays ViHHG FsaocG dTbs ViHHG Pays FsaocG
qlfctns ViHHG FsaocG Pays ViHHG FsaocG Pays ViHHG cmmnctn FsaocG ViHHG Pays FsaocG`;

const pasted = (content: string, classification: "job-posting" | "company-context") => ({
  id: "job-source",
  kind: "pasted-content" as const,
  classification,
  content,
});

const emptyProposal = {
  schemaVersion: 1,
  role: null,
  employer: null,
  responsibilities: [],
  requirements: [],
  priorities: [],
  contradictions: [],
};

describe("job text quality at intake", () => {
  it("refuses garbled job text before any provider call", async () => {
    const extract = vi.fn();
    const attempt = createOpportunityDraft(
      { sources: [pasted(garbled, "job-posting")] },
      { extractor: { extract } },
    );

    await expect(attempt).rejects.toBeInstanceOf(OpportunityJobTextGarbledError);
    await expect(attempt).rejects.toThrow(opportunityJobTextGarbledMessage);
    expect(opportunityJobTextGarbledMessage).toContain(
      "Import the job again from the original PDF",
    );
    expect(extract).not.toHaveBeenCalled();
  });

  it("does not judge company context", async () => {
    const extract = vi.fn(async () => emptyProposal);
    await createOpportunityDraft(
      { sources: [pasted(garbled, "company-context")] },
      { extractor: { extract } },
    );
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("sends job text with ligatures expanded", async () => {
    const extract = vi.fn(async (request: OpportunityExtractionRequest) => {
      expect(request.sources[0]?.text).toBe("Efficient workflows for the finance team.");
      return emptyProposal;
    });
    await createOpportunityDraft(
      { sources: [pasted("Eﬃcient workﬂows for the ﬁnance team.", "job-posting")] },
      { extractor: { extract } },
    );
    expect(extract).toHaveBeenCalledTimes(1);
  });
});
