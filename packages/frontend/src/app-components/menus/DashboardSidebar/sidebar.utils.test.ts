/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Link } from "react-router";
import { describe, expect, it } from "vitest";

import {
  getActiveParentItemIds,
  getChevronSx,
  getItemLinkProps,
  getMenuLinks,
  isMenuLinkSelected,
} from "./sidebar.utils";
import type { TMenu } from "./types/sidebar.types";

const menu = [
  { text: "menu.dashboard", href: "/" },
  { text: "menu.workflows", href: "/workflows" },
  {
    text: "menu.settings",
    submenuItems: [
      { text: "menu.users", href: "/settings/users" },
      { text: "menu.roles", href: "/settings/roles" },
    ],
  },
  { text: "menu.integrations" },
] as TMenu[];

describe("getItemLinkProps", () => {
  it("routes app paths through the router", () => {
    expect(getItemLinkProps("/workflows", false)).toEqual({
      component: Link,
      to: "/workflows",
    });
  });

  it("opens external links in a new tab", () => {
    expect(getItemLinkProps("https://docs.hexabot.ai", false)).toEqual({
      component: "a",
      href: "https://docs.hexabot.ai",
      target: "_blank",
      rel: "noopener",
    });
  });

  it("does not link an item with nested items", () => {
    expect(getItemLinkProps("/settings", true)).toEqual({});
  });
});

describe("getChevronSx", () => {
  const chevron = (state: {
    mini: boolean;
    fullyCollapsed: boolean;
    fullyExpanded: boolean;
    expanded?: boolean;
  }) => getChevronSx({ expanded: false, color: "red", ...state });

  it("points right at the edge of the collapsed sidebar", () => {
    expect(
      chevron({ mini: true, fullyCollapsed: true, fullyExpanded: false }),
    ).toMatchObject({
      position: "absolute",
      transform: "translateY(-25%) rotate(-90deg)",
      color: "red",
    });
  });

  it("turns with the item in the expanded sidebar", () => {
    const state = { mini: false, fullyCollapsed: false, fullyExpanded: true };

    expect(chevron({ ...state, expanded: true })).toMatchObject({
      transform: "rotate(0deg)",
      "&&": { color: "red" },
    });
    expect(chevron(state)).toMatchObject({ transform: "rotate(-90deg)" });
  });

  it("hides while the sidebar transitions", () => {
    expect(
      chevron({ mini: true, fullyCollapsed: false, fullyExpanded: false }),
    ).toEqual({ display: "none" });
    expect(
      chevron({ mini: false, fullyCollapsed: false, fullyExpanded: false }),
    ).toEqual({ display: "none" });
  });
});

describe("menu selection", () => {
  const links = getMenuLinks(menu);
  const selected = (pathname: string) =>
    links.filter((href) => href && isMenuLinkSelected(href, pathname, links));

  it("lists the paths of the menu, nested items included", () => {
    expect(links).toEqual([
      "/",
      "/workflows",
      "/settings/users",
      "/settings/roles",
    ]);
  });

  it("selects the link of the current page", () => {
    expect(selected("/workflows")).toEqual(["/workflows"]);
    expect(selected("/")).toEqual(["/"]);
  });

  it("selects the link a page without its own link is under", () => {
    expect(selected("/workflows/wf-1")).toEqual(["/workflows"]);
    expect(selected("/unknown")).toEqual([]);
  });

  it("expands the groups that contain the current page", () => {
    expect(
      getActiveParentItemIds(menu, (href) =>
        isMenuLinkSelected(href, "/settings/roles", links),
      ),
    ).toEqual(["menu.settings"]);
    expect(
      getActiveParentItemIds(menu, (href) =>
        isMenuLinkSelected(href, "/workflows", links),
      ),
    ).toEqual([]);
  });
});
