import { describe, expect, it } from "vitest";

import {
  applicationView,
  evidenceView,
  homeView,
  newApplicationView,
  profileView,
  type WorkspaceView,
} from "./home-model.js";
import {
  backTarget,
  finishNewApplication,
  goBack,
  initialPageNavigation,
  keepsNewApplicationFlow,
  navigateTo,
  openNewApplication,
  type PageNavigation,
  pageHistoryLimit,
  pageKey,
  pageLabel,
} from "./page-navigation.js";

const acme = applicationView("app-1", "Acme — Backend Lead") as Extract<
  WorkspaceView,
  { kind: "application" }
>;
const globex = applicationView("app-2", "Globex") as Extract<
  WorkspaceView,
  { kind: "application" }
>;

function visit(...views: readonly WorkspaceView[]): PageNavigation {
  return views.reduce(navigateTo, initialPageNavigation());
}

function trail(navigation: PageNavigation): readonly string[] {
  return navigation.history.map(pageKey);
}

describe("page navigation", () => {
  it("opens on Home with nothing to go back to", () => {
    const navigation = initialPageNavigation();
    expect(navigation.view).toBe(homeView);
    expect(backTarget(navigation)).toBeNull();
    expect(navigation.visited).toEqual(["home"]);
  });

  it("opens a page directly from any other page, without passing through Home", () => {
    const navigation = visit(acme, profileView);
    expect(navigation.view).toBe(profileView);
    expect(trail(navigation)).toEqual(["application:app-1"]);
    expect(backTarget(navigation)).toBe(acme);
    expect(navigation.visited).toEqual(["home", "profile"]);
  });

  it("goes Back along the trail, and to Home once the trail is empty", () => {
    let navigation = visit(acme, evidenceView, profileView);
    expect(trail(navigation)).toEqual(["application:app-1", "evidence"]);
    navigation = goBack(navigation);
    expect(navigation.view).toBe(evidenceView);
    navigation = goBack(navigation);
    expect(navigation.view).toBe(acme);
    expect(backTarget(navigation)).toBe(homeView);
    navigation = goBack(navigation);
    expect(navigation.view).toBe(homeView);
    expect(goBack(navigation)).toBe(navigation);
  });

  it("cuts the trail back to a page opened again, so switching pages never grows it", () => {
    let navigation = visit(acme, profileView, evidenceView, profileView);
    expect(trail(navigation)).toEqual(["application:app-1"]);
    for (let round = 0; round < 5; round += 1) {
      navigation = navigateTo(navigateTo(navigation, evidenceView), profileView);
    }
    expect(trail(navigation)).toEqual(["application:app-1"]);
  });

  it("starts the trail again at Home", () => {
    const navigation = visit(acme, profileView, homeView);
    expect(navigation.history).toEqual([]);
    expect(backTarget(navigation)).toBeNull();
  });

  it("keeps the trail bounded", () => {
    const apps = Array.from({ length: pageHistoryLimit + 5 }, (_, index) =>
      applicationView(`app-${index}`, `App ${index}`),
    );
    const navigation = visit(...apps, profileView);
    expect(navigation.history).toHaveLength(pageHistoryLimit);
    expect(navigation.history.at(-1)).toBe(apps.at(-1));
  });

  it("ignores opening the page already shown", () => {
    const navigation = visit(acme, profileView);
    expect(navigateTo(navigation, profileView)).toBe(navigation);
  });

  it("remembers the application last opened while other pages are shown", () => {
    const navigation = visit(acme, profileView, homeView, evidenceView);
    expect(navigation.lastApplication).toBe(acme);
    expect(visit(acme, homeView, globex).lastApplication).toBe(globex);
  });

  it("keeps the New application flow while Back can return to it", () => {
    let navigation = openNewApplication(initialPageNavigation());
    expect(navigation.view).toBe(newApplicationView);
    expect(keepsNewApplicationFlow(navigation)).toBe(true);
    navigation = navigateTo(navigation, profileView);
    expect(keepsNewApplicationFlow(navigation)).toBe(true);
    expect(pageLabel(backTarget(navigation) ?? homeView)).toBe("New application");
    navigation = goBack(navigation);
    expect(navigation.view).toBe(newApplicationView);
    navigation = navigateTo(navigation, homeView);
    expect(keepsNewApplicationFlow(navigation)).toBe(false);
  });

  it("starts every New application from an empty flow", () => {
    const first = openNewApplication(initialPageNavigation());
    const second = openNewApplication(navigateTo(first, homeView));
    expect(second.newApplicationEpoch).toBe(first.newApplicationEpoch + 1);
    const again = openNewApplication(navigateTo(first, profileView));
    expect(again.view).toBe(newApplicationView);
    expect(trail(again)).toEqual(["profile"]);
    expect(again.newApplicationEpoch).toBe(first.newApplicationEpoch + 1);
  });

  it("replaces a finished New application flow with the application it started", () => {
    const flow = navigateTo(openNewApplication(initialPageNavigation()), profileView);
    const finished = finishNewApplication(goBack(flow), acme);
    expect(finished.view).toBe(acme);
    expect(keepsNewApplicationFlow(finished)).toBe(false);
    expect(backTarget(finished)).toBe(homeView);
    // A review started while another page was shown leaves no flow on the trail either.
    expect(keepsNewApplicationFlow(finishNewApplication(flow, acme))).toBe(false);
  });

  it("names each page", () => {
    expect(pageLabel(homeView)).toBe("Home");
    expect(pageLabel(evidenceView)).toBe("Career evidence");
    expect(pageLabel(profileView)).toBe("Career profile");
    expect(pageLabel(newApplicationView)).toBe("New application");
    expect(pageLabel(acme)).toBe("Acme — Backend Lead");
  });
});
