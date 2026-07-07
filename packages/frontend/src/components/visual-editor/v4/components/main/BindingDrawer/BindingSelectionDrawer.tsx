/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { type JsonValue, type WorkflowDefinition } from "@hexabot-ai/agentic";
import {
  Box,
  Button,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import { type RJSFSchema } from "@rjsf/utils";
import { ArrowLeft, ChevronRight, Plus, Save } from "lucide-react";
import type { JSONSchema } from "monaco-yaml";
import { useEffect, useMemo, useState } from "react";

import { withDrawerLayout } from "@/app-components/drawers/DrawerLayout";
import { DrawerPrimaryFooterAction } from "@/app-components/drawers/DrawerPrimaryFooterAction";
import { EditableTypography } from "@/app-components/inputs/EditableTypography";
import {
  getSchemaDefaults,
  getSchemaPropertyNames,
  JsonSchemaForm,
} from "@/app-components/inputs/JsonSchemaForm";
import { useTranslate } from "@/hooks/useTranslate";

import { humanizeBindingKind } from "../../../utils/binding-kind.utils";
import {
  createUniqueBindingName,
  normalizeBindingName,
} from "../../../utils/binding-name.utils";

type BindingSelectionDrawerBaseProps = {
  availableBindings: string[];
  disabledBindings?: string[];
  bindingKind: string;
  bindingLabel: string;
  defs?: WorkflowDefinition["defs"];
  bindingSchema?: JSONSchema;
  editingBindingName?: string | null;
  isSaving?: boolean;
  onSelectBinding?: (bindingName: string) => void;
  onCreateBindingDefinition?: (
    bindingName: string,
    bindingDefinition: Record<string, unknown>,
    description?: string,
  ) => void;
  onUpdateBindingDefinition?: (
    currentBindingName: string,
    nextBindingName: string,
    bindingDefinition: Record<string, unknown>,
    description?: string,
  ) => void;
};

type BindingListItem = {
  name: string;
  description: string;
  isDisabled: boolean;
};

type BindingSelectionDrawerContentProps = {
  isOpen: boolean;
  isEditing: boolean;
  isCreateMode: boolean;
  isSaving?: boolean;
  bindingLabel: string;
  bindingLabelLower: string;
  bindingSchema?: JSONSchema;
  bindingName: string;
  bindingNameError: string | null;
  bindingDescription: string;
  bindingData: Record<string, unknown>;
  bindingItems: BindingListItem[];
  canCreateBindingDefinition: boolean;
  onSelectBinding?: (bindingName: string) => void;
  onCreateMode: () => void;
  onSelectMode: () => void;
  onBindingNameCommit: (value: string) => void;
  onBindingDescriptionCommit: (value: string) => void;
  onBindingDataChange: (value: Record<string, unknown>) => void;
  onVisibleErrorsChange: (hasVisibleErrors: boolean) => void;
};

type BindingSelectionDrawerProps = BindingSelectionDrawerBaseProps & {
  drawerId?: string;
  open: boolean;
  onClose: () => void;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
};
const pickSchemaFields = (
  value: Record<string, unknown>,
  schema?: JSONSchema,
): Record<string, unknown> => {
  const schemaPropertyNames = getSchemaPropertyNames(schema);

  if (!schemaPropertyNames.length) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).filter(([key]) => schemaPropertyNames.includes(key)),
  );
};
const toBindingFormData = (
  definition: Record<string, unknown>,
  schema?: JSONSchema,
) => {
  const settings = asRecord(definition.settings);

  return pickSchemaFields(settings ?? {}, schema);
};
const BindingSelectionDrawerContent = ({
  isOpen,
  isEditing,
  isCreateMode,
  isSaving,
  bindingLabel,
  bindingLabelLower,
  bindingSchema,
  bindingName,
  bindingNameError,
  bindingDescription,
  bindingData,
  bindingItems,
  canCreateBindingDefinition,
  onSelectBinding,
  onCreateMode,
  onSelectMode,
  onBindingNameCommit,
  onBindingDescriptionCommit,
  onBindingDataChange,
  onVisibleErrorsChange,
}: BindingSelectionDrawerContentProps) => {
  const { t } = useTranslate();

  if (!isOpen) {
    return null;
  }

  if (isCreateMode) {
    return (
      <Stack spacing={1.5}>
        {!isEditing ? (
          <Button
            variant="text"
            size="small"
            startIcon={<ArrowLeft size={16} />}
            onClick={onSelectMode}
            sx={{ alignSelf: "flex-start" }}
          >
            {t("visual_editor.single_binding_drawer.form.back", {
              bindingLabelLower,
            } as Parameters<typeof t>[1])}
          </Button>
        ) : null}
        <Stack spacing={0.25} minWidth={0}>
          <EditableTypography
            component="div"
            variant="subtitle1"
            value={bindingName}
            onCommit={onBindingNameCommit}
            placeholder={t(
              "visual_editor.single_binding_drawer.form.binding_id.label",
              { bindingLabel } as Parameters<typeof t>[1],
            )}
            disabled={isSaving}
            sx={{ fontFamily: "monospace" }}
          />
          {bindingNameError ? (
            <Typography variant="caption" color="error.main">
              {bindingNameError}
            </Typography>
          ) : null}
          <EditableTypography
            component="div"
            variant="body2"
            multiline
            value={bindingDescription}
            onCommit={onBindingDescriptionCommit}
            placeholder={t(
              "visual_editor.single_binding_drawer.form.description.placeholder",
              { bindingLabelLower } as Parameters<typeof t>[1],
            )}
            disabled={isSaving}
            color={
              bindingDescription.trim() ? "text.primary" : "text.secondary"
            }
          />
        </Stack>
        {bindingSchema ? (
          <JsonSchemaForm
            schema={bindingSchema as RJSFSchema}
            formData={bindingData}
            onFormDataChange={onBindingDataChange}
            onVisibleErrorsChange={onVisibleErrorsChange}
            idPrefix="single-binding-selection-drawer"
            expressionPolicy="opt-in"
          />
        ) : (
          <Typography variant="body2" color="text.secondary" px={1}>
            {t("visual_editor.single_binding_drawer.form.empty_schema", {
              bindingLabel,
            } as Parameters<typeof t>[1])}
          </Typography>
        )}
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Box
        border={(theme) => `1px solid ${theme.palette.divider}`}
        borderRadius={1.5}
        p={1.5}
      >
        <Stack spacing={1.5}>
          <Stack spacing={0.25}>
            <Typography variant="subtitle2">
              {t(
                "visual_editor.single_binding_drawer.selection.use_existing.title",
              )}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t(
                "visual_editor.single_binding_drawer.selection.use_existing.description",
                { bindingLabelLower } as Parameters<typeof t>[1],
              )}
            </Typography>
          </Stack>
          {bindingItems.length === 0 ? (
            <Typography variant="body2" color="text.secondary" px={0.5}>
              {t("visual_editor.single_binding_drawer.empty", {
                bindingLabelLower,
              } as Parameters<typeof t>[1])}
            </Typography>
          ) : (
            <List
              disablePadding
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: 1,
              }}
            >
              {bindingItems.map((bindingItem) => {
                const description =
                  bindingItem.description ||
                  t(
                    "visual_editor.single_binding_drawer.list.description_fallback",
                  );
                const isDisabled = Boolean(isSaving || bindingItem.isDisabled);

                return (
                  <ListItemButton
                    key={bindingItem.name}
                    onClick={() => {
                      onSelectBinding?.(bindingItem.name);
                    }}
                    disabled={isDisabled}
                    sx={{
                      alignItems: "flex-start",
                      border: (theme) => `1px solid ${theme.palette.divider}`,
                      borderRadius: 1.25,
                      px: 2,
                      py: 2,
                      backgroundColor: "background.paper",
                      transition: "background-color 120ms, border-color 120ms",
                      "&:hover, &.Mui-focusVisible": isDisabled
                        ? undefined
                        : {
                            backgroundColor: "action.hover",
                            borderColor: "primary.main",
                          },
                    }}
                  >
                    <ListItemText
                      slotProps={{
                        primary: { fontFamily: "monospace" },
                        secondary: { component: "div" },
                      }}
                      sx={{ my: 0, minWidth: 0 }}
                      primary={bindingItem.name}
                      secondary={
                        <Stack spacing={0.25} mt={0.25}>
                          <Typography variant="body2" color="text.secondary">
                            {description}
                          </Typography>
                          {bindingItem.isDisabled ? (
                            <Typography variant="caption" color="text.disabled">
                              {t(
                                "visual_editor.single_binding_drawer.list.disabled_reason",
                              )}
                            </Typography>
                          ) : null}
                        </Stack>
                      }
                    />
                    {!isDisabled ? (
                      <Box
                        color="text.secondary"
                        ml={1}
                        display="flex"
                        alignItems="center"
                        alignSelf="center"
                        flexShrink={0}
                      >
                        <ChevronRight size={16} />
                      </Box>
                    ) : null}
                  </ListItemButton>
                );
              })}
            </List>
          )}
        </Stack>
      </Box>

      <Divider>{t("label.or")}</Divider>

      <Box
        border={(theme) => `1px solid ${theme.palette.divider}`}
        borderRadius={1.5}
        p={1.5}
      >
        <Stack spacing={1.25}>
          <Stack spacing={0.25}>
            <Typography variant="subtitle2">
              {t(
                "visual_editor.single_binding_drawer.selection.create_new.title",
              )}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t(
                "visual_editor.single_binding_drawer.selection.create_new.description",
                { bindingLabelLower } as Parameters<typeof t>[1],
              )}
            </Typography>
          </Stack>
          <Button
            variant="contained"
            size="large"
            startIcon={<Plus size={18} />}
            onClick={onCreateMode}
            disabled={!canCreateBindingDefinition || isSaving}
          >
            {t("visual_editor.single_binding_drawer.add_new", {
              bindingLabelLower,
            } as Parameters<typeof t>[1])}
          </Button>
        </Stack>
      </Box>
    </Stack>
  );
};
const BindingSelectionDrawerLayout = withDrawerLayout(
  BindingSelectionDrawerContent,
);

