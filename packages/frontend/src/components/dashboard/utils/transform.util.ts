/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { LucideIcon, Mail, Webhook } from "lucide-react";

import { theme } from "@/layout/theme";

export const getColor = (c: string) => {
  const colors: Record<string, string> = {
    primary: theme.palette.primary.main,
    secondary: theme.palette.secondary.main,
    success: theme.palette.success.main,
    warning: theme.palette.warning.main,
    info: theme.palette.info.main,
    error: theme.palette.error.main,
  };

  return colors[c] || theme.palette.primary.main;
};

export const getIntegrationIcon = (name: string): LucideIcon => {
  const normalizedName = name.toLowerCase();

  if (normalizedName.includes("email") || normalizedName.includes("smtp"))
    return Mail;

  return Webhook;
};
