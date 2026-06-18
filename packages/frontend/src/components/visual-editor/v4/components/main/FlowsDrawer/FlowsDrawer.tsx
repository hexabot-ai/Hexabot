/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Workflow } from "@hexabot-ai/types";
import { WorkflowType } from "@hexabot-ai/types";
import {
  Box,
  Button,
  Divider,
  IconButton,
  Tooltip,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { Plus, Upload } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { ConfirmDialogBody } from "@/app-components/dialogs";
import {
  formatLicenseQuotaUsage,
  getLicenseQuotaResource,
  getQuotaUpgradeTargetPlan,
  isLicenseQuotaReached,
} from "@/components/license/license-quotas";
import LicenseGate from "@/components/license/LicenseGate";
import {
  WORKFLOW_TYPES,
  WORKFLOW_TYPE_ORDER,
} from "@/constants/workflow.constants";
import { useDelete } from "@/hooks/crud/useDelete";
import { useFind } from "@/hooks/crud/useFind";
import { useAuth } from "@/hooks/useAuth";
import { useCronFormatter } from "@/hooks/useCronFormatter";
import { useDialogs } from "@/hooks/useDialogs";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";

import { useWorkflow } from "../../../hooks/useWorkflow";
import { YamlEditor } from "../../yaml-editor";
import { WorkflowMenu } from "../WorkflowMenu";

import { FlowsDrawerCollapsedActions } from "./FlowsDrawerCollapsedActions";
import { FlowsDrawerHeader } from "./FlowsDrawerHeader";
import { FlowsDrawerList } from "./FlowsDrawerList";
import { FlowsDrawerSearchActions } from "./FlowsDrawerSearchActions";
import {
  DrawerBody,
  FlowDrawerResizer,
  LeftSideFlowDrawer,
  YamlEditorContainer,
} from "./styles";
import type { FlowMatch, FlowTypeGroup, FlowsDrawerProps } from "./types";
import {
  fuzzyMatchIndices,
  getErrorCount,
  isDraftWorkflow,
  normalizeQuery,
} from "./utils";
import { WorkflowVersions } from "./WorkflowVersions";

export const defaultDrawerWidth = 320;
export const collapsedWidth = 64;
export const minDrawerWidth = 260;
export const maxDrawerWidth = 920;
export const drawerWidthStorageKey = "hexabot.visual_editor.drawer_width";
export const drawerIsOpenStorage = "hexabot.visual_editor.drawer_is_open";
const openPricing = () => {
  window.open(
    "https://hexabot.ai/pricing/#pricing",
    "_blank",
    "noopener,noreferrer",
  );
};
const flowActionButtonSx = { minWidth: 108 };

export const FlowsDrawer = ({
  onNew,
  onEdit,
  activeCodeDef,
  onActiveDefChange,
}: FlowsDrawerProps) => {
  const { t } = useTranslate();
  const formatCron = useCronFormatter();
  const dialogs = useDialogs();
  const { user, refetchUser } = useAuth();
  const { getLocalStorage, setLocalStorage } = useLocalStorage();
  const {
    workflows,
    selectedFlowId,
    updateWorkflowURL,
    isDefinitionDirty,
    isSaving,
    isExportingWorkflow,
    isImportingWorkflow,
    exportWorkflow,
    importWorkflowBundle,
  } = useWorkflow();
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down("lg"));
  const isSmall = useMediaQuery(theme.breakpoints.down("md"));
  const [open, setOpen] = useState(false);
  const [showYaml, setShowYaml] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [drawerWidth, setDrawerWidth] = useState(() =>
    Number(getLocalStorage(drawerWidthStorageKey, defaultDrawerWidth)),
  );
  const [query, setQuery] = useState("");
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(defaultDrawerWidth);
  const isResizingRef = useRef(false);
  const latestDrawerWidthRef = useRef(drawerWidth);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const trimmedQuery = query.trim();
  const normalizedQuery = normalizeQuery(trimmedQuery);
  const isSearching = trimmedQuery.length > 0;
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [menuFlowId, setMenuFlowId] = useState<string | null>(null);
  const [openTypeKeys, setOpenTypeKeys] = useState<string[]>([]);
  const searchParams = useMemo(
    () => ({
      where: {
        or: [
          { name: { contains: trimmedQuery } },
          { description: { contains: trimmedQuery } },
        ],
      },
    }),
    [trimmedQuery],
  );
  const { data: searchedWorkflows = [] } = useFind(
    { entity: EntityType.WORKFLOW },
    {
      hasCount: false,
      initialSortState: [{ field: "createdAt", sort: "asc" }],
      params: isSearching ? searchParams : undefined,
    },
    { enabled: isSearching },
  );
  const { mutate: deleteWorkflow } = useDelete(EntityType.WORKFLOW);
  const workflowQuota = getLicenseQuotaResource(user?.license, "workflows");
  const workflowQuotaReached = isLicenseQuotaReached(
    user?.license,
    "workflows",
  );
  const workflowUpgradeTargetPlan = workflowQuotaReached
    ? getQuotaUpgradeTargetPlan(user?.license, "workflows")
    : null;
  const shouldShowWorkflowUpgradeGate = Boolean(
    onNew && workflowQuotaReached && workflowUpgradeTargetPlan,
  );
  const newWorkflowDisabledReason = workflowQuotaReached
    ? t("message.workflows_quota_reached")
    : undefined;
  const newWorkflowLabel = t("visual_editor.flows_drawer.new_workflow");
  const importWorkflowLabel = t("visual_editor.flows_drawer.import_workflow");
  const exportWorkflowLabel = t("visual_editor.flows_drawer.export_workflow");
  const newWorkflowTooltip = workflowQuotaReached
    ? t("message.workflows_quota_reached")
    : t("label.workflows_quota_usage", {
        0: formatLicenseQuotaUsage(workflowQuota, t("label.unlimited")),
      });
  const canCreateWorkflow = Boolean(onNew) && !workflowQuotaReached;
  const workflowsList = isSearching ? searchedWorkflows : workflows;
  const minAllowedWidth = isSmall ? 240 : minDrawerWidth;
  const maxAllowedWidth = isSmall ? 280 : maxDrawerWidth;
  const collapsedSize = isSmall ? 56 : collapsedWidth;
  const clampDrawerWidth = useCallback(
    (value: number) =>
      Math.min(Math.max(value, minAllowedWidth), maxAllowedWidth),
    [maxAllowedWidth, minAllowedWidth],
  );
  const yamlToggleLabel = showYaml
    ? t("visual_editor.yaml_editor.hide")
    : t("visual_editor.yaml_editor.show");
  const versionsToggleLabel = showVersions
    ? t("visual_editor.workflow_versions.hide")
    : t("visual_editor.workflow_versions.show");

  useEffect(() => {
    if (isCompact) {
      setOpen(false);
    } else if (getLocalStorage(drawerIsOpenStorage)) {
      setOpen(true);
    }
  }, [isCompact]);

  useEffect(() => {
    latestDrawerWidthRef.current = drawerWidth;
  }, [drawerWidth]);

  useEffect(() => {
    setDrawerWidth((prev) => clampDrawerWidth(prev));
  }, [clampDrawerWidth]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleMouseMove = (event: MouseEvent) => {
      if (!isResizingRef.current) return;

      const delta = event.clientX - resizeStartXRef.current;
      const nextWidth = clampDrawerWidth(resizeStartWidthRef.current + delta);

      latestDrawerWidthRef.current = nextWidth;
      setDrawerWidth(nextWidth);
    };
    const handleMouseUp = () => {
      if (!isResizingRef.current) return;

      isResizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";

      setLocalStorage(
        drawerWidthStorageKey,
        String(latestDrawerWidthRef.current),
      );
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [clampDrawerWidth]);

  const hasUnsaved = Boolean(selectedFlowId && (isDefinitionDirty || isSaving));
  const matches = useMemo<FlowMatch[]>(() => {
    const list = workflowsList ?? [];
    const getTypeMeta = (flow: Workflow, typeKey: string) => {
      if (typeKey === WorkflowType.conversational) {
        return {
          secondaryText: flow.description?.trim() ?? "",
        };
      }

      if (typeKey === WorkflowType.scheduled) {
        const schedule = flow.schedule?.trim();

        return {
          secondaryText: schedule
            ? formatCron(schedule)
            : t("visual_editor.flows_drawer.meta.no_schedule"),
        };
      }

      if (typeKey === WorkflowType.manual) {
        return {};
      }

      return {
        secondaryText:
          flow.description?.trim() ||
          t("visual_editor.flows_drawer.meta.no_details"),
      };
    };

    return list.map((flow) => {
      const nameMatch = normalizedQuery
        ? fuzzyMatchIndices(normalizedQuery, flow.name)
        : [];
      const descriptionMatch =
        normalizedQuery && flow.description
          ? fuzzyMatchIndices(normalizedQuery, flow.description)
          : [];
      const typeInfo = WORKFLOW_TYPES[flow.type];
      const isDraft = isDraftWorkflow(flow);
      const errorCount = getErrorCount(flow);

      return {
        workflow: flow,
        nameMatch,
        descriptionMatch,
        typeInfo,
        typeMeta: getTypeMeta(flow, typeInfo.key),
        statusLabel: isDraft
          ? t("visual_editor.flows_drawer.status.draft")
          : t("visual_editor.flows_drawer.status.published"),
        isDraft,
        isSelected: flow.id === selectedFlowId,
        hasUnsaved: flow.id === selectedFlowId && hasUnsaved,
        errorCount,
        errorLabel:
          errorCount > 0
            ? t("visual_editor.flows_drawer.errors", { 0: errorCount })
            : undefined,
      };
    });
  }, [hasUnsaved, normalizedQuery, selectedFlowId, t, workflowsList]);
  const selectedFlowTypeKey = useMemo(() => {
    if (!workflows || !selectedFlowId) return null;

    const selectedFlow = workflows.find((flow) => flow.id === selectedFlowId);

    return selectedFlow ? WORKFLOW_TYPES[selectedFlow.type].key : null;
  }, [selectedFlowId, workflows]);
  const typeGroups = useMemo<FlowTypeGroup[]>(() => {
    const grouped = new Map<string, FlowTypeGroup>();

    Object.values(WORKFLOW_TYPES).forEach((info) => {
      grouped.set(info.key, { info, label: t(info.labelKey), items: [] });
    });

    matches.forEach((match) => {
      const key = match.typeInfo.key;

      if (!grouped.has(key)) {
        grouped.set(key, {
          info: match.typeInfo,
          label: t(match.typeInfo.labelKey),
          items: [],
        });
      }
      grouped.get(key)?.items.push(match);
    });

    const sorted = Array.from(grouped.values()).sort((a, b) => {
      const orderA = WORKFLOW_TYPE_ORDER[a.info.key as WorkflowType] ?? 99;
      const orderB = WORKFLOW_TYPE_ORDER[b.info.key as WorkflowType] ?? 99;

      if (orderA !== orderB) return orderA - orderB;

      return a.label.localeCompare(b.label);
    });

    sorted.forEach((group) => {
      group.items.sort((a, b) =>
        a.workflow.name.localeCompare(b.workflow.name),
      );
    });

    return sorted;
  }, [matches, t]);

  useEffect(() => {
    if (!typeGroups.length) {
      setOpenTypeKeys((prev) => (prev.length ? [] : prev));

      return;
    }

    setOpenTypeKeys((prev) => {
      const groupsByKey = new Map(
        typeGroups.map((group) => [group.info.key, group]),
      );
      const next = prev.filter((key) => groupsByKey.has(key));
      const openSet = new Set(next);
      const firstGroupWithItems = typeGroups.find(
        (group) => group.items.length > 0,
      )?.info.key;
      const fallbackKey = firstGroupWithItems ?? typeGroups[0]?.info.key;

      if (isSearching) {
        const hasOpenWithItems = next.some(
          (key) => (groupsByKey.get(key)?.items.length ?? 0) > 0,
        );

        if (!hasOpenWithItems && fallbackKey) {
          openSet.add(fallbackKey);
        }
      } else if (selectedFlowTypeKey) {
        if (groupsByKey.has(selectedFlowTypeKey)) {
          openSet.add(selectedFlowTypeKey);
        }
      } else if (!openSet.size && fallbackKey) {
        openSet.add(fallbackKey);
      }

      const nextKeys = Array.from(openSet);

      if (
        nextKeys.length === prev.length &&
        nextKeys.every((key, index) => key === prev[index])
      ) {
        return prev;
      }

      return nextKeys;
    });
  }, [isSearching, selectedFlowTypeKey, typeGroups]);

  const handleToggleDrawer = () => {
    setOpen((prev) => {
      setLocalStorage(drawerIsOpenStorage, !prev ? "true" : "");
      if (prev) onActiveDefChange?.(); // drawer closing — deactivate button

      return !prev;
    });
  };
  const handleResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!open) return;

      isResizingRef.current = true;
      resizeStartXRef.current = event.clientX;
      resizeStartWidthRef.current = drawerWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      event.preventDefault();
    },
    [drawerWidth, open],
  );
  const handleToggleYaml = () => {
    setShowYaml((prev) => {
      if (prev) onActiveDefChange?.(); // switching away from YAML — deactivate button

      return !prev;
    });
    setShowVersions(false);
    if (!open) {
      setOpen(true);
    }
  };
  const handleToggleVersions = () => {
    setShowVersions((prev) => !prev);
    setShowYaml(false);
    onActiveDefChange?.(); // switching to versions view — deactivate button
    if (!open) {
      setOpen(true);
    }
  };
  const handleOpenDrawer = () => {
    setShowYaml(false);
    setShowVersions(false);
    onActiveDefChange?.(); // switching to flows list — deactivate button
    setOpen(true);
  };

  // React to externally controlled activeCodeDef
  useEffect(() => {
    if (!activeCodeDef) return;

    setShowVersions(false);
    setOpen((prevOpen) => {
      if (!prevOpen) {
        setLocalStorage(drawerIsOpenStorage, "true");
      }

      return true;
    });
    setShowYaml(true);
    // highlight/reveal handled entirely via the highlightDef prop on YamlEditor
  }, [activeCodeDef]);
  const handleToggleType = (key: string) =>
    setOpenTypeKeys((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
    );
  const handleSelectFlow = (flowId: string) => {
    if (flowId !== selectedFlowId) {
      updateWorkflowURL(flowId);
    }
  };
  const handleOpenMenu = (
    event: ReactMouseEvent<HTMLElement>,
    flowId: string,
  ) => {
    event.stopPropagation();
    setMenuAnchorEl(event.currentTarget);
    setMenuFlowId(flowId);
  };
  const handleCloseMenu = () => {
    setMenuAnchorEl(null);
    setMenuFlowId(null);
  };
  const handleOpenImportPicker = () => {
    importInputRef.current?.click();
  };
  const handleImportFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    event.target.value = "";
    if (file) {
      importWorkflowBundle(file);
    }
  };
  const selectedMenuFlow = menuFlowId
    ? matches.find((match) => match.workflow.id === menuFlowId)?.workflow
    : undefined;
  const isSelectedMenuFlowDirty =
    selectedMenuFlow?.id === selectedFlowId && isDefinitionDirty;
  const exportDisabled =
    !selectedMenuFlow ||
    isExportingWorkflow ||
    isSaving ||
    isSelectedMenuFlowDirty;
  const handleExport = () => {
    if (!selectedMenuFlow || exportDisabled) {
      handleCloseMenu();

      return;
    }

    exportWorkflow(selectedMenuFlow.id);
    handleCloseMenu();
  };
  const handleDelete = async () => {
    if (!selectedMenuFlow) {
      handleCloseMenu();

      return;
    }

    const flowId = selectedMenuFlow.id;
    const fallbackFlowId = workflows?.find((flow) => flow.id !== flowId)?.id;

    handleCloseMenu();
    const isConfirmed = await dialogs.confirm(ConfirmDialogBody);

    if (!isConfirmed) {
      return;
    }

    deleteWorkflow(flowId, {
      onSuccess: () => {
        void refetchUser();
        if (selectedFlowId === flowId && fallbackFlowId) {
          updateWorkflowURL(fallbackFlowId);
        }
      },
    });
  };

  return (
    <LeftSideFlowDrawer
      variant="permanent"
      open={open}
      anchor="left"
      drawerWidth={drawerWidth}
      collapsedWidth={collapsedSize}
    >
      <input
        ref={importInputRef}
        type="file"
        accept=".workflow.yml,.yml,.yaml,application/x-yaml,text/yaml,text/plain"
        hidden
        onChange={handleImportFileChange}
      />
      <FlowsDrawerHeader
        open={open}
        title={t("visual_editor.flows_drawer.title")}
        onToggle={handleToggleDrawer}
        yamlLabel={yamlToggleLabel}
        onToggleYaml={handleToggleYaml}
        isYamlOpen={showYaml}
        versionsLabel={versionsToggleLabel}
        onToggleVersions={handleToggleVersions}
        isVersionsOpen={showVersions}
      />
      {open ? (
        <DrawerBody>
          {showYaml ? (
            <>
              <Divider />
              <YamlEditorContainer>
                <YamlEditor
                  onHighlightClear={onActiveDefChange}
                  highlightDef={activeCodeDef ?? undefined}
                />
              </YamlEditorContainer>
            </>
          ) : showVersions ? (
            <>
              <Divider />
              <WorkflowVersions />
            </>
          ) : (
            <>
              <FlowsDrawerSearchActions
                query={query}
                searchPlaceholder={t(
                  "visual_editor.flows_drawer.search_placeholder",
                )}
                searchLabel={t("visual_editor.flows_drawer.search_workflows")}
                onQueryChange={setQuery}
              />
              <Divider />
              <FlowsDrawerList
                typeGroups={typeGroups}
                openTypeKeys={openTypeKeys}
                onToggleType={handleToggleType}
                onSelectFlow={handleSelectFlow}
                onEdit={onEdit}
                onOpenMenu={handleOpenMenu}
                normalizedQuery={normalizedQuery}
                emptySectionLabel={t(
                  "visual_editor.flows_drawer.empty.section",
                )}
                emptyState={
                  !matches.length && workflows && workflows.length
                    ? t("visual_editor.flows_drawer.empty.search")
                    : t("visual_editor.flows_drawer.empty.list")
                }
                hasMatches={matches.length > 0}
                renameLabel={t("button.rename")}
                moreLabel={t("button.more")}
              />
              <Divider />
              <Box
                px={2}
                pb={2}
                pt={1}
                display="flex"
                justifyContent="center"
                gap={1}
                flexWrap="wrap"
              >
                <Button
                  variant="outlined"
                  size="medium"
                  startIcon={<Upload size={18} />}
                  onClick={handleOpenImportPicker}
                  disabled={isImportingWorkflow}
                  sx={flowActionButtonSx}
                >
                  {importWorkflowLabel}
                </Button>
                {shouldShowWorkflowUpgradeGate && workflowUpgradeTargetPlan ? (
                  <LicenseGate
                    requiredPlan={workflowUpgradeTargetPlan}
                    reasonText={t("message.workflows_quota_reached")}
                    onUpgrade={openPricing}
                    disableChildWhenBlocked={false}
                  >
                    <Button
                      variant="contained"
                      size="medium"
                      startIcon={<Plus size={18} />}
                      onClick={onNew}
                      sx={flowActionButtonSx}
                    >
                      {newWorkflowLabel}
                    </Button>
                  </LicenseGate>
                ) : (
                  <Tooltip
                    title={newWorkflowTooltip}
                    disableHoverListener={!newWorkflowTooltip}
                  >
                    <span>
                      <Button
                        variant="contained"
                        size="medium"
                        startIcon={<Plus size={18} />}
                        onClick={onNew}
                        disabled={!canCreateWorkflow}
                        sx={flowActionButtonSx}
                      >
                        {newWorkflowLabel}
                      </Button>
                    </span>
                  </Tooltip>
                )}
              </Box>
            </>
          )}
        </DrawerBody>
      ) : (
        <FlowsDrawerCollapsedActions
          searchLabel={t("visual_editor.flows_drawer.search_workflows")}
          importWorkflowLabel={importWorkflowLabel}
          importWorkflowDisabled={isImportingWorkflow}
          newWorkflowLabel={newWorkflowLabel}
          newWorkflowDisabled={
            workflowQuotaReached && !workflowUpgradeTargetPlan
          }
          newWorkflowDisabledReason={newWorkflowDisabledReason}
          newWorkflowAction={
            shouldShowWorkflowUpgradeGate && workflowUpgradeTargetPlan ? (
              <LicenseGate
                requiredPlan={workflowUpgradeTargetPlan}
                reasonText={t("message.workflows_quota_reached")}
                onUpgrade={openPricing}
                disableChildWhenBlocked={false}
              >
                <IconButton size="small" onClick={onNew}>
                  <Plus size={16} />
                </IconButton>
              </LicenseGate>
            ) : undefined
          }
          yamlLabel={yamlToggleLabel}
          onOpen={handleOpenDrawer}
          onImport={handleOpenImportPicker}
          onNew={onNew}
          onToggleYaml={handleToggleYaml}
          isYamlOpen={showYaml}
        />
      )}
      {open && (
        <FlowDrawerResizer
          onMouseDown={handleResizeStart}
          role="separator"
          aria-orientation="vertical"
          aria-label={t("visual_editor.flows_drawer.resize")}
        />
      )}
      <WorkflowMenu
        anchorEl={menuAnchorEl}
        open={Boolean(menuAnchorEl)}
        onClose={handleCloseMenu}
        onDelete={handleDelete}
        deleteDisabled={Boolean(selectedMenuFlow?.builtin)}
        deleteLabel={t("button.delete")}
        onExport={handleExport}
        exportDisabled={exportDisabled}
        exportLabel={exportWorkflowLabel}
      />
    </LeftSideFlowDrawer>
  );
};
