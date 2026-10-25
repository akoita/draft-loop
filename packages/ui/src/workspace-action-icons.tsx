/** Icons for the workspace-level actions, drawn on the same 24px grid as the rail icons. */

export function ModelsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M4 7h9m4 0h3M4 17h3m4 0h9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="15" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="9" cy="17" r="2.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function CloseWorkspaceIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M14 8l4 4-4 4M18 12H9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
