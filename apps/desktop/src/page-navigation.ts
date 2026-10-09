/**
 * Moving between the pages of an open workspace without passing through Home.
 *
 * Every page offers the flow strip (Career evidence → Career profile → Applications) and a Back
 * action that returns to the page the person came from. The pages they visited stay mounted but
 * hidden, so returning to one finds it as it was left: the New application step and its draft, an
 * application's review queue, the profile being reviewed. This module holds that history and
 * decides which pages are kept; the window renders them.
 */
import { homeView, newApplicationView, type WorkspaceView } from "./home-model.js";

/** The longest Back trail kept; older pages drop off the front. */
export const pageHistoryLimit = 10;

export interface PageNavigation {
  readonly view: WorkspaceView;
  /** Pages Back returns to, oldest first. Home sits below the first entry and is never stored. */
  readonly history: readonly WorkspaceView[];
  /** The pages opened since the workspace opened, which stay mounted while hidden. */
  readonly visited: readonly ("home" | "evidence" | "profile")[];
  /** The application last opened, kept while it is still the one the window has loaded. */
  readonly lastApplication: Extract<WorkspaceView, { kind: "application" }> | null;
  /** Bumped by every New application, so each one starts from an empty flow. */
  readonly newApplicationEpoch: number;
}

/** Opening or creating a workspace lands on Home with nothing to go back to. */
export function initialPageNavigation(): PageNavigation {
  return {
    view: homeView,
    history: [],
    visited: ["home"],
    lastApplication: null,
    newApplicationEpoch: 0,
  };
}

/** Identifies a page: two views with the same key are the same page. */
export function pageKey(view: WorkspaceView): string {
  return view.kind === "application" ? `application:${view.applicationId}` : view.kind;
}

/** The page's name, as the location line and the Back action say it. */
export function pageLabel(view: WorkspaceView): string {
  switch (view.kind) {
    case "home":
      return "Home";
    case "evidence":
      return "Career evidence";
    case "profile":
      return "Career profile";
    case "new-application":
      return "New application";
    case "application":
      return view.name;
  }
}

/**
 * Opens a page. Home starts the trail again. A page already on the trail cuts it back to that
 * point, so moving back and forth between two pages never grows it.
 */
export function navigateTo(navigation: PageNavigation, to: WorkspaceView): PageNavigation {
  if (pageKey(to) === pageKey(navigation.view)) {
    // The same application under a new name keeps its place.
    return to === navigation.view ? navigation : withView(navigation, to, navigation.history);
  }
  if (to.kind === "home") return withView(navigation, to, []);
  const onTrail = navigation.history.findIndex((entry) => pageKey(entry) === pageKey(to));
  const history =
    onTrail >= 0
      ? navigation.history.slice(0, onTrail)
      : navigation.view.kind === "home"
        ? navigation.history
        : [...navigation.history, navigation.view].slice(-pageHistoryLimit);
  return withView(navigation, to, history);
}

/** Opens an empty New application flow, dropping any flow left on the trail. */
export function openNewApplication(navigation: PageNavigation): PageNavigation {
  const history = navigation.history.filter((entry) => entry.kind !== "new-application");
  return navigateTo(
    {
      ...navigation,
      view: navigation.view.kind === "new-application" ? homeView : navigation.view,
      history,
      newApplicationEpoch: navigation.newApplicationEpoch + 1,
    },
    newApplicationView,
  );
}

/**
 * Shows the application whose review the New application flow just started, in place of the
 * flow: the finished flow is no longer on the trail, so Back skips it.
 */
export function finishNewApplication(
  navigation: PageNavigation,
  application: Extract<WorkspaceView, { kind: "application" }>,
): PageNavigation {
  const history = navigation.history.filter(
    (entry) => entry.kind !== "new-application" && pageKey(entry) !== pageKey(application),
  );
  return withView(navigation, application, history);
}

/** Where Back leads, or null on Home. Home is the target once the trail is empty. */
export function backTarget(navigation: PageNavigation): WorkspaceView | null {
  if (navigation.view.kind === "home") return null;
  return navigation.history.at(-1) ?? homeView;
}

export function goBack(navigation: PageNavigation): PageNavigation {
  const target = backTarget(navigation);
  if (target === null) return navigation;
  return withView(navigation, target, navigation.history.slice(0, -1));
}

/** True while the New application flow can still be returned to, so it keeps its draft. */
export function keepsNewApplicationFlow(navigation: PageNavigation): boolean {
  return [navigation.view, ...navigation.history].some((entry) => entry.kind === "new-application");
}

function withView(
  navigation: PageNavigation,
  view: WorkspaceView,
  history: readonly WorkspaceView[],
): PageNavigation {
  const visited =
    (view.kind === "home" || view.kind === "evidence" || view.kind === "profile") &&
    !navigation.visited.includes(view.kind)
      ? [...navigation.visited, view.kind]
      : navigation.visited;
  return {
    ...navigation,
    view,
    history,
    visited,
    lastApplication: view.kind === "application" ? view : navigation.lastApplication,
  };
}
