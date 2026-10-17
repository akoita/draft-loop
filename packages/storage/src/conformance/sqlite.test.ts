import { openSqliteStorage } from "../index.js";
import { describeApplicationsConformance } from "./applications.js";
import { describeCandidateKnowledgeRetrievalConformance } from "./candidate-knowledge-retrieval.js";
import { describeCandidateKnowledgeVectorConformance } from "./candidate-knowledge-vectors.js";
import { describeHistoryRecordsConformance } from "./history-records.js";

const openInMemory = async () => {
  const storage = openSqliteStorage(":memory:");
  return { storage, close: () => storage.close() };
};

describeHistoryRecordsConformance("SQLite", openInMemory);
describeCandidateKnowledgeRetrievalConformance("SQLite", openInMemory);
describeApplicationsConformance("SQLite", openInMemory);
describeCandidateKnowledgeVectorConformance("SQLite", openInMemory);
