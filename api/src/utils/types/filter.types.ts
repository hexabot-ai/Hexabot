/*
 * Copyright © 2025 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import {
  HydratedDocument,
  QueryOptions,
  QuerySelector,
  RootQuerySelector,
} from 'mongoose';

export type TFilterKeysOfType<T, U> = {
  [K in keyof T]: T[K] extends U ? K : never;
}[keyof T];

export type TFilterKeysOfNeverType<T> = Omit<T, TFilterKeysOfType<T, []>>;

export type NestedKeys<T> = T extends object
  ? {
      [K in keyof T]: T[K] extends Function
        ? never
        : Array<any> extends T[K]
          ? Exclude<K, symbol>
          : K extends symbol
            ? Exclude<K, symbol>
            : `${Exclude<K, symbol>}${'' | `.${NestedKeys<T[K]>}`}`;
    }[keyof T]
  : never;

export type ObjectWithNestedKeys<T, ValueType = any> = Partial<{
  [K in NestedKeys<T>]: ValueType;
}>;

export type TFilterNestedKeysOfType<T, U> = T extends object
  ? {
      [K in keyof T]: T[K] extends U
        ? `${K & string}`
        : T[K] extends object
          ? Array<any> extends T[K]
            ? never
            : `${K & string}.${TFilterNestedKeysOfType<T[K], U>}`
          : never;
    }[keyof T]
  : never;

export type WithoutGenericAny<T> = {
  [K in keyof T as string extends K ? never : K]: T[K];
};

export type RecursivePartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? RecursivePartial<U>[]
    : T[P] extends object
      ? RecursivePartial<T[P]>
      : T[P];
};
//base controller validator types
type TAllowedKeys<T, TStub, TValue = (string | null | undefined)[]> = {
  [key in keyof Record<
    TFilterKeysOfType<
      TFilterPopulateFields<TFilterKeysOfNeverType<T>, TStub>,
      TValue
    >,
    TValue
  >]: TValue;
};

type TVirtualFields<T> = Pick<T, TFilterKeysOfType<T, undefined>>;

export type TValidateProps<T, TStub> = {
  dto:
    | Partial<TAllowedKeys<T, TStub>>
    | Partial<TAllowedKeys<T, TStub, string>>;
  allowedIds: Omit<
    TAllowedKeys<T, TStub, null | undefined | string | string[]>,
    keyof TVirtualFields<T>
  >;
};

//populate types
export type TFilterPopulateFields<T, TStub> = Omit<
  T,
  TFilterKeysOfType<
    TStub,
    null | undefined | string | number | boolean | object
  >
>;

//search filter types
type TField<T> = {
  [key in T & string]: { contains: string };
};

type TOrField<T> = {
  where?: {
    or: TField<T>[];
  };
};

type TAndField<T> = {
  where?: TField<T>;
};

type TNorField<T> = {
  where?: {
    [key in T & string]: { '!=': string };
  };
};

export type TSearchFilterValue<T> = TOrField<T> | TAndField<T> | TNorField<T>;

type TOperator = 'eq' | 'iLike' | 'neq' | 'in';
type TContext = 'and' | 'or';

export type TTransformFieldProps = {
  _id?: string;
  _context?: TContext;
  _operator?: TOperator;
  data?: {
    [x: string]: undefined | string | RegExp | (string | undefined)[];
  };
};

/* mongoose */
type TOmitId<T> = Omit<T, 'id'>;
type TReplaceId<T> = TOmitId<T> & { _id?: string };

// Enforce the typing with an alternative type to FilterQuery compatible with mongoose: version 8.0.0
export type TFilterQuery<T, S = TReplaceId<T>> = (
  | RecursivePartial<{
      [P in keyof S]?:
        | (S[P] extends string ? S[P] | RegExp : S[P])
        | QuerySelector<S[P]>;
    }>
  | Partial<ObjectWithNestedKeys<S>>
) &
  WithoutGenericAny<RootQuerySelector<S>>;

export type THydratedDocument<T> = TOmitId<HydratedDocument<T>>;

export type TFlattenOption = { shouldFlatten?: boolean };

export type TQueryOptions<D> = (QueryOptions<D> & TFlattenOption) | null;

export type TProjectField = 0 | 1;

export type TProjectionType<T> = {
  [K in keyof T]?: TProjectField;
};
