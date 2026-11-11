/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

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

import {
  formatLicenseQuotaUsage,
  getLicenseQuotaResource,
  getQuotaUpgradeTargetPlan,
  isLicenseQuotaReached,
} from "@/components/license/license-quotas";
import LicenseGate from "@/components/license/LicenseGate";
import { WORKFLOW_TYPES } from "@/constants/workflow.constants";
import { useFind } from "@/hooks/crud/useFind";
import { useAuth } from "@/hooks/useAuth";
import { useCronFormatter } from "@/hooks/useCronFormatter";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";

import { useResizableDrawerSize } from "../../../../../../hooks/useResizableDrawerSize";
import { useConfirmDeleteWorkflow } from "../../../hooks/useConfirmDeleteWorkflow";
import { useWorkflow } from "../../../hooks/useWorkflow";
import { uniqueIssueMessages } from "../../../utils/workflow-issue-localization";
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
  getFlowTypeMeta,
  groupFlowMatchesByType,
  isDraftWorkflow,
  normalizeQuery,
  reconcileOpenTypeKeys,
} from "./utils";
import { WorkflowVersions } from "./WorkflowVersions";

const defaultDrawerWidth = 320;
const collapsedWidth = 64;
const minDrawerWidth = 260;
const maxDrawerWidth = 920;
const drawerWidthStorageKey = "hexabot.visual_editor.drawer_width";

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
  openYamlRequest,
}: FlowsDrawerProps) => {
  const { t } = useTranslate();
  const formatCron = useCronFormatter();
  const { user } = useAuth();
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
    definitionStatus,
    definitionIssues,
  } = useWorkflow();
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down("lg"));
  const isSmall = useMediaQuery(theme.breakpoints.down("md"));
  const minAllowedWidth = isSmall ? 240 : minDrawerWidth;
  const maxAllowedWidth = isSmall ? 280 : maxDrawerWidth;
  const collapsedSize = isSmall ? 56 : collapsedWidth;
  const { getLocalStorage, setLocalStorage } = useLocalStorage();
  const { size: drawerWidth, handleResizeStart } = useResizableDrawerSize({
    sizeStorageKey: drawerWidthStorageKey,
    defaultSize: defaultDrawerWidth,
    minSize: minAllowedWidth,
    maxSize: maxAllowedWidth,
    axis: "horizontal",
  });
  const [open, setOpen] = useState(
    () => !isCompact && Boolean(getLocalStorage(drawerIsOpenStorage)),
  );
  const [showYaml, setShowYaml] = useState(false);
  const closeYamlPanel = useCallback(() => {
    setShowYaml(false);
    onActiveDefChange?.(); // YAML view is no longer visible — deactivate button
  }, [onActiveDefChange]);

  useEffect(() => {
    if (isCompact) {
      setOpen(false);
      closeYamlPanel();
    }
  }, [isCompact, closeYamlPanel]);

  const toggleOpen = useCallback(() => {
    const next = !open;

    setLocalStorage(drawerIsOpenStorage, next ? "true" : "");
    if (!next) {
      closeYamlPanel();
    }
    setOpen(next);
  }, [open, setLocalStorage, closeYamlPanel]);
  const [showVersions, setShowVersions] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
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
  const confirmDeleteWorkflow = useConfirmDeleteWorkflow();
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
  const yamlToggleLabel = showYaml
    ? t("visual_editor.yaml_editor.hide")
    : t("visual_editor.yaml_editor.show");
  const versionsToggleLabel = showVersions
    ? t("visual_editor.workflow_versions.hide")
    : t("visual_editor.workflow_versions.show");
  const hasUnsaved = Boolean(selectedFlowId && (isDefinitionDirty || isSaving));
  // Surfaces definition problems on the YAML toggle even when the drawer is
  // closed; mirrors what the YAML editor alert and the graph panel display.
  const yamlIssueCount =
    selectedFlowId && definitionStatus === "invalid"
      ? uniqueIssueMessages(definitionIssues).length
      : 0;
  const matches = useMemo<FlowMatch[]>(() => {
    const list = workflowsList ?? [];
    const typeMetaFormatters = {
      formatCron,
      noScheduleLabel: t("visual_editor.flows_drawer.meta.no_schedule"),
      noDetailsLabel: t("visual_editor.flows_drawer.meta.no_details"),
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
        typeMeta: getFlowTypeMeta(flow, typeInfo.key, typeMetaFormatters),
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
  const typeGroups = useMemo<FlowTypeGroup[]>(
    () => groupFlowMatchesByType(matches, (info) => t(info.labelKey)),
    [matches, t],
  );

  useEffect(() => {
    setOpenTypeKeys((prev) =>
      reconcileOpenTypeKeys(prev, typeGroups, {
        isSearching,
        selectedFlowTypeKey,
      }),
    );
  }, [isSearching, selectedFlowTypeKey, typeGroups]);

  const handleToggleYaml = () => {
    if (showYaml) {
      closeYamlPanel();
    } else {
      setShowYaml(true);
    }
    setShowVersions(false);
    if (!open) setOpen(true);
  };
  const handleToggleVersions = () => {
    setShowVersions((prev) => !prev);
    closeYamlPanel();
    if (!open) {
      setOpen(true);
    }
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

  // React to external open-YAML requests (e.g. the graph error panel). The
  // requested line, when present, is revealed by the YAML editor itself.
  useEffect(() => {
    if (!openYamlRequest?.nonce) return;

    setShowVersions(false);
    setOpen((prevOpen) => {
      if (!prevOpen) {
        setLocalStorage(drawerIsOpenStorage, "true");
      }

      return true;
    });
    setShowYaml(true);
  }, [openYamlRequest?.nonce]);
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
    handleCloseMenu();

    if (selectedMenuFlow) {
      await confirmDeleteWorkflow(selectedMenuFlow.id);
    }
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
        onToggle={toggleOpen}
        yamlLabel={yamlToggleLabel}
        onToggleYaml={handleToggleYaml}
        isYamlOpen={showYaml}
        yamlIssueCount={yamlIssueCount}
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
                  highlightDef={activeCodeDef}
                  revealTarget={openYamlRequest}
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
          onOpen={() => setOpen(true)}
          onImport={handleOpenImportPicker}
          onNew={onNew}
          onToggleYaml={handleToggleYaml}
          isYamlOpen={showYaml}
          yamlIssueCount={yamlIssueCount}
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