export const BindingSelectionDrawer = ({
  availableBindings,
  disabledBindings,
  bindingKind,
  bindingLabel,
  defs,
  bindingSchema,
  editingBindingName,
  isSaving,
  drawerId,
  open,
  onClose,
  onSelectBinding,
  onCreateBindingDefinition,
  onUpdateBindingDefinition,
}: BindingSelectionDrawerProps) => {
  const { t } = useTranslate();
  const [mode, setMode] = useState<"select" | "create">("select");
  const [bindingName, setBindingName] = useState("");
  const [bindingDescription, setBindingDescription] = useState("");
  const [bindingData, setBindingData] = useState<Record<string, unknown>>({});
  const [hasVisibleErrors, setHasVisibleErrors] = useState(false);
  const isEditing = Boolean(editingBindingName);
  const isCreateMode = isEditing || mode === "create";
  const normalizedBindingLabel =
    bindingLabel || humanizeBindingKind(bindingKind);
  const bindingLabelLower = useMemo(
    () => normalizedBindingLabel.toLowerCase(),
    [normalizedBindingLabel],
  );
  const disabledBindingSet = useMemo(
    () => new Set(disabledBindings ?? []),
    [disabledBindings],
  );
  const bindingItems = useMemo(
    () =>
      availableBindings.map((bindingNameEntry) => {
        const bindingDefinition = asRecord(defs?.[bindingNameEntry]);
        const description =
          typeof bindingDefinition?.description === "string"
            ? bindingDefinition.description.trim()
            : "";

        return {
          name: bindingNameEntry,
          description,
          isDisabled: disabledBindingSet.has(bindingNameEntry),
        } as BindingListItem;
      }),
    [availableBindings, defs, disabledBindingSet],
  );
  const normalizedBindingName = useMemo(
    () => normalizeBindingName(bindingName),
    [bindingName],
  );
  const normalizedEditingBindingName = useMemo(
    () =>
      editingBindingName ? normalizeBindingName(editingBindingName) : undefined,
    [editingBindingName],
  );
  const bindingNameError = useMemo(() => {
    if (!bindingName.trim()) {
      return t(
        "visual_editor.single_binding_drawer.form.binding_id.errors.required",
        { bindingLabel: normalizedBindingLabel } as Parameters<typeof t>[1],
      );
    }

    if (!normalizedBindingName) {
      return t(
        "visual_editor.single_binding_drawer.form.binding_id.errors.snake_case",
        { bindingLabel: normalizedBindingLabel } as Parameters<typeof t>[1],
      );
    }

    if (
      Object.prototype.hasOwnProperty.call(defs ?? {}, normalizedBindingName) &&
      normalizedBindingName !== normalizedEditingBindingName
    ) {
      return t(
        "visual_editor.single_binding_drawer.form.binding_id.errors.unique",
      );
    }

    return null;
  }, [
    bindingName,
    defs,
    normalizedBindingLabel,
    normalizedBindingName,
    normalizedEditingBindingName,
    t,
  ]);
  const defaultBindingData = useMemo(() => {
    if (!bindingSchema) {
      return {};
    }

    return getSchemaDefaults<Record<string, JsonValue>>(bindingSchema) ?? {};
  }, [bindingSchema]);
  const canCreateBindingDefinition = Boolean(
    onCreateBindingDefinition && bindingSchema,
  );
  const isSaveDisabled =
    (!isEditing && !onCreateBindingDefinition) ||
    (isEditing && !onUpdateBindingDefinition) ||
    !bindingSchema ||
    isSaving ||
    Boolean(bindingNameError) ||
    hasVisibleErrors;

  useEffect(() => {
    if (!open) {
      return;
    }

    if (editingBindingName) {
      const existingDefinition = asRecord(defs?.[editingBindingName]);
      const existingDescription =
        typeof existingDefinition?.description === "string"
          ? existingDefinition.description
          : "";

      setBindingName(editingBindingName);
      setBindingDescription(existingDescription);
      setBindingData(
        existingDefinition
          ? toBindingFormData(existingDefinition, bindingSchema)
          : {},
      );
      setMode("create");
      setHasVisibleErrors(false);

      return;
    }

    setBindingName(
      createUniqueBindingName(
        normalizeBindingName(bindingKind) || "binding",
        defs,
      ),
    );
    setBindingDescription("");
    setBindingData(defaultBindingData);
    setMode(availableBindings.length > 0 ? "select" : "create");
    setHasVisibleErrors(false);
  }, [
    availableBindings.length,
    bindingKind,
    bindingSchema,
    defaultBindingData,
    defs,
    editingBindingName,
    open,
  ]);

  const handleSaveBindingDefinition = () => {
    if (
      !bindingSchema ||
      isSaving ||
      hasVisibleErrors ||
      !normalizedBindingName ||
      bindingNameError
    ) {
      return;
    }

    if (isEditing && editingBindingName && onUpdateBindingDefinition) {
      onUpdateBindingDefinition(
        editingBindingName,
        normalizedBindingName,
        bindingData,
        bindingDescription,
      );

      return;
    }

    onCreateBindingDefinition?.(
      normalizedBindingName,
      bindingData,
      bindingDescription,
    );
  };
  const title = editingBindingName
    ? t("visual_editor.single_binding_drawer.title.edit", {
        bindingLabel: normalizedBindingLabel,
      } as Parameters<typeof t>[1])
    : t("visual_editor.single_binding_drawer.title.create", {
        bindingLabel: normalizedBindingLabel,
      } as Parameters<typeof t>[1]);

  return (
    <BindingSelectionDrawerLayout
      isOpen={open}
      isEditing={isEditing}
      isCreateMode={isCreateMode}
      isSaving={isSaving}
      bindingLabel={normalizedBindingLabel}
      bindingLabelLower={bindingLabelLower}
      bindingSchema={bindingSchema}
      bindingName={bindingName}
      bindingNameError={bindingNameError}
      bindingDescription={bindingDescription}
      bindingData={bindingData}
      bindingItems={bindingItems}
      canCreateBindingDefinition={canCreateBindingDefinition}
      onSelectBinding={onSelectBinding}
      onCreateMode={() => {
        setMode("create");
      }}
      onSelectMode={() => {
        setMode("select");
      }}
      onBindingNameCommit={setBindingName}
      onBindingDescriptionCommit={setBindingDescription}
      onBindingDataChange={setBindingData}
      onVisibleErrorsChange={setHasVisibleErrors}
      footerContent={
        isCreateMode ? (
          <DrawerPrimaryFooterAction
            label={t("button.save")}
            ariaLabel={t("button.save")}
            onClick={handleSaveBindingDefinition}
            disabled={isSaveDisabled}
            startIcon={<Save size={18} />}
            minWidth={220}
          />
        ) : undefined
      }
      drawerId={drawerId}
      open={open}
      onClose={onClose}
      title={title}
      closeLabel={t("button.close")}
    />
  );
};
