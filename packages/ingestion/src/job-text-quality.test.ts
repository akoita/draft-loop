import { describe, expect, it } from "vitest";

import { expandLigatures, looksGarbled } from "./job-text-quality.js";

const clean = `Platform Engineer, Example Systems. You will design and operate reliable
services, review pull requests, mentor engineers, and work with product managers on the
roadmap. We use TypeScript, JavaScript, Kubernetes, GitHub Actions and DevOps practices.
Experience with SQL and NoSQL databases, CI/CD, Terraform and AWS is expected. You write
clear documentation and enjoy improving the developer experience for the whole team.`;

const french = `Ingénieur plateforme chez Exemple Systèmes. Vous concevez et exploitez des
services fiables, relisez le code, accompagnez les développeurs et travaillez avec les
équipes produit sur la feuille de route. Nous utilisons TypeScript, Kubernetes et Terraform
dans un environnement exigeant où la qualité et la sécurité comptent beaucoup.`;

// Shaped like the job text a broken PDF text layer produced for a real posting.
const garbled = `Pays / FsaocG / ViHHG Tch Ld FsaocG ViHHG Pays dvlppmnt Fsc ViHHG
FsaocG Pays rsNP / ViHHG xprnc FsaocG mnGT Pays ViHHG FsaocG dTbs ViHHG Pays FsaocG
qlfctns ViHHG FsaocG Pays ViHHG FsaocG Pays ViHHG cmmnctn FsaocG ViHHG Pays FsaocG`;

describe("job text quality", () => {
  it("expands Latin ligatures and leaves other text unchanged", () => {
    expect(expandLigatures("eﬃcient workﬂows, ﬁnance and staﬀ ﬆyle")).toBe(
      "efficient workflows, finance and staff style",
    );
    expect(expandLigatures(clean)).toBe(clean);
  });

  it("passes clean English and French job text with camel-case technology names", () => {
    expect(looksGarbled(clean)).toBe(false);
    expect(looksGarbled(french)).toBe(false);
  });

  it("flags text from a broken PDF text layer", () => {
    expect(looksGarbled(garbled)).toBe(true);
  });

  it("flags text made mostly of replacement or private-use characters", () => {
    const words = clean.split(/\s+/u).slice(0, 40).join(" ");
    expect(looksGarbled(`${words} ${"�".repeat(20)}`)).toBe(true);
  });

  it("does not judge short or non-Latin text", () => {
    expect(looksGarbled("FsaocG ViHHG Pays")).toBe(false);
    expect(
      looksGarbled("プラットフォームエンジニア。信頼性の高いサービスを設計・運用します。"),
    ).toBe(false);
  });
});
