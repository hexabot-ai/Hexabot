/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Workflow } from "@hexabot-ai/types";
import { Box, Chip, Stack, Tooltip, Typography } from "@mui/material";
import type { MouseEvent } from "react";

import { WorkflowActionButtons } from "../WorkflowActionButtons";

import { HighlightedText } from "./HighlightedText";
import { FlowItem } from "./styles";
import type { FlowMatch } from "./types";

type FlowListItemProps = {
  match: FlowMatch;
  normalizedQuery: string;
  onSelect: (flowId: string) => void;
  onEdit?: (workflow: Workflow) => void;
  onOpenMenu: (event: MouseEvent<HTMLElement>, flowId: string) => void;
  renameLabel: string;
  moreLabel: string;
};

export const FlowListItem = ({
  match,
  normalizedQuery,
  onSelect,
  onEdit,
  onOpenMenu,
  renameLabel,
  moreLabel,
}: FlowListItemProps) => {
  const hasTypeMeta = Boolean(
    match.typeMeta.secondaryText || match.typeMeta.badge,
  );

  return (
    <FlowItem
      selected={match.isSelected}
      onClick={() => onSelect(match.workflow.id)}
    >
      <Stack spacing={0.5} flex={1} minWidth={0}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={1}
          minWidth={0}
        >
          <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            flex={1}
            minWidth={0}
          >
            <Tooltip title={match.workflow.name} arrow>
              <Typography variant="subtitle2" noWrap flex={1}>
                <HighlightedText
                  text={match.workflow.name}
                  matches={match.nameMatch}
                />
              </Typography>
            </Tooltip>
            {match.hasUnsaved && (
              <Box
                component="span"
                sx={{
                  width: (theme) => theme.spacing(0.75),
                  height: (theme) => theme.spacing(0.75),
                  borderRadius: "50%",
                  bgcolor: "warning.main",
                }}
              />
            )}
            <Chip
              size="small"
              label={match.statusLabel}
              color={match.isDraft ? "warning" : "success"}
            />
            {match.errorCount > 0 && (
              <Chip size="small" label={match.errorLabel ?? ""} color="error" />
            )}
          </Stack>
          <WorkflowActionButtons
            className="flow-row-actions"
            workflow={match.workflow}
            onEdit={onEdit}
            onOpenMenu={onOpenMenu}
            renameLabel={renameLabel}
            moreLabel={moreLabel}
          />
        </Stack>
        {hasTypeMeta && (
          <Stack direction="row" alignItems="center" spacing={1} minWidth={0}>
            {match.typeMeta.secondaryText && (
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                component="div"
                flex={1}
                minWidth={0}
              >
                {match.typeMeta.secondaryText}
              </Typography>
            )}
            {match.typeMeta.badge && (
              <Chip
                size="small"
                label={match.typeMeta.badge}
                sx={{ flexShrink: 0 }}
              />
            )}
          </Stack>
        )}
        {normalizedQuery &&
          !match.nameMatch.length &&
          match.descriptionMatch.length &&
          match.workflow.description && (
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              component="div"
            >
              <HighlightedText
                text={match.workflow.description}
                matches={match.descriptionMatch}
              />
            </Typography>
          )}
      </Stack>
    </FlowItem>
  );
};
