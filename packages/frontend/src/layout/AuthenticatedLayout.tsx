/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Box, Grid, useMediaQuery } from "@mui/material";
import React from "react";

import { HexabotLogo } from "@/app-components/logos/HexabotLogo";
import { DashboardHeader } from "@/app-components/menus/DashboardSidebar/DashboardHeader";
import { DashboardSidebar } from "@/app-components/menus/DashboardSidebar/DashboardSidebar";
import { AdminWorkflowTour } from "@/components/guided-tour/AdminWorkflowTour";
import { useAuthRedirection } from "@/hooks/auth/useAuthRedirection";
import useAvailableMenuItems from "@/hooks/useAvailableMenuItems";
import { useConfig } from "@/hooks/useConfig";
import { useEntityMutationSubscription } from "@/hooks/useEntityMutationSubscription";
import { usePendingWorkflowRunsSync } from "@/hooks/usePendingWorkflowRunsSync";
import { getMenuItems } from "@/utils/menu.util";
import { WorkflowEventProvider } from "@/websocket/workflow-event-hooks";

import { LayoutProps } from ".";

import { theme } from "./theme";

export const AuthenticatedLayout: React.FC<
  LayoutProps & { hasNoPadding?: boolean }
> = ({ children, hasNoPadding, isPublicRoute }) => {
  useEntityMutationSubscription();
  usePendingWorkflowRunsSync();

  const [isDesktopNavigationExpanded, setIsDesktopNavigationExpanded] =
    React.useState(false);
  const isOverMdViewport = useMediaQuery(theme.breakpoints.up("md"));
  const setIsNavigationExpanded = React.useCallback(
    (newExpanded: boolean) => {
      setIsDesktopNavigationExpanded(newExpanded);
    },
    [isOverMdViewport, setIsDesktopNavigationExpanded],
  );
  const handleToggleHeaderMenu = React.useCallback(
    (isExpanded: boolean) => {
      setIsNavigationExpanded(isExpanded);
    },
    [setIsNavigationExpanded],
  );
  const { ssoEnabled } = useConfig();
  const menuItems = getMenuItems(ssoEnabled);
  const availableMenuItems = useAvailableMenuItems(menuItems);
  const { loginRedirection } = useAuthRedirection();

  React.useEffect(() => {
    if (isPublicRoute) {
      void loginRedirection();
    }
  }, [isPublicRoute, loginRedirection]);

  if (isPublicRoute) {
    return null;
  }

  return (
    <WorkflowEventProvider>
      <Box display="flex" width="100%" maxWidth="100vw" overflow="hidden">
        <DashboardHeader
          logo={<HexabotLogo />}
          menuOpen={isDesktopNavigationExpanded}
          onToggleMenu={handleToggleHeaderMenu}
        />
        <DashboardSidebar
          menu={availableMenuItems}
          expanded={isDesktopNavigationExpanded}
          setExpanded={setIsNavigationExpanded}
        />

        <Grid
          sx={{
            padding: hasNoPadding ? 0 : 3,
            position: "relative",
            marginTop: "64px",
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minWidth: 0,
            maxWidth: "100%",
            boxSizing: "border-box",
            overflowX: "hidden",
            overflowY: "auto",
            width: 0,
            zIndex: 5,
          }}
        >
          {children}
        </Grid>
      </Box>
      <AdminWorkflowTour />
    </WorkflowEventProvider>
  );
};
