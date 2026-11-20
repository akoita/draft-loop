import { App } from "@draft-loop/ui/app";
import { createCapabilityPort } from "@draft-loop/ui/bridge";
import { createBridgeReviewPort } from "@draft-loop/ui/native";
import { startViewForFragment } from "@draft-loop/ui/shared-link";
import { t } from "@lingui/core/macro";
import { type ReactNode, useMemo, useRef, useState } from "react";

import type { ApiClient, ApiRequestError } from "./api-client.js";
import { describeStartError } from "./credits-model.js";
import { createHttpBridge } from "./http-bridge.js";
import { QuarantineRefusalPanel } from "./screening.js";
import { quarantineRefusal } from "./screening-model.js";

export interface SharedScreensProps {
  readonly client: ApiClient;
  /** The candidate record's workspace the screens open on. */
  readonly workspaceId: string;
  /** The record's name, shown as the workspace's title; the API's own label when unset. */
  readonly workspaceName?: string;
  /** The web's own header actions, drawn where the desktop has Close workspace. */
  readonly hostActions?: ReactNode;
}

/**
 * The desktop's screens over the hosted API (ADR 0011, D9): Home, New application and the
 * requirement review, through the HTTP bridge. A refusal with its own code, such as a plan limit
 * or quarantined material, is explained above them in the shell's words.
 */
export function SharedScreens({
  client,
  workspaceId,
  workspaceName,
  hostActions,
}: SharedScreensProps) {
  const [shown, setShown] = useState<ShownRefusal | undefined>(undefined);
  const refusal = shown?.error;
  // A shared link names its page in the fragment, read once when the screens open (#2149).
  const [startView] = useState(() => startViewForFragment(window.location.hash));
  // Read on each load, so a new name never rebuilds the port and reopens the screens.
  const name = useRef(workspaceName);
  name.current = workspaceName;
  const port = useMemo(
    () =>
      createBridgeReviewPort(
        createCapabilityPort(
          createHttpBridge({
            client,
            workspaceId,
            workspaceName: () => name.current,
            onRefusal: (error, command) => setShown({ error, command }),
            // A retry of the refused command that now succeeds, such as an upload once the
            // storage consent is recorded, resolves the refusal, so its notice goes away.
            onSucceeded: (command) =>
              setShown((current) => (current?.command === command ? undefined : current)),
          }),
        ),
      ),
    [client, workspaceId],
  );

  return (
    <>
      {refusal === undefined ? null : (
        <RefusalNotice client={client} refusal={refusal} onDismiss={() => setShown(undefined)} />
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

/** The refusal on show and the command it refused. */
interface ShownRefusal {
  readonly error: ApiRequestError;
  readonly command: string;
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
