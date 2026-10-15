import { describe, expect, it } from "vitest";

import {
  applicationView,
  evidenceView,
  homeView,
  profileView,
  type WorkspaceView,
} from "./home-model.js";
import {
  backTarget,
  goBack,
  initialPageNavigation,
  navigateTo,
  type PageNavigation,
  pageHistoryLimit,
  pageKey,
  pageLabel,
  renameApplicationPage,
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

  it("shows an application's new name on its page, on the trail and as the last application", () => {
    const navigation = visit(acme, profileView, globex);
    const renamed = renameApplicationPage(navigation, "app-1", "Acme — Staff Engineer");
    expect(renamed.history.map(pageLabel)).toEqual(["Acme — Staff Engineer", "Career profile"]);
    expect(renamed.view).toBe(globex);
    expect(renameApplicationPage(renamed, "app-2", "Globex — SRE").lastApplication).toMatchObject({
      name: "Globex — SRE",
    });
    expect(renameApplicationPage(renamed, "app-1", "Acme — Staff Engineer")).toBe(renamed);
  });

  it("names each page", () => {
    expect(pageLabel(homeView)).toBe("Home");
    expect(pageLabel(evidenceView)).toBe("Career evidence");
    expect(pageLabel(profileView)).toBe("Career profile");
    expect(pageLabel(acme)).toBe("Acme — Backend Lead");
  });
});
