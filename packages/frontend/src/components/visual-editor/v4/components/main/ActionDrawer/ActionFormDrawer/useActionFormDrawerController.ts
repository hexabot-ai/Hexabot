/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { JsonValue, Settings } from "@hexabot-ai/agentic";
import type { FlowStepPath } from "@hexabot-ai/graph";
import type { RJSFSchema } from "@rjsf/utils";
import { useEffect, useMemo, useState } from "react";

import {
  getSchemaDefaults,
  hasSchemaProperties,
} from "@/app-components/inputs/JsonSchemaForm";
import { useWorkflowActionsCatalog } from "@/contexts/workflow-actions.context";
import { useTranslate } from "@/hooks/useTranslate";
import type { IAction } from "@/types/action.types";
import validator from "@/utils/rjsf-zod-validator";

import { useWorkflow } from "../../../../hooks/useWorkflow";
import { useSelectedActionNode } from "../../../../hooks/useWorkflowSelection";
import { isDefinitionNameAvailable } from "../../../../utils/definition-name.utils";
import { createBaseDefinition } from "../../../../utils/workflow-definition.utils";
import { useStepDrawerClose } from "../../StepDrawer/withStepDrawerLayout";

import {
  applyTaskEdits,
  buildNewTask,
  getTaskSettingsFormState,
  getWorkflowExecutionDefaults,
  type TaskFormValues,
} from "./action-form-drawer.utils";
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
  validateActionSchemas: boolean;
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
  onBack?: () => void;
};

const hasSchemaValidationErrors = (
  schema: unknown,
  data: Record<string, unknown>,
): boolean => {
  return (
    Boolean(schema) &&
    !validator.isValid(schema as RJSFSchema, data, schema as RJSFSchema)
  );
};

export const useActionFormDrawerController = ({
  target,
  onClose,
  onBack,
}: UseActionFormDrawerControllerParams): UseActionFormDrawerControllerResult => {
  const { t } = useTranslate();
  const {
    workflow,
    definition,
    addActionStep,
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
  const [validateActionSchemas, setValidateActionSchemas] = useState(false);
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
  const workflowExecutionSettingsDefaults = useMemo<Partial<Settings>>(
    () =>
      getWorkflowExecutionDefaults(
        definition?.defaults?.settings as Record<string, unknown> | undefined,
      ),
    [definition?.defaults?.settings],
  );
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
    definitions: definition?.defs,
  });
  const handleSaveClose = useStepDrawerClose(() => {
    onClose?.("save");
  });

  useEffect(() => {
    const hydrate = (
      inputs: Record<string, unknown>,
      settings: Record<string, unknown> | undefined,
    ) => {
      const formState = getTaskSettingsFormState(
        settings,
        workflowExecutionSettingsDefaults,
      );

      setInputData(inputs);
      setActionSettingsData(formState.actionSettings);
      setExecutionSettingsData(formState.executionSettings);
      setIsUsingWorkflowExecutionDefaults(
        formState.usesWorkflowExecutionDefaults,
      );
      setValidateActionSchemas(false);
      setHasExecutionSettingsVisibleErrors(false);
    };

    if (open && target) {
      hydrate(
        (getSchemaDefaults<Record<string, JsonValue>>(
          target.action.inputSchema,
        ) ?? {}) as Record<string, unknown>,
        getSchemaDefaults<Record<string, JsonValue>>(
          target.action.settingSchema,
        ) as Record<string, unknown> | undefined,
      );

      return;
    }

    if (open && taskDefinition) {
      hydrate(
        (taskDefinition.inputs as Record<string, unknown>) ?? {},
        taskDefinition.settings as Record<string, unknown> | undefined,
      );

      return;
    }

    setInputData({});
    setActionSettingsData({});
    setExecutionSettingsData({});
    setValidateActionSchemas(false);
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
  const handleInputDataChange = (data: Record<string, unknown>) => {
    setValidateActionSchemas(true);
    setInputData(data);
  };
  const handleActionSettingsDataChange = (data: Record<string, unknown>) => {
    setValidateActionSchemas(true);
    setActionSettingsData(data);
  };
  const hasVisibleErrors =
    hasInputVisibleErrors ||
    hasActionSettingsVisibleErrors ||
    hasExecutionSettingsVisibleErrors;
  const hasActionDataErrors = (action: IAction) =>
    hasSchemaValidationErrors(action.inputSchema, inputData) ||
    hasSchemaValidationErrors(action.settingSchema, actionSettingsData);
  const handleSave = () => {
    const currentDefinition =
      definition ?? (isCreateMode && workflow ? createBaseDefinition() : null);

    if (!currentDefinition || !taskName || !actionSchema) {
      return;
    }

    setValidateActionSchemas(true);

    if (hasActionDataErrors(actionSchema) || hasVisibleErrors) {
      return;
    }

    const nextTaskName = normalizedTaskName;

    if (!nextTaskName || taskNameValidationError) {
      return;
    }

    const values: TaskFormValues = {
      description: taskDescriptionValue.trim(),
      inputs: inputData,
      settings: {
        ...actionSettingsData,
        ...(isUsingWorkflowExecutionDefaults ? {} : executionSettingsData),
      },
    };

    if (isCreateMode && target) {
      if (!isDefinitionNameAvailable(nextTaskName, currentDefinition.defs)) {
        return;
      }

      addActionStep(
        nextTaskName,
        buildNewTask(actionSchema.name, values),
        target.insertPath,
      );
      handleSaveClose();

      return;
    }

    const currentTask = taskDefinitions[taskName];

    if (
      !isDefinitionNameAvailable(
        nextTaskName,
        currentDefinition.defs,
        taskName,
      ) ||
      !currentTask
    ) {
      return;
    }

    updateDefinitionState(
      applyTaskEdits(
        currentDefinition,
        taskName,
        nextTaskName,
        currentTask,
        values,
      ),
    );
    handleSaveClose();
  };
  const canSaveDefinition = Boolean(definition || (isCreateMode && workflow));
  const saveDisabled =
    (actionSchema && validateActionSchemas
      ? hasActionDataErrors(actionSchema)
      : false) ||
    hasVisibleErrors ||
    !canSaveDefinition ||
    !taskName ||
    !actionSchema ||
    isSaving ||
    Boolean(taskNameValidationError) ||
    (isCreateMode
      ? !target ||
        !normalizedTaskName ||
        !isDefinitionNameAvailable(normalizedTaskName, definition?.defs)
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
      onBack,
    },
    inputData,
    isUsingWorkflowExecutionDefaults,
    validateActionSchemas,
    onExecutionSettingsDataChange: setExecutionSettingsData,
    onExecutionSettingsModeChange: handleExecutionSettingsModeChange,
    onExecutionSettingsVisibleErrorsChange:
      handleExecutionSettingsVisibleErrorsChange,
    onInputDataChange: handleInputDataChange,
    onInputVisibleErrorsChange: setHasInputVisibleErrors,
    onActionSettingsDataChange: handleActionSettingsDataChange,
    onActionSettingsVisibleErrorsChange: setHasActionSettingsVisibleErrors,
    onClose: () => {
      onClose?.("cancel");
    },
    open,
    panelKeyBase,
    actionSettingsData,
  };
};
