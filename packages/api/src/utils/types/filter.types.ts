/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

// --- Configurable leaves ---
type AllowedLeaf = string | number | boolean | null | undefined | Date;

// --- Small numeric "decrement" map for depth limiting ---
type Prev = {
  0: 0;
  1: 0;
  2: 1;
  3: 2;
};
type Dec<N extends number> = N extends keyof Prev ? Prev[N] : 0;

// --- Helpers ---
type IsArray<T> = T extends readonly any[] ? true : false;
type Elem<T> = T extends readonly (infer U)[] ? U : never;
type IsFunction<T> = T extends (...args: any) => any ? true : false;
type IsPlainObject<T> = T extends object
  ? IsArray<T> extends true
    ? false
    : IsFunction<T> extends true
      ? false
      : true
  : false;

type Join<K extends string, P> = P extends string ? `${K}.${P}` : never;
type NonU<T> = NonNullable<T>;

// --- Core (array → object → leaf), depth-limited ---
export type TFilterNestedKeysOfType<T, D extends number = 3> = [D] extends [0]
  ? never
  : {
      [K in keyof T & string]: IsArray<NonU<T[K]>> extends true // 1) arrays first
        ? Elem<NonU<T[K]>> extends AllowedLeaf
          ? K // arrays of leaves allowed as the key itself
          : never // arrays of objects are not recursed
        : // 2) plain objects (recurse with depth-1)
          IsPlainObject<NonU<T[K]>> extends true
          ? TFilterNestedKeysOfType<NonU<T[K]>, Dec<D>> extends infer P
            ? P extends never
              ? never
              : Join<K, Extract<P, string>>
            : never
          : // 3) leaves
            NonU<T[K]> extends AllowedLeaf
            ? K
            : never;
    }[keyof T & string];

export type RecursivePartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? RecursivePartial<U>[]
    : T[P] extends object
      ? RecursivePartial<T[P]>
      : T[P];
};

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
