import process from "node:process";
import { grantRunQueueAccess, migrateRunQueue } from "@draft-loop/run-queue";
import {
  createSqlClient,
  grantPostgresStorageAccess,
  migratePostgresStorage,
} from "@draft-loop/storage-postgres";

import { readMigrationConfig } from "./config.js";

// The migration job: runs as the schema owner before the API and the workers start, then grants
// the runtime role table access only. The runtime role already exists: infrastructure creates it.
const config = readMigrationConfig(process.env);
const storage = { connectionString: config.databaseUrl, schema: config.databaseSchema };
const queue = { connectionString: config.databaseUrl, schema: config.queueSchema };

const owner = createSqlClient({ ...storage, maxConnections: 1 });
try {
  await owner.query(`CREATE SCHEMA IF NOT EXISTS ${config.databaseSchema}`);
} finally {
  await owner.close();
}
const applied = await migratePostgresStorage(storage);
await grantPostgresStorageAccess(storage, config.runtimeRole);
await migrateRunQueue(queue);
await grantRunQueueAccess(queue, config.runtimeRole);
console.info(JSON.stringify({ migrated: applied, runtimeRole: config.runtimeRole }));
