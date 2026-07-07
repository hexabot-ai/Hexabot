/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  BaseSettingsSchema,
  DEFAULT_RETRY_SETTINGS,
  DEFAULT_TIMEOUT_MS,
  FlowStep,
  JsonValue,
  Settings,
  TaskDefinition,
  Workflow as WorkflowHelper,
  mergeSettings,
  type WorkflowDefinition,
} from "@hexabot-ai/agentic";
import type { FlowStepPath } from "@hexabot-ai/graph";
import { useEffect, useMemo, useState } from "react";

import {
  getSchemaDefaults,
  hasSchemaProperties,
} from "@/app-components/inputs/JsonSchemaForm";
import { useWorkflowActionsCatalog } from "@/contexts/workflow-actions.context";
import { useTranslate } from "@/hooks/useTranslate";
import type { IAction } from "@/types/action.types";

import { useWorkflow } from "../../../../hooks/useWorkflow";
import { useSelectedActionNode } from "../../../../hooks/useWorkflowSelection";
import { createBaseDefinition } from "../../../../utils/workflow-definition.utils";
import { useStepDrawerClose } from "../../StepDrawer/withStepDrawerLayout";

import type { ActionFormDrawerFooterProps } from "./ActionFormDrawerFooter";
import type { ActionFormDrawerHeaderProps } from "./ActionFormDrawerHeader";
import { useTaskIdentityController } from "./useTaskIdentityController";

type UseActionFormDrawerControllerResult = {
  actionSchema?: IAction;
  executionSettingsData: Record<string, unknown>;
  emptyStateLabel: string;
  footerProps: ActionFormDrawerFooterProps;
  headerProps: ActionFormDrawerHeaderProps;
  inputData: Record<string, unknown>;
  isUsingWorkflowExecutionDefaults: boolean;
  onExecutionSettingsDataChange: (data: Record<string, unknown>) => void;
  onExecutionSettingsModeChange: (useWorkflowDefaults: boolean) => void;
  onExecutionSettingsVisibleErrorsChange: (hasVisibleErrors: boolean) => void;
  onInputDataChange: (data: Record<string, unknown>) => void;
  onInputVisibleErrorsChange: (hasVisibleErrors: boolean) => void;
  onActionSettingsDataChange: (data: Record<string, unknown>) => void;
  onActionSettingsVisibleErrorsChange: (hasVisibleErrors: boolean) => void;
  onClose: () => void;
  open: boolean;
  panelKeyBase: string;
  actionSettingsData: Record<string, unknown>;
};

export type ActionFormDrawerCloseReason = "save" | "cancel";

export type ActionFormDrawerCreateTarget = {
  action: IAction;
  insertPath: FlowStepPath | null;
  initialTaskName: string;
  initialTaskDescription?: string;
};

type UseActionFormDrawerControllerParams = {
  target: ActionFormDrawerCreateTarget | null;
  onClose?: (reason: ActionFormDrawerCloseReason) => void;
};

type SplitTaskSettingsResult = {
  actionSettings: Record<string, JsonValue>;
  executionSettings: Partial<Settings>;
  hasExecutionOverride: boolean;
};

const EXECUTION_SETTING_KEYS = new Set(Object.keys(BaseSettingsSchema.shape));
const DEFAULT_WORKFLOW_EXECUTION_SETTINGS: Partial<Settings> = {
  timeout_ms: DEFAULT_TIMEOUT_MS,
  retries: { ...DEFAULT_RETRY_SETTINGS },
};
const splitTaskSettings = (
  settings: Record<string, unknown> | undefined,
): SplitTaskSettingsResult => {
  const actionSettings: Record<string, JsonValue> = {};
  const executionSettings: Partial<Settings> = {};

  if (!settings) {
    return {
      actionSettings,
      executionSettings,
      hasExecutionOverride: false,
    };
  }

  for (const [key, value] of Object.entries(settings)) {
    if (EXECUTION_SETTING_KEYS.has(key)) {
      executionSettings[key as keyof Settings] = value as JsonValue;
      continue;
    }

    actionSettings[key] = value as JsonValue;
  }

  return {
    actionSettings,
    executionSettings,
    hasExecutionOverride: Object.keys(executionSettings).length > 0,
  };
};

