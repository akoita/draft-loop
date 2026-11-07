import { t } from "@lingui/core/macro";
import { type DragEvent, type ReactNode, useState } from "react";

/** What each career page says about the other's job, so a person in the wrong place finds the right one. */
export const profileSignpostText = () =>
  ({
    lead: t`Looking to add or replace a CV?`,
    body: t`Documents live in Career evidence. The profile is rebuilt from them.`,
    action: t`Go to Career evidence`,
    dragging: t`Drop documents in Career evidence, not here.`,
    dropped: t`Your file was not added: documents are added in Career evidence.`,
  }) as const;

export const evidenceSignpostText = () =>
  ({
    lead: t`Looking for your facts?`,
    body: t`Facts DraftLoop finds in these documents are reviewed and edited in Career profile.`,
    action: t`Open Career profile`,
  }) as const;

function Signpost({
  tone = "neutral",
  children,
  action,
  onAction,
}: {
  readonly tone?: "neutral" | "attention";
  readonly children: ReactNode;
  readonly action: string;
  readonly onAction: () => void;
}) {
  return (
    <aside className={`career-signpost career-signpost-${tone}`}>
      <p className="career-signpost-text">{children}</p>
      <button className="button button-outline" type="button" onClick={onAction}>
        {action} <span aria-hidden="true">→</span>
      </button>
    </aside>
  );
}

/** On the Career evidence page: facts are reviewed in Career profile. */
export function EvidenceSignpost({ onOpenProfile }: { readonly onOpenProfile: () => void }) {
  return (
    <Signpost action={evidenceSignpostText().action} onAction={onOpenProfile}>
      <strong>{evidenceSignpostText().lead}</strong> {evidenceSignpostText().body}
    </Signpost>
  );
}

export type ProfileDropState = "none" | "dragging" | "dropped";

/**
 * How the profile signpost answers a file drag: it points to Career evidence while a file hovers,
 * and after a drop says the file was not added. Leaving after a drop keeps that message.
 */
export function nextProfileDropState(
  current: ProfileDropState,
  event: "dragover" | "dragleave" | "drop",
): ProfileDropState {
  switch (event) {
    case "dragover":
      return "dragging";
    case "dragleave":
      return current === "dragging" ? "none" : current;
    case "drop":
      return "dropped";
  }
}

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/**
 * On the Career profile page: documents are added in Career evidence. It wraps the page content,
 * so a file dragged onto the profile is refused here instead of opening in the browser, and the
 * signpost says where documents go.
 */
export function ProfileSignpostArea({
  onOpenEvidence,
  children,
}: {
  readonly onOpenEvidence?: (() => void) | undefined;
  readonly children: ReactNode;
}) {
  const [drop, setDrop] = useState<ProfileDropState>("none");
  if (onOpenEvidence === undefined) return <>{children}</>;
  const onDragOver = (event: DragEvent) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "none";
    setDrop((current) => nextProfileDropState(current, "dragover"));
  };
  const onDragLeave = (event: DragEvent) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDrop((current) => nextProfileDropState(current, "dragleave"));
  };
  const onDrop = (event: DragEvent) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    setDrop((current) => nextProfileDropState(current, "drop"));
  };
  const attention = drop !== "none";
  return (
    // A labelled region, so the drag handlers sit on a named element; dropping is pointer-only.
    <section
      className="career-signpost-area"
      aria-label={t`Career profile`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Signpost
        tone={attention ? "attention" : "neutral"}
        action={profileSignpostText().action}
        onAction={onOpenEvidence}
      >
        {drop === "dragging" ? (
          <strong>{profileSignpostText().dragging}</strong>
        ) : drop === "dropped" ? (
          <strong role="status">{profileSignpostText().dropped}</strong>
        ) : (
          <>
            <strong>{profileSignpostText().lead}</strong> {profileSignpostText().body}
          </>
        )}
      </Signpost>
      {children}
    </section>
  );
}
