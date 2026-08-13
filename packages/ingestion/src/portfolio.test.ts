import { describe, expect, it } from "vitest";

import { ingestPortfolioManifest, type PortfolioManifest } from "./index.js";

const samplePortfolio: PortfolioManifest = {
  authorName: "Alex Developer",
  headline: "Senior Distributed Systems Engineer",
  summary:
    "Specialized in high-performance backends, local-first architectures, and resilient distributed databases.",
  projects: [
    {
      name: "DraftLoop Engine",
      role: "Lead Architect",
      dateRange: "2024 - Present",
      description:
        "Engineered an author-critic LLM orchestration framework with local SQLite audit verification.",
      technologies: ["TypeScript", "Node.js", "SQLite", "Electron"],
      highlights: [
        "Architected multi-provider consensus with zero remote data leakage.",
        "Optimized retrieval latency to under 15ms using BM25 and vector embeddings.",
      ],
    },
    {
      name: "Distributed Ledger Sync",
      role: "Core Contributor",
      dateRange: "2022 - 2024",
      description:
        "Built peer-to-peer reconciliation protocol handling 100k transactions per second.",
      technologies: ["Rust", "gRPC", "RocksDB"],
      highlights: ["Reduced network bandwidth consumption by 40%."],
    },
  ],
};

describe("Structured Developer Portfolio Ingestion", () => {
  it("ingests portfolio summary and projects into deterministic source chunks", () => {
    const chunks = ingestPortfolioManifest(samplePortfolio, "/sources/alex_portfolio.json");

    expect(chunks.length).toBe(3); // 1 summary chunk + 2 project chunks

    const summaryChunk = chunks[0]!;
    expect(summaryChunk.sourcePath).toBe("/sources/alex_portfolio.json");
    expect(summaryChunk.text).toContain("Senior Distributed Systems Engineer");
    expect(summaryChunk.text).toContain("resilient distributed databases");
    expect(summaryChunk.checksum).toMatch(/^[0-9a-f]{64}$/u);

    const project1 = chunks[1]!;
    expect(project1.text).toContain("Project: DraftLoop Engine");
    expect(project1.text).toContain("Role: Lead Architect");
    expect(project1.text).toContain("Technologies: TypeScript, Node.js, SQLite, Electron");
    expect(project1.text).toContain("Optimized retrieval latency to under 15ms");

    const project2 = chunks[2]!;
    expect(project2.text).toContain("Project: Distributed Ledger Sync");
    expect(project2.text).toContain("Technologies: Rust, gRPC, RocksDB");
  });
});
