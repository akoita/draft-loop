import type { TokenStore } from "./session.js";

/**
 * The desktop client's sign-in hook (ADR 0011, D9). In the desktop app, `window.draftLoopDesktop`
 * offers an owner token remembered on that computer by the system keychain; in a browser it is
 * absent and nothing changes.
 */
export interface DesktopSignIn {
  readonly rememberedToken: string | null;
  remember(token: string): void;
  forget(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The desktop's sign-in hook, when the page runs in the desktop app. */
export function desktopSignIn(scope: unknown = globalThis): DesktopSignIn | undefined {
  if (!isRecord(scope)) return undefined;
  const host = scope.draftLoopDesktop;
  if (!isRecord(host) || host.host !== "desktop" || !isRecord(host.signIn)) return undefined;
  const { rememberedToken, remember, forget } = host.signIn;
  if (typeof remember !== "function" || typeof forget !== "function") return undefined;
  return {
    rememberedToken: typeof rememberedToken === "string" ? rememberedToken : null,
    remember: (token) => remember(token),
    forget: () => forget(),
  };
}

/**
 * The tab's token store, backed by the desktop's remembered sign-in: a token signed in with is
 * remembered, the remembered one is used when the tab has none, and signing out (or a refused
 * token) forgets it.
 */
export function withDesktopSignIn(
  tokens: TokenStore,
  desktop: DesktopSignIn | undefined,
): TokenStore {
  if (desktop === undefined) return tokens;
  let remembered = desktop.rememberedToken;
  return {
    read() {
      return tokens.read() ?? remembered;
    },
    write(token) {
      tokens.write(token);
      remembered = token;
      desktop.remember(token);
    },
    clear() {
      tokens.clear();
      remembered = null;
      desktop.forget();
    },
  };
}
