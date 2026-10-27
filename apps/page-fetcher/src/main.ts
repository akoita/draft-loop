import process from "node:process";

import { createPageFetcherServer } from "./page-fetcher.js";

// Cloud Run sets PORT. The fetcher reads nothing else: it has no database, secret or provider.
const portText = process.env.PORT ?? "8080";
const port = Number(portText);
if (!/^\d+$/u.test(portText) || port < 1 || port > 65_535) {
  console.error("PORT must be a TCP port number.");
  process.exit(1);
}

const server = createPageFetcherServer({
  // One structured line per fetch for Cloud Logging: the host, outcome and time only.
  log: (entry) =>
    console.log(
      JSON.stringify({
        severity: entry.outcome === "fetched" ? "INFO" : "WARNING",
        message: "page fetch",
        ...entry,
      }),
    ),
});

// Cloud Run sends SIGTERM before stopping an instance; finish in-flight fetches, then exit.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
  });
}

server.listen(port, "0.0.0.0");
