/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Autocomplete, TextField } from "@mui/material";
import { FieldProps } from "@rjsf/utils";
import { get } from "lodash";
import { SyntheticEvent } from "react";

import { useGet } from "@/hooks/crud/useGet";
import { normalizeEntity } from "@/services/types";
import { IEntityMapTypes } from "@/types/base.types";

export type Rjsf = FieldProps & {
  uiSchema: {
    "ui:options": {
      entity?: string;
      valueKey?: string;
      idFormPath?: string;
      nestedArrayField?: string;
      nestedArrayItemField?: string;
      nestedArrayItemValue?: string;
    };
  };
};

export const AutoCompleteFieldWrapper = ({
  id,
  entity,
  valueKey = "",
  nestedArrayField = "",
  nestedArrayItemField = "",
  nestedArrayItemValue = "",
  title,
  value,
  onChange,
}: Rjsf["uiSchema"]["ui:options"] & {
  id: string;
  title?: string;
  value: any;
  entity: keyof IEntityMapTypes;
  onChange: (e: SyntheticEvent<Element, Event>, value: any) => void;
}) => {
  const { data } = useGet(id, {
    entity,
  });
  const targetData = get(data, nestedArrayField) || {};
  const options = Object.entries(targetData).reduce((acc, [key, val]) => {
    const isNestedMode = nestedArrayItemField || nestedArrayItemValue;

    if (val) {
      if (isNestedMode) {
        if (val[nestedArrayItemField] === nestedArrayItemValue) {
          acc.push(key);
        }
      } else if (key === valueKey) {
        acc.push(String(val));
      }
    }

    return acc;
  }, [] as string[]);
  const hasOptions = options.length > 0;

  return (
    <Autocomplete
      value={value && hasOptions ? value : ""}
      options={hasOptions ? options : []}
      disabled={!hasOptions}
      onChange={onChange}
      renderInput={(props) => <TextField {...props} label={title} />}
      getOptionLabel={(option) =>
        option.charAt(0).toUpperCase() + option.slice(1)
      }
    />
  );
};

export const AutoCompleteField = ({
  schema,
  uiSchema,
  formData,
  registry,
  fieldPathId,
  onChange,
}: FieldProps) => {
  const { entity, idFormPath, ...props } = (uiSchema?.["ui:options"] ??
    {}) as Rjsf["uiSchema"]["ui:options"];
  const id = get(registry.formContext.formData, idFormPath || "");
  const handleChange = (e: SyntheticEvent<Element, Event>, value: any) => {
    onChange(value, fieldPathId.path);
  };

  if (!id || !entity) {
    return null;
  }

  return (
    <AutoCompleteFieldWrapper
      id={id}
      title={schema.title}
      value={formData}
      entity={normalizeEntity(entity)}
      onChange={handleChange}
      {...props}
    />
  );
};
