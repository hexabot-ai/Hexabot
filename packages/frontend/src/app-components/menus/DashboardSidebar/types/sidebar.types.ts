/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action } from "@hexabot-ai/types";
import { PopoverProps, type TooltipProps } from "@mui/material";
import { type LucideIcon } from "lucide-react";
import { ComponentType, PropsWithChildren } from "react";

import { type TTranslationKeys } from "@/i18n/i18n.types";
import { EntityType } from "@/services/types";
import { User } from "@/types/user.types";

export type TMenuItemBadgeProps = {
  /** `count` next to the label, `dot` over the icon of a mini sidebar. */
  variant?: "count" | "dot";
};

type TMenuItem = {
  Icon?: LucideIcon;
  text: TTranslationKeys;
  href?: string;
  selected?: boolean;
  onClick?: () => void;
  tooltip?: Partial<TooltipProps>;
  requires?: { [key in EntityType]?: Action[] };
  /** Live counter shown on the item (and on its collapsed parent group). */
  Badge?: ComponentType<TMenuItemBadgeProps>;
};

export type TMenu = TMenuItem & {
  submenuItems?: TMenuItem[];
};

export interface DashboardHeaderProps {
  logo?: React.ReactNode;
  menuOpen: boolean;
  onToggleMenu: (open: boolean) => void;
}

export type TPopoverMenuItem = { text: string; href: string };

export type TPopoverMenuLogoutItem = { text: string; onClick: () => void };
export type PopoverMenuProps = {
  user?: Pick<User, "email" | "firstName" | "lastName" | "fullName">;
  links?: TPopoverMenuItem[];
  logout?: TPopoverMenuLogoutItem;
  handleClose?: () => void;
} & PopoverProps;

export interface DashboardSidebarProps {
  expanded?: boolean;
  setExpanded: (expanded: boolean) => void;
  disableCollapsibleSidebar?: boolean;
  container?: Element;
  menu: TMenu[];
}

export interface DashboardSidebarPageItemProps {
  id: string;
  title?: string;
  icon?: React.ReactNode;
  href?: string;
  action?: React.ReactNode;
  /** Shown over the icon when the sidebar is mini (e.g. a badge dot). */
  iconAdornment?: React.ReactNode;
  tooltip?: Partial<TooltipProps>;
  defaultExpanded?: boolean;
  expanded?: boolean;
  selected?: boolean;
  disabled?: boolean;
  nestedNavigation?: React.ReactNode;
}

export interface DashboardSidebarHeaderItemProps {
  children?: React.ReactNode;
}

export type DashboardSidebarProviderProps = PropsWithChildren<{
  onPageItemClick: (id: string, hasNestedNavigation: boolean) => void;
  mini: boolean;
  fullyExpanded: boolean;
  fullyCollapsed: boolean;
  hasDrawerTransitions: boolean;
}>;
