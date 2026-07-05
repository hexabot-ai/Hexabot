/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import AddIcon from "@mui/icons-material/Add";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Grid,
  Menu,
  MenuItem,
  Typography,
} from "@mui/material";
import {
  buttonId,
  canExpand,
  descriptionId,
  getTemplate,
  getUiOptions,
  titleId,
  type ObjectFieldTemplatePropertyType,
  type ObjectFieldTemplateProps,
  type RJSFSchema,
  type UiSchema,
} from "@rjsf/utils";
import { MouseEvent, useMemo, useState } from "react";

import { useTranslate } from "@/hooks/useTranslate";
import { isRecord } from "@/utils/object";

import { getDescription, LabelWithTooltip } from "../widgets/shared";

import { isActionFieldHidden } from "./action-field-template.utils";
import { AddEntryButton } from "./AddEntryButton";

type ActionFieldUiOptions = {
  hideUntilAdded?: boolean;
  [key: string]: unknown;
};

const getObjectSchemaPropertyTitle = (
  schema: RJSFSchema,
  propertyName: string,
): string | undefined => {
  if (!isRecord(schema.properties)) {
    return undefined;
  }

  const propertySchema = schema.properties[propertyName];

  if (!isRecord(propertySchema)) {
    return undefined;
  }

  return typeof propertySchema.title === "string"
    ? propertySchema.title
    : undefined;
};

