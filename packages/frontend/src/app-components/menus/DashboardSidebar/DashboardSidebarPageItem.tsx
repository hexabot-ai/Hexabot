/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Box from "@mui/material/Box";
import Collapse from "@mui/material/Collapse";
import Grow from "@mui/material/Grow";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import { type Theme, SxProps, useTheme } from "@mui/material/styles";
import type {} from "@mui/material/themeCssVarsAugmentation";
import Tooltip from "@mui/material/Tooltip";
import * as React from "react";
import { Link } from "react-router-dom";

import { useDashboardSidebar } from "./hooks/useDashboardSidebar";
import { ICON_WIDTH } from "./measurements.constansts";
import { DashboardSidebarProvider } from "./providers/DashboardSidebarProvider";
import { DashboardSidebarPageItemProps } from "./types/sidebar.types";

export const DashboardSidebarPageItem = ({
  id,
  title,
  icon,
  href,
  action,
  tooltip,
  defaultExpanded = false,
  expanded = defaultExpanded,
  selected = false,
  disabled = false,
  nestedNavigation,
}: DashboardSidebarPageItemProps) => {
  const theme = useTheme();
  const { onPageItemClick, mini, fullyExpanded, fullyCollapsed } =
    useDashboardSidebar();
  const [isHovered, setIsHovered] = React.useState(false);
  const hasSub = !!nestedNavigation;
  const submenuAnchorName = `--dashboard-sidebar-item-${React.useId().replaceAll(
    ":",
    "",
  )}`;
  const isExternal = href?.startsWith("http");
  const handleClick = () => onPageItemClick?.(id, hasSub);
  const linkProps = !hasSub
    ? isExternal
      ? {
          component: "a" as const,
          href,
          target: "_blank",
          rel: "noopener",
        }
      : {
          component: Link,
          to: href,
        }
    : {};
  const tooltipTitle = mini && title ? title : "";
  const selectedColor = selected ? theme.palette.primary.main : "currentColor";
  const arrowSx: SxProps<Theme> =
    mini && fullyCollapsed
      ? {
          position: "absolute",
          top: "41.5%",
          right: 0,
          transform: "translateY(-25%) rotate(-90deg)",
          fontSize: 18,
          color: selectedColor,
          fill: "currentColor",
          "&&": { color: selectedColor },
        }
      : !mini && fullyExpanded
        ? {
            ml: 0.5,
            fontSize: 20,
            transform: `rotate(${expanded ? 0 : -90}deg)`,
            transition: "transform 0.1s",
            color: selectedColor,
            fill: "currentColor",
            "&&": { color: selectedColor },
          }
        : { display: "none" };
  const itemButton = (
    <ListItemButton
      selected={selected}
      disabled={disabled}
      onClick={handleClick}
      aria-label={title}
      aria-current={selected && !hasSub ? "page" : undefined}
      aria-expanded={hasSub ? expanded : undefined}
      {...linkProps}
      sx={{
        height: mini ? 50 : "auto",
        justifyContent: "center",
        color: selectedColor,
        "&.Mui-selected .DashboardSidebarPageItem-chevron": {
          color: selectedColor,
        },
      }}
    >
      {(icon || mini) && (
        <Box
          sx={{
            position: mini ? "relative" : "initial",
          }}
        >
          <ListItemIcon
            sx={{
              display: "flex",
              justifyContent: "center",
              width: ICON_WIDTH,
              color: selectedColor,
            }}
          >
            {icon}
          </ListItemIcon>
        </Box>
      )}

      {!mini && (
        <ListItemText
          primary={title}
          sx={{
            whiteSpace: "nowrap",
            zIndex: 1,
            color: selectedColor,
          }}
        />
      )}

      {action && !mini && fullyExpanded && action}
      {hasSub && (
        <ExpandMoreIcon
          className="DashboardSidebarPageItem-chevron"
          htmlColor={selected ? selectedColor : undefined}
          style={selected ? { color: selectedColor } : undefined}
          sx={arrowSx}
        />
      )}
    </ListItemButton>
  );

  return (
    <>
      <ListItem
        sx={{
          px: mini ? 0 : 1,
          anchorName: mini ? submenuAnchorName : undefined,
        }}
        disablePadding
        onMouseEnter={() => hasSub && mini && setIsHovered(true)}
        onMouseLeave={() => hasSub && mini && setIsHovered(false)}
        onFocus={() => hasSub && mini && setIsHovered(true)}
        onBlur={(event) => {
          if (
            hasSub &&
            mini &&
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setIsHovered(false);
          }
        }}
      >
        {tooltipTitle ? (
          <Tooltip
            title={tooltipTitle}
            placement="top-start"
            arrow
            enterDelay={700}
            disableInteractive
            slotProps={{
              popper: {
                modifiers: [{ name: "offset", options: { offset: [8, -20] } }],
              },
            }}
            {...tooltip}
          >
            <Box component="span" sx={{ display: "block", width: "100%" }}>
              {itemButton}
            </Box>
          </Tooltip>
        ) : (
          itemButton
        )}

        {hasSub && mini && (
          <Grow in={isHovered}>
            <Box
              sx={{
                position: "fixed",
                positionAnchor: submenuAnchorName,
                top: "anchor(top)",
                left: "anchor(right)",
                pl: "8px",
              }}
            >
              <Paper elevation={8}>
                <DashboardSidebarProvider
                  {...{
                    onPageItemClick,
                    mini: false,
                    fullyExpanded: true,
                    fullyCollapsed: false,
                    hasDrawerTransitions: false,
                  }}
                >
                  {nestedNavigation}
                </DashboardSidebarProvider>
              </Paper>
            </Box>
          </Grow>
        )}
      </ListItem>

      {hasSub && !mini && (
        <Collapse in={expanded} timeout="auto" unmountOnExit>
          {nestedNavigation}
        </Collapse>
      )}
    </>
  );
};
