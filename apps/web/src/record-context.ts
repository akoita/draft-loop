import { createContext, useContext } from "react";

import { ownerWorkspaceId } from "./workspace-model.js";

/** The candidate record the steps work on; owner-token mode keeps its single workspace. */
export const RecordContext = createContext<string>(ownerWorkspaceId);

/** The workspace id of the record the screen shows. */
export function useRecordId(): string {
  return useContext(RecordContext);
}
