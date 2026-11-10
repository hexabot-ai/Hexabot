/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  StepType,
  Workflow as WorkflowHelper,
  type ConditionalBranch,
  type FlowStep,
} from "@hexabot-ai/agentic";
import {
  Box,
  Button,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { DrawerPrimaryFooterAction } from "@/app-components/drawers/DrawerPrimaryFooterAction";
import { JsonataFormulaField } from "@/app-components/inputs/JsonataFormulaField";
import { useTranslate } from "@/hooks/useTranslate";

import { useWorkflow } from "../../../hooks/useWorkflow";
import { useSelectedOperatorStep } from "../../../hooks/useWorkflowSelection";
import {
  useStepDrawerClose,
  withStepDrawerLayout,
} from "../StepDrawer/withStepDrawerLayout";

const DEFAULT_CONDITION = "=false";

type ConditionalStep = Extract<FlowStep, { conditional: unknown }>;
type ConditionalBranchWithCondition = Extract<
  ConditionalBranch,
  { condition: string; steps: FlowStep[] }
>;
type ConditionalElseBranch = Exclude<
  ConditionalBranch,
  ConditionalBranchWithCondition
>;

const isConditionalStep = (step: unknown): step is ConditionalStep => {
  if (!step || typeof step !== "object" || !("conditional" in step)) {
    return false;
  }

  const conditional = (step as { conditional?: { when?: unknown } })
    .conditional;

  return Boolean(conditional && Array.isArray(conditional.when));
};
const isConditionBranch = (
  branch: ConditionalBranch,
): branch is ConditionalBranchWithCondition => "condition" in branch;
const getConditionValues = (step?: ConditionalStep): string[] => {
  const conditions =
    step?.conditional.when
      .filter(isConditionBranch)
      .map((branch) => branch.condition) ?? [];

  return conditions.length ? conditions : [DEFAULT_CONDITION];
};

type ConditionalFormDrawerContentProps = {
  isOpen: boolean;
  conditions: string[];
  conditionHelperText: string;
  removeConditionLabel: string;
  addConditionLabel: string;
  emptyStateLabel: string;
  onConditionChange: (index: number, value: string) => void;
  onConditionRemove: (index: number) => void;
  onConditionAdd: () => void;
  getConditionLabel: (index: number) => string;
};

const ConditionalFormDrawerContent = ({
  isOpen,
  conditions,
  conditionHelperText,
  removeConditionLabel,
  addConditionLabel,
  emptyStateLabel,
  onConditionChange,
  onConditionRemove,
  onConditionAdd,
  getConditionLabel,
}: ConditionalFormDrawerContentProps) => {
  if (!isOpen) {
    return null;
  }

  if (!conditions.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        {emptyStateLabel}
      </Typography>
    );
  }

  const canRemoveCondition = conditions.length > 1;

  return (
    <Stack spacing={2}>
      {conditions.map((condition, index) => {
        const conditionLabel = getConditionLabel(index);

        return (
          <Box key={`${index}-${conditions.length}`}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              mb={0.5}
            >
              <Typography variant="subtitle2">{conditionLabel}</Typography>
              <Tooltip title={removeConditionLabel}>
                <span>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => onConditionRemove(index)}
                    disabled={!canRemoveCondition}
                    aria-label={removeConditionLabel}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
            <JsonataFormulaField
              value={condition}
              onChange={(nextValue) => onConditionChange(index, nextValue)}
              helperText={conditionHelperText}
              enableExpressionAssist
              fullWidth
            />
          </Box>
        );
      })}

      <Button
        variant="outlined"
        startIcon={<Plus size={16} />}
        onClick={onConditionAdd}
        sx={{ alignSelf: "flex-start" }}
      >
        {addConditionLabel}
      </Button>
    </Stack>
  );
};
const ConditionalFormDrawerLayout = withStepDrawerLayout(
  ConditionalFormDrawerContent,
);

export const ConditionalFormDrawer = () => {
  const { t } = useTranslate();
  const { definition, updateDefinitionState, isSaving } = useWorkflow();
  const { selectedOperatorNode, stepPath, selectedStep } =
    useSelectedOperatorStep(StepType.Conditional, isConditionalStep);
  const selectedNodeId = selectedOperatorNode?.id;
  const [conditions, setConditions] = useState<string[]>([DEFAULT_CONDITION]);
  const open = Boolean(selectedOperatorNode && selectedNodeId);

  useEffect(() => {
    if (!open) {
      return;
    }

    setConditions(getConditionValues(selectedStep));
  }, [open, selectedStep, selectedNodeId]);

  const normalizedConditions = useMemo(
    () => conditions.map((condition) => condition.trim()),
    [conditions],
  );
  const hasInvalidCondition = normalizedConditions.some(
    (condition) => !condition || !condition.startsWith("="),
  );
  const handleClose = useStepDrawerClose();
  const handleSave = () => {
    if (!definition || !stepPath || !selectedStep || hasInvalidCondition) {
      return;
    }

    const currentWhen = selectedStep.conditional.when;
    const currentConditionBranches = currentWhen.filter(isConditionBranch);
    const currentElseBranch = currentWhen.find(
      (branch): branch is ConditionalElseBranch => !("condition" in branch),
    );
    const nextConditionBranches: ConditionalBranch[] = normalizedConditions.map(
      (condition, index) => ({
        condition,
        steps: currentConditionBranches[index]?.steps ?? [],
      }),
    );
    const nextElseBranch: ConditionalBranch = currentElseBranch
      ? { ...currentElseBranch, steps: currentElseBranch.steps ?? [] }
      : { else: true, steps: [] };
    const nextStep: ConditionalStep = {
      ...selectedStep,
      conditional: {
        ...selectedStep.conditional,
        when: [...nextConditionBranches, nextElseBranch],
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
  const handleConditionChange = (index: number, value: string) => {
    setConditions((prev) =>
      prev.map((condition, conditionIndex) =>
        conditionIndex === index ? value : condition,
      ),
    );
  };
  const handleConditionRemove = (index: number) => {
    setConditions((prev) =>
      prev.length <= 1
        ? prev
        : prev.filter((_, conditionIndex) => conditionIndex !== index),
    );
  };
  const drawerTitle = t("visual_editor.conditional_drawer.title");
  const saveLabel = t("button.save");
  const saveDisabled =
    !definition ||
    !stepPath ||
    !selectedStep ||
    hasInvalidCondition ||
    isSaving;

  return (
    <ConditionalFormDrawerLayout
      isOpen={open}
      conditions={conditions}
      conditionHelperText={t("visual_editor.conditional_drawer.form.helper")}
      removeConditionLabel={t("button.delete")}
      addConditionLabel={t(
        "visual_editor.conditional_drawer.form.add_condition",
      )}
      emptyStateLabel={t("visual_editor.conditional_drawer.form.empty_state")}
      onConditionChange={handleConditionChange}
      onConditionRemove={handleConditionRemove}
      onConditionAdd={() =>
        setConditions((prev) => [...prev, DEFAULT_CONDITION])
      }
      getConditionLabel={(index) =>
        t("visual_editor.conditional_drawer.form.condition_label", {
          0: index + 1,
        })
      }
      open={open}
      headerContent={
        <Box minWidth={0}>
          <Typography variant="subtitle1" noWrap>
            {drawerTitle}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("visual_editor.conditional_drawer.description")}
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
