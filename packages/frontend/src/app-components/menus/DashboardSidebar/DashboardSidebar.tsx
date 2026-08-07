/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Divider, ListSubheader } from "@mui/material";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import { useTheme } from "@mui/material/styles";
import type {} from "@mui/material/themeCssVarsAugmentation";
import Toolbar from "@mui/material/Toolbar";
import useMediaQuery from "@mui/material/useMediaQuery";
import * as React from "react";
import { useLocation } from "react-router";

import { useTranslate } from "@/hooks/useTranslate";

import { DashboardSidebarPageItem } from "./DashboardSidebarPageItem";
import { DRAWER_WIDTH, MINI_DRAWER_WIDTH } from "./measurements.constansts";
import {
  getDrawerSxTransitionMixin,
  getDrawerWidthTransitionMixin,
} from "./mixins";
import { DashboardSidebarProvider } from "./providers/DashboardSidebarProvider";
import { DashboardSidebarProps } from "./types/sidebar.types";

export const DashboardSidebar = ({
  expanded = true,
  setExpanded,
  disableCollapsibleSidebar = false,
  container,
  menu,
}: DashboardSidebarProps) => {
  const theme = useTheme();
  const location = useLocation();
  const { t } = useTranslate();
  const [expandedItemIds, setExpandedItemIds] = React.useState<string[]>([]);
  const isSm = useMediaQuery(theme.breakpoints.up("sm"));
  const isMd = useMediaQuery(theme.breakpoints.up("md"));
  const [transitionState, setTransitionState] = React.useState({
    fullyExpanded: expanded,
    fullyCollapsed: !expanded,
  });
  const shouldUseTemporaryDrawer =
    !isMd && (!isSm || disableCollapsibleSidebar);

  React.useEffect(() => {
    const duration = expanded
      ? theme.transitions.duration.enteringScreen
      : theme.transitions.duration.leavingScreen;
    const timer = setTimeout(() => {
      setTransitionState({
        fullyExpanded: expanded,
        fullyCollapsed: !expanded,
      });
    }, duration);

    return () => clearTimeout(timer);
  }, [expanded, theme.transitions.duration]);

  const mini = !disableCollapsibleSidebar && !expanded;
  const hasDrawerTransitions = isSm && (!disableCollapsibleSidebar || isMd);
  const handlePageItemClick = React.useCallback(
    (itemId: string, hasNested: boolean) => {
      if (hasNested && !mini) {
        setExpandedItemIds((prev) =>
          prev.includes(itemId)
            ? prev.filter((id) => id !== itemId)
            : [...prev, itemId],
        );
      } else if (!isSm && !hasNested) {
        setExpanded(false);
      }
    },
    [mini, isSm, setExpanded],
  );
  const getDrawerSharedSx = (isTemporary: boolean) => ({
    displayPrint: "none",
    width: mini ? MINI_DRAWER_WIDTH : DRAWER_WIDTH,
    flexShrink: 0,
    ...getDrawerWidthTransitionMixin(expanded),
    ...(isTemporary && { position: "absolute" }),
    "& .MuiDrawer-paper": {
      position: "fixed",
      width: mini ? MINI_DRAWER_WIDTH : DRAWER_WIDTH,
      boxSizing: "border-box",
      backgroundImage: "none",
      ...getDrawerWidthTransitionMixin(expanded),
    },
  });
  const sidebarContextValue = React.useMemo(
    () => ({
      onPageItemClick: handlePageItemClick,
      mini,
      ...transitionState,
      hasDrawerTransitions,
    }),
    [handlePageItemClick, mini, transitionState, hasDrawerTransitions],
  );
  const links = React.useMemo(
    () =>
      menu
        .flatMap((m) => m.submenuItems || m)
        .filter((m) => m.href)
        .map((m) => m.href),
    [menu],
  );
  const isSelected = React.useCallback(
    (href: string) => {
      if (href === location.pathname) {
        return true;
      } else if (
        !links.includes(location.pathname) &&
        location.pathname.startsWith(href) &&
        href !== "/"
      ) {
        return true;
      }

      return false;
    },
    [links, location.pathname],
  );

  React.useEffect(() => {
    const activeParentItemIds = menu
      .filter((item) =>
        item.submenuItems?.some((sub) => sub.href && isSelected(sub.href)),
      )
      .map((item) => item.text);

    if (activeParentItemIds.length === 0) {
      return;
    }

    setExpandedItemIds((prev) =>
      activeParentItemIds.every((itemId) => prev.includes(itemId))
        ? prev
        : [...new Set([...prev, ...activeParentItemIds])],
    );
  }, [isSelected, menu]);

  const renderMenuItems = menu.map((item) => {
    if (item.submenuItems?.length && item.Icon) {
      return (
        <DashboardSidebarPageItem
          key={item.text}
          id={item.text}
          title={t(item.text)}
          icon={<item.Icon />}
          tooltip={item.tooltip}
          expanded={expandedItemIds.includes(item.text)}
          selected={item.submenuItems.some(
            (sub) => !!sub.href && isSelected(sub.href),
          )}
          nestedNavigation={
            <List
              dense
              sx={{
                p: 0,
                my: mini ? 1 : 0,
                pl: mini ? 0 : 1,
                gap: mini ? 1 : 1,
                width: mini ? "auto" : "calc(100% - 8px)",
              }}
            >
              {item.submenuItems?.map((sub) => (
                <DashboardSidebarPageItem
                  key={sub.text}
                  id={sub.text}
                  title={t(sub.text)}
                  icon={sub.Icon && <sub.Icon />}
                  href={sub.href}
                  tooltip={sub.tooltip}
                  selected={sub.href ? isSelected(sub.href) : false}
                />
              ))}
            </List>
          }
        />
      );
    } else if (item.Icon && item.href) {
      return (
        <DashboardSidebarPageItem
          key={item.text}
          id={item.text}
          title={t(item.text)}
          icon={<item.Icon />}
          href={item.href}
          tooltip={item.tooltip}
          selected={isSelected(item.href)}
        />
      );
    } else if (!item.href) {
      return (
        <Divider key={item.text}>
          {expanded ? <ListSubheader>{t(item.text)}</ListSubheader> : null}
        </Divider>
      );
    } else return null;
  });
  const drawerContent = (
    <>
      <Toolbar />
      <Box
        component="nav"
        sx={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "auto",
          overflowX: "hidden",
          ...(hasDrawerTransitions
            ? getDrawerSxTransitionMixin(
                transitionState.fullyExpanded,
                "padding",
              )
            : {}),
        }}
      >
        <List dense sx={{ p: 0.5, gap: mini ? 0.5 : 1, py: mini ? 0.5 : 1.5 }}>
          {renderMenuItems}
        </List>
      </Box>
    </>
  );

  return (
    <DashboardSidebarProvider {...sidebarContextValue}>
      <Drawer
        container={container}
        variant="temporary"
        open={shouldUseTemporaryDrawer && expanded}
        onClose={() => setExpanded(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: {
            xs: "block",
            sm: disableCollapsibleSidebar ? "block" : "none",
            md: "none",
          },
          ...getDrawerSharedSx(true),
        }}
      >
        {drawerContent}
      </Drawer>
      <Drawer
        variant="permanent"
        sx={{
          display: {
            xs: "none",
            sm: disableCollapsibleSidebar ? "none" : "block",
            md: "block",
          },
          ...getDrawerSharedSx(false),
        }}
      >
        {drawerContent}
      </Drawer>
    </DashboardSidebarProvider>
  );
};
