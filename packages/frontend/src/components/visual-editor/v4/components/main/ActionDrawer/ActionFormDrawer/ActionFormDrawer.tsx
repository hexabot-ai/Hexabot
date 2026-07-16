/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { withStepDrawerLayout } from "../../StepDrawer/withStepDrawerLayout";

import { ActionFormDrawerContent } from "./ActionFormDrawerContent";
import { ActionFormDrawerFooter } from "./ActionFormDrawerFooter";
import { ActionFormDrawerHeader } from "./ActionFormDrawerHeader";
import {
  type ActionFormDrawerCloseReason,
  type ActionFormDrawerCreateTarget,
  useActionFormDrawerController,
} from "./useActionFormDrawerController";

const ActionFormDrawerLayout = withStepDrawerLayout(ActionFormDrawerContent);

export type { ActionFormDrawerCloseReason, ActionFormDrawerCreateTarget };

type ActionFormDrawerProps = {
  target: ActionFormDrawerCreateTarget | null;
  onClose?: (reason: ActionFormDrawerCloseReason) => void;
  onBack?: () => void;
};

export const ActionFormDrawer = ({
  target,
  onClose,
  onBack,
}: ActionFormDrawerProps) => {
  const {
    open,
    actionSchema,
    inputData,
    actionSettingsData,
    executionSettingsData,
    isUsingWorkflowExecutionDefaults,
    validateActionSchemas,
    panelKeyBase,
    emptyStateLabel,
    onInputDataChange,
    onActionSettingsDataChange,
    onExecutionSettingsDataChange,
    onExecutionSettingsModeChange,
    onInputVisibleErrorsChange,
    onActionSettingsVisibleErrorsChange,
    onExecutionSettingsVisibleErrorsChange,
    headerProps,
    footerProps,
    onClose: handleClose,
  } = useActionFormDrawerController({ target, onClose, onBack });

  return (
    <ActionFormDrawerLayout
      isOpen={open}
      actionSchema={actionSchema}
      inputData={inputData}
      actionSettingsData={actionSettingsData}
      executionSettingsData={executionSettingsData}
      isUsingWorkflowExecutionDefaults={isUsingWorkflowExecutionDefaults}
      validateActionSchemas={validateActionSchemas}
      panelKeyBase={panelKeyBase}
      emptyStateLabel={emptyStateLabel}
      onInputDataChange={onInputDataChange}
      onActionSettingsDataChange={onActionSettingsDataChange}
      onExecutionSettingsDataChange={onExecutionSettingsDataChange}
      onExecutionSettingsModeChange={onExecutionSettingsModeChange}
      onInputVisibleErrorsChange={onInputVisibleErrorsChange}
      onActionSettingsVisibleErrorsChange={onActionSettingsVisibleErrorsChange}
      onExecutionSettingsVisibleErrorsChange={
        onExecutionSettingsVisibleErrorsChange
      }
      onClose={handleClose}
      open={open}
      headerContent={<ActionFormDrawerHeader {...headerProps} />}
      footerContent={<ActionFormDrawerFooter {...footerProps} />}
    />
  );
};
