/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { SxProps, Theme } from "@mui/material/styles";
import { Link } from "react-router";

import type { TMenu } from "./types/sidebar.types";

/**
 * Link props of a sidebar item: external URLs open in a new tab, app paths go
 * through the router, and an item with nested items is not a link.
 */
export const getItemLinkProps = (
  href: string | undefined,
  hasNestedNavigation: boolean,
) => {
  if (hasNestedNavigation) {
    return {};
  }

  return href?.startsWith("http")
    ? {
        component: "a" as const,
        href,
        target: "_blank",
        rel: "noopener",
      }
    : {
        component: Link,
        to: href,
      };
};

/**
 * Style of the chevron of an item with nested items: pointing right at the
 * edge of the collapsed sidebar, turning with the item in the expanded one,
 * hidden while the sidebar transitions.
 */
export const getChevronSx = ({
  mini,
  fullyCollapsed,
  fullyExpanded,
  expanded,
  color,
}: {
  mini: boolean;
  fullyCollapsed: boolean;
  fullyExpanded: boolean;
  expanded: boolean;
  color: string;
}): SxProps<Theme> => {
  if (mini && fullyCollapsed) {
    return {
      position: "absolute",
      top: "41.5%",
      right: 0,
      transform: "translateY(-25%) rotate(-90deg)",
      fontSize: 18,
      color,
      fill: "currentColor",
      "&&": { color },
    };
  }

  if (!mini && fullyExpanded) {
    return {
      ml: 0.5,
      fontSize: 20,
      transform: `rotate(${expanded ? 0 : -90}deg)`,
      transition: "transform 0.1s",
      color,
      fill: "currentColor",
      "&&": { color },
    };
  }

  return { display: "none" };
};

/** The paths the menu links to, nested items included. */
export const getMenuLinks = (menu: TMenu[]) =>
  menu
    .flatMap((item) => item.submenuItems || item)
    .filter((item) => item.href)
    .map((item) => item.href);

/**
 * Whether a menu link is the current page: its exact path, or a page under
 * it that no other menu link matches exactly ("/" only matches itself).
 */
export const isMenuLinkSelected = (
  href: string,
  pathname: string,
  links: (string | undefined)[],
) =>
  href === pathname ||
  (!links.includes(pathname) && pathname.startsWith(href) && href !== "/");

/** The groups that contain the current page, to expand them. */
export const getActiveParentItemIds = (
  menu: TMenu[],
  isSelected: (href: string) => boolean,
) =>
  menu
    .filter((item) =>
      item.submenuItems?.some((sub) => sub.href && isSelected(sub.href)),
    )
    .map((item) => item.text);
