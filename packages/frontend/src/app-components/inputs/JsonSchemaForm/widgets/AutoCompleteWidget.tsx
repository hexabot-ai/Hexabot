/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { RJSFSchema, WidgetProps } from "@rjsf/utils";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";

import AutoCompleteApiQuerySelect from "@/app-components/inputs/AutoCompleteApiQuerySelect";
import AutoCompleteEntitySelect from "@/app-components/inputs/AutoCompleteEntitySelect";
import { resolveRoute, type RouteParams } from "@/services/api.class";
import { Format, normalizeEntity } from "@/services/types";
import { IEntityMapTypes } from "@/types/base.types";

import { Rjsf } from "../fields/AutoCompleteField";

import {
  resolveDependencyQueryConfig,
  shouldResetDependentValue,
  toAutoCompleteWidgetValue,
} from "./auto-complete-widget.utils";
import {
  getDescription,
  labelTooltipInputLabelSx,
  LabelWithTooltip,
  mergeLabelSx,
} from "./shared";

type AutoCompleteWidgetOptions = Omit<
  Rjsf["uiSchema"]["ui:options"],
  "label"
> & {
  labelKey?: string;
  routeParamKey?: string;
  multiple?: boolean;
  apiPath?: string;
  valueKey?: string;
  idKey?: string;
};

const AutoCompleteWidgetWrapper = ({
  value,
  label,
  inputLabelSx,
  entity,
  valueKey = "id",
  labelKey = "id",
  multiple = false,
  routeParams,
  queryEnabled = true,
  onChange,
  enableEntityAddButton,
  apiPath,
  idKey,
  ...rest
}: AutoCompleteWidgetOptions & {
  label?: ReactNode;
  inputLabelSx?: unknown;
  value: any;
  entity?: keyof IEntityMapTypes;
  multiple?: boolean;
  routeParams?: RouteParams;
  queryEnabled?: boolean;
  onChange: (value: any) => void;
  enableEntityAddButton?: boolean;
}) => {
  const normalizedValue = useMemo(
    () =>
      multiple
        ? Array.isArray(value)
          ? value
          : []
        : typeof value === "string"
          ? value
          : "",
    [multiple, value],
  );

  if (apiPath) {
    const resolvedApiPath = resolveRoute(apiPath, routeParams);

    return (
      <AutoCompleteApiQuerySelect<any, any, boolean>
        apiPath={resolvedApiPath}
        valueKey={valueKey}
        idKey={idKey}
        labelKey={labelKey}
        label={label ?? ""}
        inputLabelSx={inputLabelSx}
        value={normalizedValue}
        multiple={multiple}
        queryEnabled={queryEnabled}
        onChange={(_e, selected, ..._) => {
          onChange(
            toAutoCompleteWidgetValue({
              selection: Array.isArray(selected)
                ? selected.map((s) => s?.[valueKey] ?? s?.[labelKey])
                : (selected?.[valueKey] ?? selected?.[labelKey]),
              valueKey,
              multiple,
            }),
          );
        }}
        {...rest}
      />
    );
  }

  if (!entity) {
    return null;
  }

  return (
    <AutoCompleteEntitySelect<any, string, boolean>
      searchFields={[]}
      entity={entity}
      format={Format.BASIC}
      idKey={valueKey}
      labelKey={labelKey}
      label={label ?? ""}
      inputLabelSx={inputLabelSx}
      value={normalizedValue}
      multiple={multiple}
      routeParams={routeParams}
      queryEnabled={queryEnabled}
      onChange={(_e, selected, ..._) => {
        onChange(
          toAutoCompleteWidgetValue({
            selection: selected,
            valueKey,
            multiple,
          }),
        );
      }}
      enableEntityAddButton={enableEntityAddButton}
      {...rest}
    />
  );
};

export const AutoCompleteWidget = ({
  value,
  label: fieldLabel,
  schema,
  options,
  InputLabelProps,
  uiSchema,
  onChange,
  registry,
}: WidgetProps) => {
  const description = getDescription(schema as RJSFSchema, options);
  const label = (
    <LabelWithTooltip
      label={fieldLabel || undefined}
      description={description}
    />
  );
  const inputLabelSx = mergeLabelSx(
    labelTooltipInputLabelSx,
    InputLabelProps?.sx,
  );
  const {
    entity,
    valueKey = "id",
    labelKey = "id",
    idFormPath,
    routeParamKey = "id",
    multiple: uiMultiple,
    apiPath,
    idKey = "id",
    ...props
  } = (uiSchema?.["ui:options"] ?? {}) as AutoCompleteWidgetOptions;
  const isMultiple = schema?.type === "array" || Boolean(uiMultiple);
  const dependencyQueryConfig = useMemo(
    () =>
      resolveDependencyQueryConfig({
        formData: registry?.formContext?.formData,
        idFormPath,
        routeParamKey,
      }),
    [idFormPath, registry?.formContext?.formData, routeParamKey],
  );
  const previousDependencyValueRef = useRef(
    dependencyQueryConfig.dependencyValue,
  );

  useEffect(() => {
    const previousDependencyValue = previousDependencyValueRef.current;
    const nextDependencyValue = dependencyQueryConfig.dependencyValue;

    previousDependencyValueRef.current = nextDependencyValue;

    if (
      !shouldResetDependentValue({
        idFormPath,
        previousDependencyValue,
        nextDependencyValue,
      })
    ) {
      return;
    }

    onChange(isMultiple ? [] : "");
  }, [dependencyQueryConfig.dependencyValue, idFormPath, isMultiple, onChange]);

  if (apiPath || entity) {
    return (
      <AutoCompleteWidgetWrapper
        entity={entity ? normalizeEntity(entity) : undefined}
        apiPath={apiPath}
        idKey={idKey}
        value={value}
        label={label}
        inputLabelSx={inputLabelSx}
        valueKey={valueKey}
        labelKey={labelKey}
        multiple={isMultiple}
        routeParams={dependencyQueryConfig.routeParams}
        queryEnabled={dependencyQueryConfig.queryEnabled}
        onChange={onChange}
        {...props}
      />
    );
  }

  return null;
};