export const ActionObjectFieldTemplate = (props: ObjectFieldTemplateProps) => {
  const {
    description,
    title,
    properties,
    required,
    disabled,
    readonly,
    uiSchema,
    fieldPathId,
    schema,
    formData,
    optionalDataControl,
    onAddProperty,
    registry,
  } = props;
  const [addOptionAnchor, setAddOptionAnchor] = useState<HTMLElement | null>(
    null,
  );
  const [addedFieldNames, setAddedFieldNames] = useState<string[]>([]);
  const { t } = useTranslate();
  const uiOptions = getUiOptions(uiSchema, registry.globalUiOptions);
  const collapsible = uiOptions?.collapsible === true;
  const defaultExpanded = uiOptions?.defaultExpanded === true;
  const requiredFields = useMemo(() => {
    return new Set(Array.isArray(schema.required) ? schema.required : []);
  }, [schema.required]);
  const objectFormData = isRecord(formData) ? formData : undefined;
  const rootFormData = isRecord(registry.formContext?.formData)
    ? (registry.formContext.formData as Record<string, unknown>)
    : undefined;
  const getFieldUiOptions = (fieldName: string): ActionFieldUiOptions => {
    if (!isRecord(uiSchema)) {
      return {};
    }

    return (
      (getUiOptions(uiSchema[fieldName] as UiSchema | undefined) as
        | ActionFieldUiOptions
        | undefined) ?? {}
    );
  };
  const hasFormDataValue = (fieldName: string): boolean => {
    return (
      objectFormData !== undefined &&
      Object.prototype.hasOwnProperty.call(objectFormData, fieldName)
    );
  };
  const isAddOptionFieldVisible = (
    field: ObjectFieldTemplatePropertyType,
  ): boolean => {
    const { hideUntilAdded } = getFieldUiOptions(field.name);

    if (!hideUntilAdded) {
      return true;
    }

    return (
      requiredFields.has(field.name) ||
      addedFieldNames.includes(field.name) ||
      hasFormDataValue(field.name)
    );
  };
  const isFieldContentVisible = (
    field: ObjectFieldTemplatePropertyType,
  ): boolean => {
    if (field.hidden) {
      return true;
    }

    const fieldUiOptions = getFieldUiOptions(field.name);

    return !isActionFieldHidden({
      hidden: false,
      uiOptions: fieldUiOptions,
      formData: objectFormData ?? rootFormData,
    });
  };
  const addedFieldOrder = new Map(
    addedFieldNames.map((fieldName, index) => [fieldName, index]),
  );
  const visibleProperties = properties
    .filter(
      (field) =>
        field.hidden ||
        (isAddOptionFieldVisible(field) && isFieldContentVisible(field)),
    )
    .sort((leftField, rightField) => {
      const leftAddedOrder = addedFieldOrder.get(leftField.name);
      const rightAddedOrder = addedFieldOrder.get(rightField.name);
      const leftWasAdded = leftAddedOrder !== undefined;
      const rightWasAdded = rightAddedOrder !== undefined;

      if (leftWasAdded && rightWasAdded) {
        return leftAddedOrder - rightAddedOrder;
      }

      if (leftWasAdded) {
        return 1;
      }

      if (rightWasAdded) {
        return -1;
      }

      return 0;
    });
  const addableOptionFields = properties.filter((field) => {
    if (field.hidden) {
      return false;
    }

    const { hideUntilAdded } = getFieldUiOptions(field.name);

    return (
      hideUntilAdded === true &&
      !isAddOptionFieldVisible(field) &&
      isFieldContentVisible(field)
    );
  });
  const TitleFieldTemplate = getTemplate(
    "TitleFieldTemplate",
    registry,
    uiOptions,
  );
  const DescriptionFieldTemplate = getTemplate(
    "DescriptionFieldTemplate",
    registry,
    uiOptions,
  );
  const showOptionalDataControlInTitle = !readonly && !disabled;
  const descriptionText = getDescription(schema as RJSFSchema, uiOptions);
  const titleLabel =
    uiOptions?.label === false ? undefined : (uiOptions?.title ?? title);
  const canAddOption = addableOptionFields.length > 0 && !disabled && !readonly;
  const label = (
    <LabelWithTooltip
      label={titleLabel}
      description={descriptionText}
      iconSize={16}
    />
  );
  const handleOpenAddOptionMenu = (event: MouseEvent<HTMLElement>) => {
    setAddOptionAnchor(event.currentTarget);
  };
  const handleCloseAddOptionMenu = () => {
    setAddOptionAnchor(null);
  };
  const handleAddOption = (fieldName: string) => {
    setAddedFieldNames((current) =>
      current.includes(fieldName) ? current : [...current, fieldName],
    );
    handleCloseAddOptionMenu();
  };
  const propertiesContent = (
    <>
      {description ? (
        <DescriptionFieldTemplate
          id={descriptionId(fieldPathId)}
          description={description}
          schema={schema}
          uiSchema={uiSchema}
          registry={registry}
        />
      ) : null}
      <Grid container spacing={2}>
        {!showOptionalDataControlInTitle ? optionalDataControl : undefined}
        {visibleProperties.map((element) =>
          element.hidden ? (
            element.content
          ) : (
            <Grid size={{ xs: 12 }} key={element.name}>
              {element.content}
            </Grid>
          ),
        )}
      </Grid>
      {canAddOption ? (
        <>
          <Grid container>
            <Grid size={{ xs: 12 }} mt={2}>
              <Button
                variant="outlined"
                onClick={handleOpenAddOptionMenu}
                size="large"
                fullWidth
                startIcon={<AddIcon />}
              >
                {t("button.add_option")}
              </Button>
            </Grid>
          </Grid>
          <Menu
            anchorEl={addOptionAnchor}
            open={Boolean(addOptionAnchor)}
            onClose={handleCloseAddOptionMenu}
            anchorOrigin={{
              vertical: "bottom",
              horizontal: "left",
            }}
            transformOrigin={{
              vertical: "top",
              horizontal: "left",
            }}
            slotProps={{
              paper: {
                sx: {
                  width: addOptionAnchor?.clientWidth,
                  borderTopLeftRadius: 0,
                  borderTopRightRadius: 0,
                },
              },
            }}
          >
            {addableOptionFields.map((field) => (
              <MenuItem
                key={field.name}
                onClick={() => handleAddOption(field.name)}
              >
                {getObjectSchemaPropertyTitle(
                  schema as RJSFSchema,
                  field.name,
                ) ?? field.name}
              </MenuItem>
            ))}
          </Menu>
        </>
      ) : null}
      {canExpand(schema, uiSchema, formData) ? (
        <AddEntryButton
          id={buttonId(fieldPathId, "add")}
          className="rjsf-object-property-expand"
          onClick={onAddProperty}
          disabled={disabled || readonly}
          sx={{ mt: 1 }}
        />
      ) : null}
    </>
  );

  if (!collapsible) {
    return (
      <>
        {titleLabel ? (
          <TitleFieldTemplate
            id={titleId(fieldPathId)}
            title={titleLabel}
            required={required}
            schema={schema}
            uiSchema={uiSchema}
            registry={registry}
            optionalDataControl={
              showOptionalDataControlInTitle ? optionalDataControl : undefined
            }
          />
        ) : null}
        {propertiesContent}
      </>
    );
  }

  return (
    <Accordion variant="elevation" defaultExpanded={defaultExpanded}>
      <AccordionSummary>
        <Box
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          width="100%"
        >
          <Typography variant="subtitle2">{label}</Typography>
          {showOptionalDataControlInTitle ? (
            <Box onClick={(event) => event.stopPropagation()}>
              {optionalDataControl}
            </Box>
          ) : null}
        </Box>
      </AccordionSummary>
      <AccordionDetails>{propertiesContent}</AccordionDetails>
    </Accordion>
  );
};
