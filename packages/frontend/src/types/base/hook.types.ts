/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { GridPaginationModel, GridSortModel } from "@mui/x-data-grid";
import type { Path, PathValue } from "react-hook-form";

import type { Format, TPopulateTypeFromFormat } from "@/services/types";

import type { SearchPayload } from "../search.types";

import type { IEntityMapTypes } from "./entity-map.types";
import type { Populate } from "./populate.types";
import { POPULATE_BY_TYPE } from "./populate.types";

export type TType<TParam extends keyof IEntityMapTypes> =
  IEntityMapTypes[TParam];

export type EntityAttributes<TE extends keyof IEntityMapTypes> =
  TType<TE>["attributes"];

export type TAllowedFormat<T extends keyof IEntityMapTypes> = {
  format?: (typeof POPULATE_BY_TYPE)[T] extends ReadonlyArray<[]>
    ? Format.BASIC
    : Format;
};

export interface IDynamicProps {
  entity: keyof IEntityMapTypes;
  format?: Format;
}

type AllNever<T> = {
  [K in keyof T]: never;
};

export type TNestedPaths<T> = {
  [K in Path<T>]: PathValue<T, K>;
};

export type SearchFilters<
  TE extends THook["entity"],
  TF extends THook<{ entity: TE }>["full"] = THook<{ entity: TE }>["full"],
  TP extends Populate<TE> = Populate<TE>,
> = TNestedPaths<{
  [K in TP & keyof TF]?: TF[K] extends unknown[]
    ? { id: string }[]
    : { id: string };
}>;

export type THook<
  G extends IDynamicProps = IDynamicProps,
  TE extends keyof IEntityMapTypes = G["entity"],
  TP extends IDynamicProps = IDynamicProps &
    G &
    AllNever<Omit<G, keyof IDynamicProps>> &
    TAllowedFormat<TE>,
> = {
  full: TType<TE>["full"];
  basic: TType<TE>["basic"];
  current: TP["format"] extends Format.FULL
    ? TType<TE>["full"]
    : TType<TE>["basic"];
  filters: Partial<TType<TE>["filters"] & SearchFilters<TE>>;
  params: TP;
  entity: TE;
  populate: TPopulateTypeFromFormat<G>;
  attributes: TType<TE>["attributes"];
};

export interface IFindConfigProps<TE extends THook["entity"]> {
  params?: SearchPayload<TE>;
  hasCount?: boolean;
  initialSortState?: GridSortModel;
  initialPaginationState?: GridPaginationModel;
}
