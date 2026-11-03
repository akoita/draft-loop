/** The channels behind `window.draftLoopDesktop.signIn`, answered only for the window's own server. */
export const signInChannels = {
  read: "draft-loop:sign-in:read",
  remember: "draft-loop:sign-in:remember",
  forget: "draft-loop:sign-in:forget",
} as const;
