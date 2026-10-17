import { openSqliteStorage } from "../index.js";
import { describeHistoryRecordsConformance } from "./history-records.js";

describeHistoryRecordsConformance("SQLite", async () => {
  const storage = openSqliteStorage(":memory:");
  return { storage, close: () => storage.close() };
});
