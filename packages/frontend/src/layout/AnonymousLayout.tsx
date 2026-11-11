/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import Grid from "@mui/material/Grid";
import { useEffect } from "react";

import { useAuthRedirection } from "@/hooks/auth/useAuthRedirection";
import { useAppRouter } from "@/hooks/useAppRouter";

import type { LayoutProps } from ".";

import { Content } from "./content";
import { Header } from "./Header";

export const AnonymousLayout: React.FC<LayoutProps> = ({
  children,
  sxContent,
  isPublicRoute,
  ...rest
}) => {
  const router = useAppRouter();
  const { logoutRedirection } = useAuthRedirection();

  useEffect(() => {
    if (!isPublicRoute) {
      void logoutRedirection(router.asPath);
    }
  }, [isPublicRoute, logoutRedirection, router.asPath]);

  return (
    <Grid container>
      <Header />
      <Content sx={sxContent} {...rest}>
        {children}
      </Content>
    </Grid>
  );
};
