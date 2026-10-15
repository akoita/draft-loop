import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

/**
 * Compaction reads and discards snapshots of tens of megabytes. V8 lets that garbage pile up
 * before it collects, so resident memory climbs to several times the live data. A caller that
 * works through such rows calls this between them: once memory is above the limit it collects
 * garbage, and the limit then rises with whatever is genuinely live so it cannot collect on every
 * call. Nothing happens below the limit, and nothing at all where collection is unavailable.
 */
const defaultLimitBytes = 300 * 1024 * 1024;
const headroomBytes = 200 * 1024 * 1024;

let collect: (() => void) | null | undefined;
let nextLimit = defaultLimitBytes;

export function relieveMemoryPressure(): void {
  if (process.memoryUsage.rss() < nextLimit) return;
  if (collect === undefined) {
    try {
      setFlagsFromString("--expose-gc");
      collect = runInNewContext("gc") as () => void;
    } catch {
      collect = null;
    }
  }
  if (collect === null) return;
  collect();
  nextLimit = Math.max(defaultLimitBytes, process.memoryUsage.rss() + headroomBytes);
}
