/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  StepType,
  Workflow as WorkflowHelper,
  type FlowStep,
} from "@hexabot-ai/agentic";
import { Box, Typography } from "@mui/material";
import { Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { DrawerPrimaryFooterAction } from "@/app-components/drawers/DrawerPrimaryFooterAction";
import { useTranslate } from "@/hooks/useTranslate";

import { useWorkflow } from "../../../hooks/useWorkflow";
import { useSelectedOperatorStep } from "../../../hooks/useWorkflowSelection";
import { StepOptionRadioGroup } from "../StepDrawer/StepOptionRadioGroup";
import {
  useStepDrawerClose,
  withStepDrawerLayout,
} from "../StepDrawer/withStepDrawerLayout";

type ParallelStep = Extract<FlowStep, { parallel: unknown }>;
type ParallelStrategy = "wait_all" | "wait_any";
type ParallelOption = {
  description: string;
  label: string;
  value: ParallelStrategy;
};

const DEFAULT_PARALLEL_STRATEGY: ParallelStrategy = "wait_all";
const isParallelStep = (step: unknown): step is ParallelStep => {
  if (!step || typeof step !== "object" || !("parallel" in step)) {
    return false;
  }

  const parallel = (step as { parallel?: { steps?: unknown } }).parallel;

  return Boolean(parallel && Array.isArray(parallel.steps));
};
const isParallelStrategy = (value: string): value is ParallelStrategy =>
  value === "wait_all" || value === "wait_any";
const getParallelStrategyValue = (step?: ParallelStep): ParallelStrategy => {
  const strategy = step?.parallel.strategy;

  return strategy === "wait_any" ? "wait_any" : DEFAULT_PARALLEL_STRATEGY;
};

type ParallelFormDrawerContentProps = {
  isOpen: boolean;
  strategy: ParallelStrategy;
  options: ParallelOption[];
  strategyLabel: string;
  onStrategyChange: (value: ParallelStrategy) => void;
  emptyStateLabel: string;
};

const ParallelFormDrawerContent = ({
  isOpen,
  strategy,
  options,
  strategyLabel,
  onStrategyChange,
  emptyStateLabel,
}: ParallelFormDrawerContentProps) => {
  if (!isOpen) {
    return null;
  }

  if (!options.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        {emptyStateLabel}
      </Typography>
    );
  }

  return (
    <StepOptionRadioGroup
      label={strategyLabel}
      value={strategy}
      options={options}
      isOptionValue={isParallelStrategy}
      onChange={onStrategyChange}
    />
  );
};
const ParallelFormDrawerLayout = withStepDrawerLayout(
  ParallelFormDrawerContent,
);

export const ParallelFormDrawer = () => {
  const { t } = useTranslate();
  const { definition, updateDefinitionState, isSaving } = useWorkflow();
  const { selectedOperatorNode, stepPath, selectedStep } =
    useSelectedOperatorStep(StepType.Parallel, isParallelStep);
  const selectedNodeId = selectedOperatorNode?.id;
  const [strategy, setStrategy] = useState<ParallelStrategy>(
    DEFAULT_PARALLEL_STRATEGY,
  );
  const open = Boolean(selectedOperatorNode && selectedNodeId);

  useEffect(() => {
    if (!open) {
      return;
    }

    setStrategy(getParallelStrategyValue(selectedStep));
  }, [open, selectedStep, selectedNodeId]);

  const strategyOptions: ParallelOption[] = useMemo(
    () => [
      {
        value: "wait_all",
        label: t("visual_editor.parallel_drawer.form.strategy.wait_all.label"),
        description: t(
          "visual_editor.parallel_drawer.form.strategy.wait_all.description",
        ),
      },
      {
        value: "wait_any",
        label: t("visual_editor.parallel_drawer.form.strategy.wait_any.label"),
        description: t(
          "visual_editor.parallel_drawer.form.strategy.wait_any.description",
        ),
      },
    ],
    [t],
  );
  const handleClose = useStepDrawerClose();
  const handleSave = () => {
    if (!definition || !stepPath || !selectedStep) {
      return;
    }

    const nextStep: ParallelStep = {
      ...selectedStep,
      parallel: {
        ...selectedStep.parallel,
        strategy,
        steps: selectedStep.parallel.steps ?? [],
      },
    };
    const nextDefinition = WorkflowHelper.setValueAtPath(
      definition,
      stepPath,
      nextStep,
    );

    updateDefinitionState(nextDefinition);
    handleClose();
  };
  const drawerTitle = t("visual_editor.parallel_drawer.title");
  const drawerDescription = t("visual_editor.parallel_drawer.description");
  const strategyLabel = t("visual_editor.parallel_drawer.form.strategy.label");
  const saveLabel = t("button.save");
  const saveDisabled =
    !definition ||
    !stepPath ||
    !selectedStep ||
    isSaving ||
    !isParallelStrategy(strategy);

  return (
    <ParallelFormDrawerLayout
      isOpen={open}
      strategy={strategy}
      options={strategyOptions}
      strategyLabel={strategyLabel}
      onStrategyChange={setStrategy}
      emptyStateLabel={t("visual_editor.parallel_drawer.form.empty_state")}
      open={open}
      headerContent={
        <Box minWidth={0}>
          <Typography variant="subtitle1" noWrap>
            {drawerTitle}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {drawerDescription}
          </Typography>
        </Box>
      }
      footerContent={
        <DrawerPrimaryFooterAction
          label={saveLabel}
          ariaLabel={saveLabel}
          onClick={handleSave}
          disabled={saveDisabled}
          startIcon={<Save size={18} />}
        />
      }
    />
  );
};
