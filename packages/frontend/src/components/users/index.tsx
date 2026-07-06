/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action } from "@hexabot-ai/types";
import { Button, Paper, Stack, Switch, Typography } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { UserPlus, Users as UsersIcon } from "lucide-react";

import { Avatar } from "@/app-components/displays/Avatar";
import { ChipEntity } from "@/app-components/displays/ChipEntity";
import {
  ColumnActionType,
  useActionColumns,
} from "@/app-components/tables/columns/getColumns";
import { useTimestampColumns } from "@/app-components/tables/columns/useTimestampColumns";
import { GenericDataGrid } from "@/app-components/tables/GenericDataGrid";
import {
  formatLicenseQuotaUsage,
  getLicenseQuotaResource,
  getQuotaUpgradeTargetPlan,
  isLicenseQuotaReached,
} from "@/components/license/license-quotas";
import LicenseGate, {
  hasLicensePlanAccess,
  LockedFeatureLabel,
  PaidPlan,
} from "@/components/license/LicenseGate";
import { useFind } from "@/hooks/crud/useFind";
import { useUpdate } from "@/hooks/crud/useUpdate";
import { useAppRouter } from "@/hooks/useAppRouter";
import { useAuth } from "@/hooks/useAuth";
import { useConfig } from "@/hooks/useConfig";
import { useDialogs } from "@/hooks/useDialogs";
import { useHasPermission } from "@/hooks/useHasPermission";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { PageHeader } from "@/layout/content/PageHeader";
import { EntityType } from "@/services/types";
import { User } from "@/types/user.types";

import { CreateUserFormDialog } from "./CreateUserFormDialog";
import { EditUserFormDialog } from "./EditUserFormDialog";

