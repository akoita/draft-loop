import { App } from "@draft-loop/ui/app";
import { createCapabilityPort } from "@draft-loop/ui/bridge";
import { createBridgeReviewPort } from "@draft-loop/ui/native";
import { startViewForFragment } from "@draft-loop/ui/shared-link";
import { t } from "@lingui/core/macro";
import { type ReactNode, useMemo, useState } from "react";

import type { ApiClient, ApiRequestError } from "./api-client.js";
import { describeStartError } from "./credits-model.js";
import { createHttpBridge } from "./http-bridge.js";
import { QuarantineRefusalPanel } from "./screening.js";
import { quarantineRefusal } from "./screening-model.js";

export interface SharedScreensProps {
  readonly client: ApiClient;
  /** The candidate record's workspace the screens open on. */
  readonly workspaceId: string;
  /** The web's own header actions, drawn where the desktop has Close workspace. */
  readonly hostActions?: ReactNode;
}

/**
 * The desktop's screens over the hosted API (ADR 0011, D9): Home, New application and the
 * requirement review, through the HTTP bridge. A refusal with its own code, such as a plan limit
 * or quarantined material, is explained above them in the shell's words.
 */
export function SharedScreens({ client, workspaceId, hostActions }: SharedScreensProps) {
  const [refusal, setRefusal] = useState<ApiRequestError | undefined>(undefined);
  // A shared link names its page in the fragment, read once when the screens open (#2149).
  const [startView] = useState(() => startViewForFragment(window.location.hash));
  const port = useMemo(
    () =>
      createBridgeReviewPort(
        createCapabilityPort(createHttpBridge({ client, workspaceId, onRefusal: setRefusal })),
      ),
    [client, workspaceId],
  );

  return (
    <>
      {refusal === undefined ? null : (
        <RefusalNotice client={client} refusal={refusal} onDismiss={() => setRefusal(undefined)} />
      )}
      <div className="shared-screens">
        <App
          port={port}
          {...(hostActions === undefined ? {} : { hostActions })}
          {...(startView === undefined ? {} : { startView })}
        />
      </div>
    </>
  );
}

export interface RefusalNoticeProps {
  readonly client: ApiClient;
  readonly refusal: ApiRequestError;
  readonly onDismiss: () => void;
}

/**
 * Why a request was refused, in the shell's words. A start refused for quarantined material also
 * lists what is held, with a release for owners and admins; once released, dismiss and start again.
 */
export function RefusalNotice({ client, refusal, onDismiss }: RefusalNoticeProps) {
  const quarantine = quarantineRefusal(refusal);
  return (
    <div className="notice" role="alert">
      <p>{describeStartError(refusal)}</p>
      {quarantine === undefined ? null : (
        <QuarantineRefusalPanel client={client} refusal={quarantine} />
      )}
      <button type="button" className="secondary" onClick={onDismiss}>{t`Dismiss`}</button>
    </div>
  );
}
