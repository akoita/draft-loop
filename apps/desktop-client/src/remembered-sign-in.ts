import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Owner tokens remembered on this computer, one per server origin, encrypted by the operating
 * system's keychain (Electron `safeStorage`). Where no keychain is available the client
 * remembers nothing, and the token is asked again at each launch.
 */

export interface TokenCipher {
  /** False when the system offers no keychain-backed encryption. */
  isAvailable(): boolean;
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
}

export interface RememberedSignIns {
  read(origin: string): string | null;
  remember(origin: string, token: string): void;
  forget(origin: string): void;
}

export const rememberedSignInFilename = "sign-in.json";

/** The longest token the client keeps; the API's own tokens are far shorter. */
const maximumTokenLength = 4_096;

export function createRememberedSignIns(
  userDataDirectory: string,
  cipher: TokenCipher,
): RememberedSignIns {
  const file = join(userDataDirectory, rememberedSignInFilename);
  const load = (): Record<string, string> => {
    try {
      const value: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
      return Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    } catch {
      return {};
    }
  };
  const save = (entries: Record<string, string>) => {
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(entries)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, file);
  };
  return {
    read(origin) {
      const sealed = load()[origin];
      if (sealed === undefined || !cipher.isAvailable()) return null;
      try {
        return cipher.decrypt(Buffer.from(sealed, "base64"));
      } catch {
        return null;
      }
    },
    remember(origin, token) {
      if (!cipher.isAvailable() || token === "" || token.length > maximumTokenLength) return;
      save({ ...load(), [origin]: cipher.encrypt(token).toString("base64") });
    },
    forget(origin) {
      const entries = load();
      if (!(origin in entries)) return;
      delete entries[origin];
      save(entries);
    },
  };
}
