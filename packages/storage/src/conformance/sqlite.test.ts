import { openSqliteStorage } from "../index.js";
import { describeCandidateKnowledgeRetrievalConformance } from "./candidate-knowledge-retrieval.js";
import { describeHistoryRecordsConformance } from "./history-records.js";

const openInMemory = async () => {
  const storage = openSqliteStorage(":memory:");
  return { storage, close: () => storage.close() };
};

describeHistoryRecordsConformance("SQLite", openInMemory);
describeCandidateKnowledgeRetrievalConformance("SQLite", openInMemory);
