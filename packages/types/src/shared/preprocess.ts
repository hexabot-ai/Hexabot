/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from "zod";

export const preprocess = <T>(
  transformer: (value: unknown) => unknown,
  schema: z.ZodType<T>,
): z.ZodType<T> => {
  return z.preprocess(transformer, schema) as z.ZodType<T>;
};

export const nullableStringSchema = preprocess(
  (value) => (value == null ? null : value),
  z.string().nullable(),
);

export const nullableDateSchema = preprocess(
  (value) => (value == null ? null : value),
  z.coerce.date().nullable(),
);
