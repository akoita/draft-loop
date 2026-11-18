import { useEffect, useState } from "react";

import type { ApiClient, ApiSchemas } from "./api-client.js";
import { canOperate, readNewFeedbackCount } from "./operator-model.js";

/** How often the count of new feedback notes is read again while the screen stays open. */
const refreshMilliseconds = 5 * 60 * 1000;

/**
 * The feedback notes waiting in New (#3002), for the operator only: read once the caller is known
 * to operate, then every five minutes. Undefined for anyone else, or while it cannot be read.
 */
export function useNewFeedbackCount(
  client: ApiClient,
  me: ApiSchemas["Me"] | undefined,
): number | undefined {
  const operates = me !== undefined && canOperate(me);
  const [count, setCount] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!operates) return;
    let current = true;
    const read = () =>
      void readNewFeedbackCount(client).then((next) => {
        if (current) setCount(next);
      });
    read();
    const timer = setInterval(read, refreshMilliseconds);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [client, operates]);
  return operates ? count : undefined;
}
