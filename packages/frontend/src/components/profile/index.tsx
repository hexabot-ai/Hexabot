/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Box, Paper, Tab, Tabs } from "@mui/material";
import Grid from "@mui/material/Grid";
import { User } from "lucide-react";
import { useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useTranslate } from "@/hooks/useTranslate";
import { PageHeader } from "@/layout/content/PageHeader";

import { ApiTokensPanel } from "./ApiTokensPanel";
import { McpTokensPanel } from "./McpTokensPanel";
import { ProfileForm } from "./profile";

type TokenTab = "api" | "mcp";

const TokensPanel = () => {
  const { t } = useTranslate();
  const [activeTab, setActiveTab] = useState<TokenTab>("mcp");

  return (
    <Paper sx={{ p: { xs: 3, md: 4 } }}>
      <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 3 }}>
        <Tabs
          value={activeTab}
          onChange={(_event, value: TokenTab) => setActiveTab(value)}
          aria-label={t("title.api_tokens")}
        >
          <Tab value="mcp" label={t("title.mcp_tokens")} />
          <Tab value="api" label={t("title.api_tokens")} />
        </Tabs>
      </Box>
      {activeTab === "api" ? <ApiTokensPanel /> : <McpTokensPanel />}
    </Paper>
  );
};

export const Profile = () => {
  const { t } = useTranslate();
  const { user } = useAuth();

  return (
    <Grid container gap={3} flexDirection="column">
      <PageHeader icon={User} title={t("title.edit_my_account")} />
      <Grid size={12} container spacing={3} alignItems="flex-start">
        <Grid size={{ xs: 12, lg: 4 }} sx={{ minWidth: 0 }}>
          <Paper sx={{ p: { xs: 3, md: 4 }, width: "100%" }}>
            {user ? <ProfileForm compact user={user} /> : null}
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, lg: 8 }} sx={{ minWidth: 0 }}>
          <TokensPanel />
        </Grid>
      </Grid>
    </Grid>
  );
};
