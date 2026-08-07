/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ChipTypeMap } from "@mui/material";
import { AutocompleteProps } from "@mui/material/Autocomplete";
import get from "lodash/get";
import { type ReactNode, type Ref, useMemo, useState } from "react";

import { useApiClientQuery } from "@/hooks/useApiClient";

import AutoCompleteSelect from "./AutoCompleteSelect";

type AutoCompleteApiQuerySelectProps<
  Value = Record<string, unknown>,
  Label extends keyof Value = keyof Value,
  Multiple extends boolean | undefined = true,
> = Omit<
  AutocompleteProps<
    Value,
    Multiple,
    false,
    false,
    ChipTypeMap["defaultComponent"]
  >,
  "renderInput" | "options" | "value" | "defaultValue" | "label"
> & {
  value?: Multiple extends true ? string[] : string | null;
  label: ReactNode;
  idKey?: string;
  valueKey?: string;
  sortKey?: string;
  labelKey: Label;
  apiPath: string;
  queryParams?: Record<string, unknown>;
  inputLabelSx?: unknown;
  disableSearch?: boolean;
  error?: boolean;
  helperText?: string | null | undefined;
  preprocess?: (data: Value[]) => Value[];
  noOptionsWarning?: string;
  isDisabledWhenEmpty?: boolean;
  queryEnabled?: boolean;
  staleTime?: number;
};

const normalizeSearchValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).toLowerCase();
};
const resolveByPath = (target: unknown, path: string) => {
  if (!path) {
    return target;
  }

  return get(target as Record<string, unknown>, path);
};
const AutoCompleteApiQuerySelect = <
  Value = Record<string, unknown>,
  Label extends keyof Value = keyof Value,
  Multiple extends boolean | undefined = true,
>({
  apiPath,
  queryParams,
  disableSearch,
  preprocess,
  idKey = "id",
  valueKey,
  sortKey = "id",
  labelKey,
  queryEnabled = true,
  staleTime,
  ref,
  ...rest
}: AutoCompleteApiQuerySelectProps<Value, Label, Multiple> & {
  ref?: Ref<HTMLDivElement>;
}) => {
  const [searchText, setSearchText] = useState("");
  const { data, isFetching } = useApiClientQuery("getByPath", {
    params: [apiPath, queryParams],
    enabled: queryEnabled,
    staleTime,
  });
  const rawOptions = useMemo(() => {
    if (preprocess) {
      return preprocess(data as Value[]) as Value[];
    }

    return Array.isArray(data) ? (data as Value[]) : [];
  }, [data, preprocess]);
  const resolvedSavePath = valueKey?.trim() || idKey;
  const options = useMemo(() => {
    const filtered = disableSearch
      ? rawOptions
      : rawOptions.filter((option) => {
          if (!searchText) {
            return true;
          }

          return [
            resolveByPath(option, resolvedSavePath),
            option?.[labelKey],
          ].some((fieldValue) =>
            normalizeSearchValue(fieldValue).includes(
              searchText.trim().toLowerCase(),
            ),
          );
        });

    return [...filtered].sort((a, b) =>
      normalizeSearchValue(b?.[sortKey]).localeCompare(
        normalizeSearchValue(a?.[sortKey]),
      ),
    );
  }, [
    disableSearch,
    labelKey,
    rawOptions,
    resolvedSavePath,
    searchText,
    sortKey,
  ]);
  const valueWithSavePath = useMemo(() => {
    if (rest.multiple) {
      return Array.isArray(rest.value) ? rest.value : [];
    }

    return typeof rest.value === "string" ? rest.value : "";
  }, [rest.multiple, rest.value]);

  return (
    <AutoCompleteSelect<Value, Label, Multiple>
      ref={ref}
      {...rest}
      idKey={idKey}
      labelKey={labelKey}
      options={options}
      value={valueWithSavePath as any}
      onSearch={setSearchText}
      loading={isFetching}
      data-multiple={rest.multiple}
    />
  );
};

AutoCompleteApiQuerySelect.displayName = "AutoCompleteApiQuerySelect";

export default AutoCompleteApiQuerySelect as unknown as <
  Value = Record<string, unknown>,
  Label extends keyof Value = keyof Value,
  Multiple extends boolean | undefined = true,
>(
  props: AutoCompleteApiQuerySelectProps<Value, Label, Multiple> & {
    ref?: Ref<HTMLDivElement>;
  },
) => ReturnType<typeof AutoCompleteApiQuerySelect>;
