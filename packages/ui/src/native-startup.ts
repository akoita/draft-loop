import type { DesktopReviewPort } from "./model.js";

export const nativeConnectionUnavailableMessage =
  "The desktop native connection is unavailable. Restart DraftLoop and try again.";

/** The Electron marker suppresses the browser fixture fallback; it grants no host access. */
export function isElectronRendererRuntime(
  userAgent: string | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator.userAgent,
): boolean {
  return userAgent?.toLowerCase().includes("electron/") ?? false;
}

export function createNativeStartupUnavailablePort(): DesktopReviewPort {
  const unavailable = async (): Promise<never> => {
    throw new Error(nativeConnectionUnavailableMessage);
  };
  return {
    load: unavailable,
    dispatch: async () => unavailable(),
  };
}
