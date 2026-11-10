/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from "zod";

import { baseStubSchema } from "../shared/base";

export const settingValueSchema = z.union([
  z.null(),
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.record(z.string(), z.unknown()),
]);

const settingObjectSchema = baseStubSchema.extend({
  group: z.string(),
  subgroup: z.string().nullable().optional(),
  label: z.string(),
  value: settingValueSchema,
});

export const settingStubSchema = settingObjectSchema;

export const settingSchema = settingObjectSchema;

export const settingFullSchema = settingObjectSchema;

export type SettingStub = z.infer<typeof settingStubSchema>;

export type Setting = z.infer<typeof settingSchema>;

export type SettingFull = z.infer<typeof settingFullSchema>;
