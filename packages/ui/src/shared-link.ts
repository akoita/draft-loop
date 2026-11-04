/**
 * Links into the shared screens. The server serves them at `/` with no URL routes, so a link names
 * its page in the address's fragment, which the host reads once when the screens open (#2149).
 */
import { evidenceView, type WorkspaceView } from "./home-model.js";

/** The fragment that opens Career evidence on the Work journal panel. */
export const workJournalFragment = "#work-journal";

/** The element id the Work journal panel carries, so the fragment can scroll to it. */
export const workJournalPanelId = "work-journal";

/** The page a fragment opens, or undefined when it names none. */
export function startViewForFragment(fragment: string): WorkspaceView | undefined {
  return fragment === workJournalFragment ? evidenceView : undefined;
}