export const useActionFormDrawerController = ({
  target,
  onClose,
}: UseActionFormDrawerControllerParams): UseActionFormDrawerControllerResult => {
  const { t } = useTranslate();
  const {
    workflow,
    definition,
    updateDefinitionState,
    isSaving,
    taskDefinitions,
  } = useWorkflow();
  const { actionsByName } = useWorkflowActionsCatalog();
  const selectedActionNode = useSelectedActionNode();
  const selectedNodeId = selectedActionNode?.id;
  const isCreateMode = Boolean(target);
  const actionName = target?.action.name ?? selectedActionNode?.actionName;
  const taskName = target?.initialTaskName ?? selectedActionNode?.taskName;
  const actionSchema =
    target?.action ?? (actionName ? actionsByName.get(actionName) : undefined);
  const taskDefinition =
    !isCreateMode && taskName ? taskDefinitions[taskName] : undefined;
  const [inputData, setInputData] = useState<Record<string, unknown>>({});
  const [actionSettingsData, setActionSettingsData] = useState<
    Record<string, unknown>
  >({});
  const [executionSettingsData, setExecutionSettingsData] = useState<
    Record<string, unknown>
  >({});
  const [
    isUsingWorkflowExecutionDefaults,
    setIsUsingWorkflowExecutionDefaults,
  ] = useState(true);
  const [hasInputVisibleErrors, setHasInputVisibleErrors] = useState(false);
  const [hasActionSettingsVisibleErrors, setHasActionSettingsVisibleErrors] =
    useState(false);
  const [
    hasExecutionSettingsVisibleErrors,
    setHasExecutionSettingsVisibleErrors,
  ] = useState(false);
  const open = Boolean(target || (selectedActionNode && selectedNodeId));
  const panelKeyBase = target
    ? `action-create-${target.initialTaskName}-${target.action.name}`
    : (selectedNodeId ?? actionName ?? "action");
  const hasInputSchema = useMemo(
    () => hasSchemaProperties(actionSchema?.inputSchema),
    [actionSchema?.inputSchema],
  );
  const hasActionSettingsSchema = useMemo(
    () => hasSchemaProperties(actionSchema?.settingSchema),
    [actionSchema?.settingSchema],
  );
  const workflowExecutionSettingsDefaults = useMemo<Partial<Settings>>(() => {
    const { executionSettings } = splitTaskSettings(
      definition?.defaults?.settings as Record<string, unknown> | undefined,
    );

    return mergeSettings(
      DEFAULT_WORKFLOW_EXECUTION_SETTINGS,
      executionSettings,
    ) as Partial<Settings>;
  }, [definition?.defaults?.settings]);
  const {
    taskNameValue,
    taskDescriptionValue,
    normalizedTaskName,
    taskNameValidationError,
    handleTaskNameCommit,
    handleTaskNameCancel,
    handleDescriptionCommit,
    handleDescriptionCancel,
  } = useTaskIdentityController({
    open,
    actionName,
    taskName,
    taskDescription:
      target?.initialTaskDescription ?? taskDefinition?.description,
    tasks: taskDefinitions,
  });
  const handleSaveClose = useStepDrawerClose(() => {
    onClose?.("save");
  });

  useEffect(() => {
    if (!open) {
      setInputData({});
      setActionSettingsData({});
      setExecutionSettingsData({});

      return;
    }

    if (isCreateMode && target) {
      const inputDefaults = (getSchemaDefaults<Record<string, JsonValue>>(
        target.action.inputSchema,
      ) ?? {}) as Record<string, unknown>;
      const { actionSettings, executionSettings, hasExecutionOverride } =
        splitTaskSettings(
          getSchemaDefaults<Record<string, JsonValue>>(
            target.action.settingSchema,
          ) as Record<string, unknown> | undefined,
        );
      const resolvedExecutionSettings = hasExecutionOverride
        ? (mergeSettings(
            workflowExecutionSettingsDefaults,
            executionSettings,
          ) as Record<string, unknown>)
        : (workflowExecutionSettingsDefaults as Record<string, unknown>);

      setInputData(inputDefaults);
      setActionSettingsData(actionSettings);
      setExecutionSettingsData(resolvedExecutionSettings);
      setIsUsingWorkflowExecutionDefaults(!hasExecutionOverride);
      setHasExecutionSettingsVisibleErrors(false);

      return;
    }

    if (!taskDefinition) {
      setInputData({});
      setActionSettingsData({});
      setExecutionSettingsData({});

      return;
    }

    const { actionSettings, executionSettings, hasExecutionOverride } =
      splitTaskSettings(
        taskDefinition?.settings as Record<string, unknown> | undefined,
      );
    const resolvedExecutionSettings = hasExecutionOverride
      ? (mergeSettings(
          workflowExecutionSettingsDefaults,
          executionSettings,
        ) as Record<string, unknown>)
      : (workflowExecutionSettingsDefaults as Record<string, unknown>);

    setInputData((taskDefinition?.inputs as Record<string, unknown>) ?? {});
    setActionSettingsData(actionSettings);
    setExecutionSettingsData(resolvedExecutionSettings);
    setIsUsingWorkflowExecutionDefaults(!hasExecutionOverride);
    setHasExecutionSettingsVisibleErrors(false);
    // Hydrate only when opening the drawer or selecting a different node.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreateMode, open, target]);

  useEffect(() => {
    if (open) {
      return;
    }

    setHasInputVisibleErrors(false);
    setHasActionSettingsVisibleErrors(false);
    setHasExecutionSettingsVisibleErrors(false);
  }, [open]);

  useEffect(() => {
    if (!hasInputSchema) {
      setHasInputVisibleErrors(false);
    }
  }, [hasInputSchema]);

  useEffect(() => {
    if (!hasActionSettingsSchema) {
      setHasActionSettingsVisibleErrors(false);
    }
  }, [hasActionSettingsSchema]);

  useEffect(() => {
    if (isUsingWorkflowExecutionDefaults) {
      setHasExecutionSettingsVisibleErrors(false);
    }
  }, [isUsingWorkflowExecutionDefaults]);

  const handleExecutionSettingsModeChange = (useWorkflowDefaults: boolean) => {
    setIsUsingWorkflowExecutionDefaults(useWorkflowDefaults);
    if (useWorkflowDefaults) {
      return;
    }

    setExecutionSettingsData((current) => {
      if (Object.keys(current).length > 0) {
        return current;
      }

      return workflowExecutionSettingsDefaults as Record<string, unknown>;
    });
  };
  const handleExecutionSettingsVisibleErrorsChange = (
    hasVisibleErrors: boolean,
  ) => {
    setHasExecutionSettingsVisibleErrors(
      isUsingWorkflowExecutionDefaults ? false : hasVisibleErrors,
    );
  };
  const handleSave = () => {
    const currentDefinition =
      definition ?? (isCreateMode && workflow ? createBaseDefinition() : null);

    if (!currentDefinition || !taskName || !actionSchema) {
      return;
    }

    if (
      hasInputVisibleErrors ||
      hasActionSettingsVisibleErrors ||
      hasExecutionSettingsVisibleErrors
    ) {
      return;
    }

    const nextTaskName = normalizedTaskName;

    if (!nextTaskName || taskNameValidationError) {
      return;
    }

    const normalizedDescription = taskDescriptionValue.trim();
    const hasInputValues = Object.keys(inputData).length > 0;
    const nextSettingsData: Record<string, JsonValue> = {
      ...(actionSettingsData as Record<string, JsonValue>),
      ...(isUsingWorkflowExecutionDefaults
        ? {}
        : (executionSettingsData as Record<string, JsonValue>)),
    };
    const hasSettingValues = Object.keys(nextSettingsData).length > 0;

    if (isCreateMode && target) {
      if (Object.prototype.hasOwnProperty.call(taskDefinitions, nextTaskName)) {
        return;
      }

      const nextTask: TaskDefinition = {
        kind: "task",
        action: actionSchema.name,
        ...(normalizedDescription
          ? { description: normalizedDescription }
          : {}),
        ...(hasInputValues
          ? { inputs: inputData as Record<string, JsonValue> }
          : {}),
        ...(hasSettingValues
          ? { settings: nextSettingsData as TaskDefinition["settings"] }
          : {}),
      };
      const nextStep: FlowStep = { do: nextTaskName };
      const definitionWithTask: WorkflowDefinition = {
        ...currentDefinition,
        defs: {
          ...(currentDefinition.defs ?? {}),
          [nextTaskName]: nextTask,
        },
        outputs:
          currentDefinition.outputs &&
          Object.keys(currentDefinition.outputs).length > 0
            ? currentDefinition.outputs
            : { result: `=$output.${nextTaskName}` },
      };
      const insertedDefinition = target.insertPath
        ? WorkflowHelper.insertStepAtPath(
            definitionWithTask,
            target.insertPath,
            nextStep,
          )
        : null;
      const nextDefinition: WorkflowDefinition = insertedDefinition ?? {
        ...definitionWithTask,
        flow: [...(currentDefinition.flow ?? []), nextStep],
      };

      updateDefinitionState(nextDefinition);
      handleSaveClose();

      return;
    }

    if (
      nextTaskName !== taskName &&
      Object.prototype.hasOwnProperty.call(taskDefinitions, nextTaskName)
    ) {
      return;
    }

    const currentTask = taskName ? taskDefinitions[taskName] : undefined;

    if (!currentTask) {
      return;
    }

    const shouldIncludeInputs =
      hasInputValues || currentTask.inputs !== undefined;
    const shouldIncludeSettings =
      hasSettingValues || currentTask.settings !== undefined;
    const nextTask: TaskDefinition = {
      ...currentTask,
      ...(normalizedDescription ? { description: normalizedDescription } : {}),
      ...(shouldIncludeInputs
        ? { inputs: inputData as Record<string, JsonValue> }
        : {}),
      ...(shouldIncludeSettings
        ? { settings: nextSettingsData as TaskDefinition["settings"] }
        : {}),
    };
    let nextDefinition: WorkflowDefinition = {
      ...currentDefinition,
      defs: {
        ...(currentDefinition.defs ?? {}),
        [taskName]: nextTask,
      },
    };

    if (!normalizedDescription) {
      const nextTaskDefinition = nextDefinition.defs[taskName];

      if (nextTaskDefinition?.kind === "task") {
        delete nextTaskDefinition.description;
      }
    }

    if (nextTaskName !== taskName) {
      nextDefinition = WorkflowHelper.safeRenameTaskInDefinition(
        nextDefinition,
        taskName,
        nextTaskName,
      );
    }

    updateDefinitionState(nextDefinition);
    handleSaveClose();
  };
  const canSaveDefinition = Boolean(definition || (isCreateMode && workflow));
  const saveDisabled =
    hasInputVisibleErrors ||
    hasActionSettingsVisibleErrors ||
    hasExecutionSettingsVisibleErrors ||
    !canSaveDefinition ||
    !taskName ||
    !actionSchema ||
    isSaving ||
    Boolean(taskNameValidationError) ||
    (isCreateMode
      ? !target ||
        !normalizedTaskName ||
        Object.prototype.hasOwnProperty.call(
          taskDefinitions,
          normalizedTaskName,
        )
      : !selectedActionNode || !taskDefinition);

  return {
    actionSchema,
    executionSettingsData,
    emptyStateLabel: actionName
      ? t("visual_editor.actions_drawer.form.empty_state.no_schema")
      : t("visual_editor.actions_drawer.form.empty_state.no_action"),
    footerProps: {
      saveDisabled,
      onSave: handleSave,
    },
    headerProps: {
      taskNameValue,
      taskNameValidationError,
      taskDescriptionValue,
      taskName,
      isSaving,
      onTaskNameCommit: handleTaskNameCommit,
      onTaskNameCancel: handleTaskNameCancel,
      onDescriptionCommit: handleDescriptionCommit,
      onDescriptionCancel: handleDescriptionCancel,
    },
    inputData,
    isUsingWorkflowExecutionDefaults,
    onExecutionSettingsDataChange: setExecutionSettingsData,
    onExecutionSettingsModeChange: handleExecutionSettingsModeChange,
    onExecutionSettingsVisibleErrorsChange:
      handleExecutionSettingsVisibleErrorsChange,
    onInputDataChange: setInputData,
    onInputVisibleErrorsChange: setHasInputVisibleErrors,
    onActionSettingsDataChange: setActionSettingsData,
    onActionSettingsVisibleErrorsChange: setHasActionSettingsVisibleErrors,
    onClose: () => {
      onClose?.("cancel");
    },
    open,
    panelKeyBase,
    actionSettingsData,
  };
};
