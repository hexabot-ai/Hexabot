/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action, type SourceFull } from "@hexabot-ai/types";
import {
  Button,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { ChevronDown, Copy, Plus, Webhook } from "lucide-react";
import { MouseEvent, useMemo, useState } from "react";

import { ChipEntity } from "@/app-components/displays/ChipEntity";
import {
  ColumnActionType,
  useActionColumns,
} from "@/app-components/tables/columns/getColumns";
import { GenericDataGrid } from "@/app-components/tables/GenericDataGrid";
import { useFind } from "@/hooks/crud/useFind";
import { useUpdate } from "@/hooks/crud/useUpdate";
import { useDialogs } from "@/hooks/useDialogs";
import { useHasPermission } from "@/hooks/useHasPermission";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType, Format } from "@/services/types";
import { IChannel } from "@/types/channel.types";
import { writeToClipboard } from "@/utils/clipboard";
import { getDateTimeFormatter } from "@/utils/date";

import {
  isSourceChannelRegistered,
  isSourceStateToggleDisabled,
} from "./source-form.utils";
import { SourceFormDialog } from "./SourceFormDialog";

const SOURCE_REF_ICON_SIZE = 18;

export const Sources = () => {
  const { t } = useTranslate();
  const { toast } = useToast();
  const dialogs = useDialogs();
  const [addMenuAnchorEl, setAddMenuAnchorEl] = useState<HTMLElement | null>(
    null,
  );
  const hasPermission = useHasPermission();
  const canUpdateSources = hasPermission(EntityType.SOURCE, Action.UPDATE);
  const { data: channels = [], isLoading: isLoadingChannels } = useFind(
    { entity: EntityType.CHANNEL },
    { hasCount: false },
  );
  const channelMetadataByName = useMemo(
    () =>
      channels.reduce(
        (acc, channel) => {
          acc[channel.name] = channel;

          return acc;
        },
        {} as Record<string, IChannel>,
      ),
    [channels],
  );
  const { mutate: updateSource } = useUpdate(EntityType.SOURCE, {
    onError: (error: Error) => {
      toast.error(error);
    },
    onSuccess() {
      toast.success(t("message.success_save"));
    },
  });
  const openCreateDialog = (channel: IChannel) => {
    dialogs.open(SourceFormDialog, {
      defaultValues: null,
      presetValues: {
        channel: channel.name,
        channelsByName: channelMetadataByName,
      },
    });
  };
  const handleOpenAddMenu = (event: MouseEvent<HTMLElement>) => {
    if (!isLoadingChannels && channels.length > 0) {
      setAddMenuAnchorEl(event.currentTarget);
    }
  };
  const handleCloseAddMenu = () => {
    setAddMenuAnchorEl(null);
  };
  const copySourceRef = async (sourceRef: string) => {
    try {
      await writeToClipboard(sourceRef);
      toast.success(t("message.source_ref_copied"));
    } catch {
      toast.error(t("message.source_ref_copy_failed"));
    }
  };
  const actionColumns = useActionColumns<SourceFull>(
    EntityType.SOURCE,
    [
      {
        action: ColumnActionType.Edit,
        onClick: (row) => {
          dialogs.open(SourceFormDialog, {
            defaultValues: row,
            presetValues: {
              channelsByName: channelMetadataByName,
            },
          });
        },
        isDisabled: (row) =>
          isLoadingChannels ||
          !isSourceChannelRegistered(row.channel, channelMetadataByName),
        requires: [Action.UPDATE],
      },
    ],
    t("label.operations"),
  );
  const columns: GridColDef<SourceFull>[] = [
    {
      minWidth: 280,
      field: "sourceRef",
      headerName: t("label.source_ref"),
      disableColumnMenu: true,
      headerAlign: "left",
      sortable: false,
      renderCell: ({ row }) => (
        <Stack alignItems="center" direction="row" spacing={1} width="100%">
          <Typography
            noWrap
            title={row.id}
            variant="body2"
            sx={{
              flex: 1,
              fontFamily: "monospace",
              minWidth: 0,
            }}
          >
            {row.id}
          </Typography>
          <Tooltip title={t("button.copy_source_ref")}>
            <IconButton
              aria-label={t("button.copy_source_ref")}
              onClick={(event) => {
                event.stopPropagation();
                void copySourceRef(row.id);
              }}
              size="small"
            >
              <Copy size={SOURCE_REF_ICON_SIZE} />
            </IconButton>
          </Tooltip>
        </Stack>
      ),
    },
    {
      flex: 1,
      field: "name",
      headerName: t("label.name"),
      disableColumnMenu: true,
      headerAlign: "left",
    },
    {
      minWidth: 140,
      field: "channel",
      headerName: t("label.channel"),
      disableColumnMenu: true,
      headerAlign: "left",
      renderCell: ({ row }) => {
        const isRegisteredChannel = isSourceChannelRegistered(
          row.channel,
          channelMetadataByName,
        );

        return (
          <Stack alignItems="center" direction="row" spacing={1} width="100%">
            <Typography noWrap variant="body2" sx={{ minWidth: 0 }}>
              {row.channel}
            </Typography>
            {!isLoadingChannels && !isRegisteredChannel ? (
              <Tooltip
                title={t("message.source_channel_handler_not_registered")}
              >
                <Chip
                  color="error"
                  label={t("label.unregistered")}
                  size="small"
                  variant="outlined"
                />
              </Tooltip>
            ) : null}
          </Stack>
        );
      },
    },
    {
      flex: 1,
      field: "defaultWorkflow",
      headerName: t("label.workflow"),
      disableColumnMenu: true,
      headerAlign: "left",
      renderCell: ({ value }) =>
        value ? (
          <ChipEntity
            id={value}
            key={value}
            field="name"
            color="primary"
            entity={EntityType.WORKFLOW}
          />
        ) : (
          <Chip label={t("label.none")} />
        ),
    },
    {
      maxWidth: 140,
      field: "state",
      headerName: t("label.enabled"),
      disableColumnMenu: true,
      headerAlign: "left",
      renderCell: ({ row }) => {
        const isRegisteredChannel = isSourceChannelRegistered(
          row.channel,
          channelMetadataByName,
        );

        return (
          <Switch
            checked={row.state}
            disabled={isSourceStateToggleDisabled({
              channelName: row.channel,
              state: row.state,
              disabled:
                !canUpdateSources || isLoadingChannels || !isRegisteredChannel,
            })}
            onChange={() =>
              updateSource({
                id: row.id,
                params: { state: !row.state },
              })
            }
          />
        );
      },
    },
    {
      minWidth: 140,
      field: "createdAt",
      headerName: t("label.createdAt"),
      disableColumnMenu: true,
      resizable: false,
      headerAlign: "left",
      valueGetter: (params) =>
        t("datetime.created_at", getDateTimeFormatter(params)),
    },
    {
      minWidth: 140,
      field: "updatedAt",
      headerName: t("label.updatedAt"),
      disableColumnMenu: true,
      resizable: false,
      headerAlign: "left",
      valueGetter: (params) =>
        t("datetime.updated_at", getDateTimeFormatter(params)),
    },
    actionColumns,
  ];

  return (
    <>
      <GenericDataGrid
        entity={EntityType.SOURCE}
        format={Format.FULL}
        buttons={[
          {
            permissionAction: Action.CREATE,
            children: (
              <Button
                size="small"
                variant="contained"
                startIcon={<Plus />}
                endIcon={<ChevronDown size={18} />}
                onClick={handleOpenAddMenu}
                disabled={isLoadingChannels || channels.length === 0}
              >
                {t("button.add")}
              </Button>
            ),
          },
        ]}
        columns={columns}
        headerIcon={Webhook}
        searchParams={{
          $or: ["name", "channel"],
          syncUrl: true,
        }}
        headerI18nTitle="title.channel_sources"
      />
      <Menu
        anchorEl={addMenuAnchorEl}
        open={Boolean(addMenuAnchorEl)}
        onClose={handleCloseAddMenu}
      >
        {channels.length > 0 ? (
          channels.map((channel) => (
            <MenuItem
              key={channel.name}
              onClick={() => {
                openCreateDialog(channel);
                handleCloseAddMenu();
              }}
            >
              {channel.name}
            </MenuItem>
          ))
        ) : (
          <MenuItem disabled>
            {t("message.no_channels_available_for_sources")}
          </MenuItem>
        )}
      </Menu>
    </>
  );
};
