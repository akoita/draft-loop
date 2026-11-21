import { t } from "@lingui/core/macro";
import { useState } from "react";

import type { ApiSchemas } from "./api-client.js";
import { canOperate } from "./operator-model.js";

type Me = ApiSchemas["Me"];

/**
 * Whether the caller holds the operator role but may not operate now: their second step (code or
 * passkey) is older than the provider counts for operator routes, though their session lives on.
 */
export function needsOperatorConfirm(me: Me): boolean {
  return me.kind === "member" && me.operatorRole === true && !canOperate(me);
}

/**
 * Takes the place of the Operator entry once the second step has aged out, so the controls do not
 * vanish without a word: one press asks for the sign-in again and brings them back.
 */
export function ConfirmOperatorButton({ onConfirm }: { readonly onConfirm: () => Promise<void> }) {
  const [leaving, setLeaving] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="operator-confirm">
      <button
        type="button"
        className="button button-toolbar"
        disabled={leaving}
        onClick={() => {
          setLeaving(true);
          setFailed(false);
          onConfirm().catch(() => {
            setLeaving(false);
            setFailed(true);
          });
        }}
      >
        {t`Confirm operator access`}
      </button>
      <p className="account-menu-hint">
        {failed
          ? t`The sign-in page did not answer. Try again in a moment.`
          : t`Operator controls need a recent code or passkey. Sign in again to get them back.`}
      </p>
    </div>
  );
}
