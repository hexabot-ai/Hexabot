/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from "zod";

import { baseStubSchema } from "./base";
import {
  nullableDateSchema,
  nullableStringSchema,
  preprocess,
} from "./preprocess";

export const userProfileBaseSchema = baseStubSchema.extend({
  firstName: z.string(),
  lastName: z.string(),
  language: nullableStringSchema,
  timezone: z.coerce.number().default(0),
});

const subscriberChannelSchema = z.object({
  name: nullableStringSchema,
  data: preprocess(
    (value) => (value == null ? null : value),
    z.record(z.string(), z.any()).nullable(),
  ).optional(),
});

export const subscriberBaseSchema = userProfileBaseSchema.extend({
  locale: nullableStringSchema,
  gender: nullableStringSchema,
  country: nullableStringSchema,
  foreignId: nullableStringSchema,
  assignedAt: nullableDateSchema,
  lastvisit: nullableDateSchema,
  retainedFrom: nullableDateSchema,
  channel: preprocess(
    (value) => value ?? { name: null, data: null },
    subscriberChannelSchema,
  ),
});
