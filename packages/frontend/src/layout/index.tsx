/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action } from "@hexabot-ai/types";
import { BoxProps } from "@mui/material";
import { type ReactElement } from "react";

import { useAuth } from "@/hooks/useAuth";
import { EntityType } from "@/services/types";

import { AnonymousLayout } from "./AnonymousLayout";
import { AuthenticatedLayout } from "./AuthenticatedLayout";

export interface IContentPaddingProps {
  hasNoPadding?: boolean;
}

export type LayoutProps = IContentPaddingProps & {
  children: ReactElement;
  sxContent?: BoxProps;
  isPublicRoute?: boolean;
  requiredPermissions?: [EntityType, Action][];
};
export const Layout: React.FC<LayoutProps> = ({ children, ...rest }) => {
  const { isAuthenticated } = useAuth();
  const publicContent = rest.isPublicRoute ? children : <></>;
  const protectedContent = rest.isPublicRoute ? <></> : children;

  return isAuthenticated ? (
    <AuthenticatedLayout {...rest}>{protectedContent}</AuthenticatedLayout>
  ) : (
    <AnonymousLayout {...rest}>{publicContent}</AnonymousLayout>
  );
};
