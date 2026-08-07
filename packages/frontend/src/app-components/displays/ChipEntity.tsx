/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Chip, ChipProps } from "@mui/material";
import { type ReactElement } from "react";

import { useGet } from "@/hooks/crud/useGet";
import { THook, TType } from "@/types/base.types";

export const ChipEntity = <
  TE extends THook["entity"],
  K extends keyof T["basic"],
  T extends TType<TE> = TType<TE>,
>({
  id,
  field,
  entity,
  render = (value) => String(value),
  ...rest
}: {
  id: string;
  field: K;
  entity: TE;
  render?: (
    value?: T["basic"][K],
    data?: T["basic"],
  ) => ReactElement[] | string;
} & ChipProps) => {
  const { data } = useGet(id, { entity });
  const renderOutput = render?.(data?.[field], data);

  return data ? (
    typeof renderOutput === "string" ? (
      <Chip label={renderOutput} {...rest} />
    ) : (
      renderOutput
    )
  ) : null;
};
