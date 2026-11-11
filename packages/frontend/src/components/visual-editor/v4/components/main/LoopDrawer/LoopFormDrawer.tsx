/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { StepType, Workflow as WorkflowHelper } from "@hexabot-ai/agentic";
import {
  Box,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { DrawerPrimaryFooterAction } from "@/app-components/drawers/DrawerPrimaryFooterAction";
import { JsonataFormulaField } from "@/app-components/inputs/JsonataFormulaField";
import { useTranslate } from "@/hooks/useTranslate";

import { useWorkflow } from "../../../hooks/useWorkflow";
import { useSelectedOperatorStep } from "../../../hooks/useWorkflowSelection";
import { StepOptionRadioGroup } from "../StepDrawer/StepOptionRadioGroup";
import {
  useStepDrawerClose,
  withStepDrawerLayout,
} from "../StepDrawer/withStepDrawerLayout";

import {
  applyLoopFieldChange,
  buildLoopStep,
  getLoopFormErrors,
  getLoopFormValues,
  isLoopStep,
  isLoopType,
  type LoopDiscriminator,
  type LoopFormErrorCode,
  type LoopFormErrorField,
  type LoopFormValues,
} from "./loop-form.utils";

type LoopTypeOption = {
  description: string;
  label: string;
  value: LoopDiscriminator;
};
type LoopFormErrors = Partial<Record<LoopFormErrorField, string>>;

type LoopFormDrawerContentProps = {
  isOpen: boolean;
  values: LoopFormValues;
  errors: LoopFormErrors;
  loopTypeLabel: string;
  loopTypeOptions: LoopTypeOption[];
  onFieldChange: (field: keyof LoopFormValues, value: string | boolean) => void;
};

const LoopFormDrawerContent = ({
  isOpen,
  values,
  errors,
  loopTypeLabel,
  loopTypeOptions,
  onFieldChange,
}: LoopFormDrawerContentProps) => {
  const { t } = useTranslate();

  if (!isOpen) {
    return null;
  }

  return (
    <Stack spacing={2}>
      <StepOptionRadioGroup
        label={loopTypeLabel}
        value={values.loopType}
        options={loopTypeOptions}
        isOptionValue={isLoopType}
        onChange={(nextLoopType) => onFieldChange("loopType", nextLoopType)}
      />

      {/* <TextField
        fullWidth
        size="small"
        label={t("visual_editor.loop_drawer.form.name.label")}
        value={values.name}
        onChange={(event) => onFieldChange("name", event.target.value)}
        helperText={t("visual_editor.loop_drawer.form.name.helper")}
      />
      <TextField
        fullWidth
        size="small"
        label={t("visual_editor.loop_drawer.form.description.label")}
        value={values.description}
        onChange={(event) => onFieldChange("description", event.target.value)}
        helperText={t("visual_editor.loop_drawer.form.description.helper")}
        multiline
        minRows={2}
      /> */}

      {values.loopType === "for_each" ? (
        <Box>
          <Typography variant="subtitle2" mb={1}>
            {t("visual_editor.loop_drawer.form.for_each.section")}
          </Typography>
          <Stack spacing={1.5}>
            <TextField
              fullWidth
              size="small"
              label={t("visual_editor.loop_drawer.form.for_each.item_label")}
              value={values.forEachItem}
              onChange={(event) =>
                onFieldChange("forEachItem", event.target.value)
              }
              helperText={
                errors.forEachItem ??
                t("visual_editor.loop_drawer.form.for_each.item_helper")
              }
              error={Boolean(errors.forEachItem)}
            />
            <Box>
              <Typography variant="subtitle2" mb={0.5}>
                {t("visual_editor.loop_drawer.form.for_each.in_label")}
              </Typography>
              <JsonataFormulaField
                value={values.forEachIn}
                onChange={(nextValue) => onFieldChange("forEachIn", nextValue)}
                helperText={
                  errors.forEachIn ??
                  t("visual_editor.loop_drawer.form.for_each.in_helper")
                }
                enableExpressionAssist
                fullWidth
              />
            </Box>
          </Stack>
        </Box>
      ) : (
        <Box>
          <Typography variant="subtitle2" mb={0.5}>
            {t("visual_editor.loop_drawer.form.while.label")}
          </Typography>
          <JsonataFormulaField
            value={values.whileCondition}
            onChange={(nextValue) => onFieldChange("whileCondition", nextValue)}
            helperText={
              errors.whileCondition ??
              t("visual_editor.loop_drawer.form.while.helper")
            }
            enableExpressionAssist
            fullWidth
          />
        </Box>
      )}

      {values.loopType === "for_each" ? (
        <TextField
          fullWidth
          size="small"
          type="number"
          label={t("visual_editor.loop_drawer.form.max_concurrency.label")}
          value={values.maxConcurrency}
          onChange={(event) =>
            onFieldChange("maxConcurrency", event.target.value)
          }
          helperText={
            errors.maxConcurrency ??
            t("visual_editor.loop_drawer.form.max_concurrency.helper")
          }
          error={Boolean(errors.maxConcurrency)}
          slotProps={{
            htmlInput: {
              min: 1,
              step: 1,
            },
          }}
        />
      ) : null}

      {values.loopType === "for_each" ? (
        <Box>
          <Typography variant="subtitle2" mb={0.5}>
            {t("visual_editor.loop_drawer.form.until.label")}
          </Typography>
          <JsonataFormulaField
            value={values.until}
            onChange={(nextValue) => onFieldChange("until", nextValue)}
            helperText={
              errors.until ?? t("visual_editor.loop_drawer.form.until.helper")
            }
            enableExpressionAssist
            fullWidth
          />
        </Box>
      ) : null}

      <Box>
        <FormControlLabel
          control={
            <Switch
              checked={values.accumulateEnabled}
              onChange={(_, checked) =>
                onFieldChange("accumulateEnabled", checked)
              }
            />
          }
          label={t("visual_editor.loop_drawer.form.accumulate.enabled")}
        />
        {values.accumulateEnabled ? (
          <Stack spacing={1.5} mt={1}>
            <TextField
              fullWidth
              size="small"
              label={t("visual_editor.loop_drawer.form.accumulate.as_label")}
              value={values.accumulateAs}
              onChange={(event) =>
                onFieldChange("accumulateAs", event.target.value)
              }
              helperText={
                errors.accumulateAs ??
                t("visual_editor.loop_drawer.form.accumulate.as_helper")
              }
              error={Boolean(errors.accumulateAs)}
            />
            <TextField
              fullWidth
              size="small"
              label={t(
                "visual_editor.loop_drawer.form.accumulate.initial_label",
              )}
              value={values.accumulateInitial}
              onChange={(event) =>
                onFieldChange("accumulateInitial", event.target.value)
              }
              helperText={
                errors.accumulateInitial ??
                t("visual_editor.loop_drawer.form.accumulate.initial_helper")
              }
              error={Boolean(errors.accumulateInitial)}
              multiline
              minRows={3}
            />
            <Box>
              <Typography variant="subtitle2" mb={0.5}>
                {t("visual_editor.loop_drawer.form.accumulate.merge_label")}
              </Typography>
              <JsonataFormulaField
                value={values.accumulateMerge}
                onChange={(nextValue) =>
                  onFieldChange("accumulateMerge", nextValue)
                }
                helperText={
                  errors.accumulateMerge ??
                  t("visual_editor.loop_drawer.form.accumulate.merge_helper")
                }
                enableExpressionAssist
                fullWidth
              />
            </Box>
          </Stack>
        ) : null}
      </Box>
    </Stack>
  );
};
const LoopFormDrawerLayout = withStepDrawerLayout(LoopFormDrawerContent);

export const LoopFormDrawer = () => {
  const { t } = useTranslate();
  const { definition, updateDefinitionState, isSaving } = useWorkflow();
  const { selectedOperatorNode, stepPath, selectedStep } =
    useSelectedOperatorStep(StepType.Loop, isLoopStep);
  const selectedNodeId = selectedOperatorNode?.id;
  const [formValues, setFormValues] =
    useState<LoopFormValues>(getLoopFormValues());
  const open = Boolean(selectedOperatorNode && selectedNodeId);

  useEffect(() => {
    if (!open) {
      return;
    }

    setFormValues(getLoopFormValues(selectedStep));
  }, [open, selectedStep, selectedNodeId]);

  const errorCodes = useMemo(() => getLoopFormErrors(formValues), [formValues]);
  const errors = useMemo<LoopFormErrors>(() => {
    const labels: Record<LoopFormErrorCode, string> = {
      required: t("visual_editor.loop_drawer.form.errors.required"),
      jsonata_required: t(
        "visual_editor.loop_drawer.form.errors.jsonata_required",
      ),
      json_invalid: t("visual_editor.loop_drawer.form.errors.json_invalid"),
      positive_integer: t(
        "visual_editor.loop_drawer.form.errors.positive_integer",
      ),
    };

    return Object.fromEntries(
      Object.entries(errorCodes).map(([field, code]) => [
        field,
        code ? labels[code] : undefined,
      ]),
    );
  }, [errorCodes, t]);
  const hasInvalidForm = Object.values(errorCodes).some(Boolean);
  const loopTypeOptions: LoopTypeOption[] = useMemo(
    () => [
      {
        value: "for_each",
        label: t("visual_editor.loop_drawer.form.type.for_each.label"),
        description: t(
          "visual_editor.loop_drawer.form.type.for_each.description",
        ),
      },
      {
        value: "while",
        label: t("visual_editor.loop_drawer.form.type.while.label"),
        description: t("visual_editor.loop_drawer.form.type.while.description"),
      },
    ],
    [t],
  );
  const handleFieldChange = (
    field: keyof LoopFormValues,
    value: string | boolean,
  ) => {
    setFormValues((prev) => applyLoopFieldChange(prev, field, value));
  };
  const handleClose = useStepDrawerClose();
  const handleSave = () => {
    if (!definition || !stepPath || !selectedStep || hasInvalidForm) {
      return;
    }

    const nextStep = buildLoopStep(selectedStep, formValues);

    if (!nextStep) {
      return;
    }

    const nextDefinition = WorkflowHelper.setValueAtPath(
      definition,
      stepPath,
      nextStep,
    );

    updateDefinitionState(nextDefinition);
    handleClose();
  };
  const saveDisabled =
    !definition || !stepPath || !selectedStep || hasInvalidForm || isSaving;

  return (
    <LoopFormDrawerLayout
      isOpen={open}
      values={formValues}
      errors={errors}
      loopTypeLabel={t("visual_editor.loop_drawer.form.type.label")}
      loopTypeOptions={loopTypeOptions}
      onFieldChange={handleFieldChange}
      open={open}
      headerContent={
        <Box minWidth={0}>
          <Typography variant="subtitle1" noWrap>
            {t("visual_editor.loop_drawer.title")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("visual_editor.loop_drawer.description")}
          </Typography>
        </Box>
      }
      footerContent={
        <DrawerPrimaryFooterAction
          label={t("button.save")}
          ariaLabel={t("button.save")}
          onClick={handleSave}
          disabled={saveDisabled}
          startIcon={<Save size={18} />}
        />
      }
    />
  );
};
