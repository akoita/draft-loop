import type {
  ClosableStoragePort,
  OpportunityBriefStoragePort,
  WorkspaceApplicationsStoragePort,
  WorkspaceStoragePort,
} from "@draft-loop/storage";
import { storageFactory } from "./local-storage-factory.js";

/** A hosted history always exists; a local one only once its file has been written. */
export async function historyExists(root: string): Promise<boolean> {
  return (await storageFactory().hasHistory?.(root)) ?? true;
}

/** The parts of a workspace's history that its applications read and write. */
export type ApplicationHistory = WorkspaceStoragePort &
  Pick<OpportunityBriefStoragePort, "getLatestOpportunityBrief"> &
  WorkspaceApplicationsStoragePort &
  ClosableStoragePort;

export async function openHistory(root: string): Promise<ApplicationHistory> {
  return storageFactory().open(root);
}