const REQUIRED_PLAN: PaidPlan = "pro";
const openPricing = () => {
  window.open(
    "https://hexabot.ai/pricing/#pricing",
    "_blank",
    "noopener,noreferrer",
  );
};
const UsersLockedView = () => {
  const { t } = useTranslate();
  const router = useAppRouter();

  return (
    <Stack gap={3}>
      <PageHeader icon={UsersIcon} title={t("title.users")} />
      <Paper variant="spaced">
        <Stack spacing={2.5} sx={{ maxWidth: 760 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {t("message.user_management_locked_title")}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {t("message.user_management_locked_description")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("message.user_management_locked_hint")}
          </Typography>
          <Stack
            direction="row"
            spacing={1.25}
            sx={{ flexWrap: "wrap", alignItems: "center" }}
          >
            <LicenseGate requiredPlan={REQUIRED_PLAN} onUpgrade={openPricing}>
              <Button variant="outlined">
                {t("button.manage_users")}
                <LockedFeatureLabel requiredPlan={REQUIRED_PLAN} />
              </Button>
            </LicenseGate>
            <Button
              variant="outlined"
              onClick={() => router.push("/settings/groups/global_settings")}
            >
              {t("button.enter_license_key")}
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
};
const UsersDataGrid = () => {
  const { ssoEnabled } = useConfig();
  const { t } = useTranslate();
  const { toast } = useToast();
  const dialogs = useDialogs();
  const { user } = useAuth();
  const timestampColumns = useTimestampColumns<User>();
  const usersQuota = getLicenseQuotaResource(user?.license, "users");
  const usersQuotaReached = isLicenseQuotaReached(user?.license, "users");
  const usersUpgradeTargetPlan = usersQuotaReached
    ? getQuotaUpgradeTargetPlan(user?.license, "users")
    : null;
  const usersQuotaUsage = t("label.users_quota_usage", {
    0: formatLicenseQuotaUsage(usersQuota, t("label.unlimited")),
  });
  const openCreateUserDialog = () => {
    dialogs.open(CreateUserFormDialog, {
      defaultValues: null,
    });
  };
  const addUserButton =
    usersQuotaReached && usersUpgradeTargetPlan ? (
      <LicenseGate
        requiredPlan={usersUpgradeTargetPlan}
        reasonText={t("message.users_quota_reached")}
        onUpgrade={openPricing}
        disableChildWhenBlocked={false}
      >
        <Button
          variant="contained"
          size="small"
          startIcon={<UserPlus />}
          onClick={openCreateUserDialog}
        >
          {t("button.add")}
        </Button>
      </LicenseGate>
    ) : undefined;
  const { mutate: updateUser } = useUpdate(EntityType.USER, {
    onError: (error) => {
      toast.error(error);
    },
    onSuccess() {
      toast.success(t("message.success_save"));
    },
  });
  const hasPermission = useHasPermission();
  const { data: roles } = useFind(
    {
      entity: EntityType.ROLE,
    },
    { hasCount: false },
  );
  const actionColumns = useActionColumns<User>(
    EntityType.USER,
    [
      {
        action: ColumnActionType.Manage_Roles,
        onClick: (row) => {
          dialogs.open(EditUserFormDialog, {
            defaultValues: row,
            presetValues: roles,
          });
        },
        requires: [Action.CREATE],
      },
    ],
    t("label.operations"),
  );
  const columns: GridColDef<User>[] = [
    { field: "id", headerName: "ID" },
    {
      maxWidth: 64,
      field: "picture",
      headerName: "",
      sortable: false,
      resizable: false,
      disableColumnMenu: true,
      renderCell: ({ row }) => <Avatar subscriberId={row.id} size={36} />,
    },
    {
      flex: 1,
      field: "fullName",
      headerName: t("label.name"),
      sortable: false,
      disableColumnMenu: true,
      headerAlign: "left",
    },
    {
      flex: 1,
      field: "email",
      headerName: t("label.email"),
      disableColumnMenu: true,
      headerAlign: "left",
    },
    {
      flex: 1,
      field: "roles",
      headerName: t("label.roles"),
      sortable: false,
      disableColumnMenu: true,
      renderCell: ({ row }) =>
        row.roles.map((role) => (
          <ChipEntity
            id={role}
            key={role}
            field="name"
            entity={EntityType.ROLE}
          />
        )),
      headerAlign: "left",
    },
    {
      maxWidth: 120,
      field: "state",
      headerName: t("label.status"),
      disableColumnMenu: true,
      headerAlign: "left",
      renderCell: (params) => (
        <Switch
          checked={params.value}
          color="primary"
          slotProps={{ input: { "aria-label": "primary checkbox" } }}
          disabled={
            params.row.id === user?.id ||
            ssoEnabled ||
            !hasPermission(EntityType.USER, Action.UPDATE)
          }
          onChange={() =>
            updateUser({
              id: params.row.id,
              params: {
                state: !params.row.state,
              },
            })
          }
        />
      ),
    },
    ...timestampColumns,
    ...(!ssoEnabled ? [actionColumns] : []),
  ];

  return (
    <GenericDataGrid
      entity={EntityType.USER}
      buttons={[
        {
          permissionAction: Action.CREATE,
          ...(addUserButton
            ? {
                children: addUserButton,
              }
            : {
                children: t("button.add"),
                startIcon: <UserPlus />,
                disabled: usersQuotaReached,
                title: usersQuotaReached
                  ? t("message.users_quota_reached")
                  : undefined,
                onClick: openCreateUserDialog,
              }),
        },
      ]}
      columns={columns}
      headerIcon={UsersIcon}
      searchParams={{
        $or: ["firstName", "lastName", "email"],
        syncUrl: true,
      }}
      headerI18nTitle="title.users"
      headerTitleChip={usersQuotaUsage}
    />
  );
};

export const Users = () => {
  const { user } = useAuth();
  const isAllowed = hasLicensePlanAccess(user?.license, REQUIRED_PLAN);

  return isAllowed ? <UsersDataGrid /> : <UsersLockedView />;
};
