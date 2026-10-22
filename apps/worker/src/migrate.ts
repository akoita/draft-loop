import process from "node:process";
import { grantRunQueueAccess, migrateRunQueue } from "@draft-loop/run-queue";
import {
  createSqlClient,
  ensureRuntimeRole,
  grantPostgresStorageAccess,
  migratePostgresStorage,
  startConfiguredCloudSqlProxy,
} from "@draft-loop/storage-postgres";

import { readMigrationConfig } from "./config.js";

// The migration job: runs as the schema owner before the API and the workers start, then grants
// the runtime role table access only. It creates the runtime role when it is missing and, on
// Cloud SQL, makes the services' IAM database users its members.
const config = readMigrationConfig(process.env);
// On Cloud SQL the owner is a built-in user; its password reaches the instance through the tunnel.
const proxy = await startConfiguredCloudSqlProxy(process.env, "password");
const storage = { connectionString: config.databaseUrl, schema: config.databaseSchema };
const queue = { connectionString: config.databaseUrl, schema: config.queueSchema };

try {
  const owner = createSqlClient({ ...storage, maxConnections: 1 });
  try {
    await owner.query(`CREATE SCHEMA IF NOT EXISTS ${config.databaseSchema}`);
  } finally {
    await owner.close();
  }
  await ensureRuntimeRole(config.databaseUrl, config.runtimeRole, config.runtimeMembers);
  const applied = await migratePostgresStorage(storage);
  await grantPostgresStorageAccess(storage, config.runtimeRole);
  await migrateRunQueue(queue);
  await grantRunQueueAccess(queue, config.runtimeRole);
  console.info(
    JSON.stringify({
      severity: "INFO",
      message: "migrated",
      migrated: applied,
      runtimeRole: config.runtimeRole,
      runtimeMembers: config.runtimeMembers.length,
    }),
  );
} finally {
  proxy.close();
}
