import { useEffect, useState } from "react";

import { createApiClient } from "./api-client.js";
import { nextCheckMs, noticeMessage, type ServiceNotice } from "./service-notice-model.js";

/** Reads the current notice; a failed read keeps what the tab already shows. */
async function readNotice(): Promise<ServiceNotice | null> {
  const answer = await createApiClient({}).call("GET /v1/service-notice", {});
  return answer.notice;
}

/** Follows the notice while the tab is open: on load, on focus, and on a timer. */
function useServiceNotice(): ServiceNotice | null {
  const [notice, setNotice] = useState<ServiceNotice | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const check = () => {
      readNotice()
        .then((next) => {
          if (stopped) return;
          setNotice(next);
          schedule(next);
        })
        .catch(() => {
          if (!stopped) schedule(null);
        });
    };
    const schedule = (current: ServiceNotice | null) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(check, nextCheckMs(current));
    };
    const visible = () => {
      if (document.visibilityState === "visible") check();
    };
    check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return notice;
}

export interface ServiceNoticeBannerProps {
  readonly notice: ServiceNotice;
}

/** One line above every screen while a planned maintenance is announced or under way. */
export function ServiceNoticeBanner({ notice }: ServiceNoticeBannerProps) {
  return (
    <div className="notice service-notice" role="status">
      <span>{noticeMessage(notice)}</span>
    </div>
  );
}

/** Shows the banner while the API serves a notice. */
export function ServiceNoticeWatch() {
  const notice = useServiceNotice();
  return notice === null ? null : <ServiceNoticeBanner notice={notice} />;
}
