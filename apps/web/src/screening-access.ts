import { createContext, useContext } from "react";

/**
 * Whether the caller releases quarantined material. The owner token's single workspace can; in
 * sign-in mode the records screen provides whether the member is an owner or admin. The API
 * enforces the same rule, so this only decides what to offer.
 */
export const ReleaseAccess = createContext<boolean>(true);

export function useCanRelease(): boolean {
  return useContext(ReleaseAccess);
}
