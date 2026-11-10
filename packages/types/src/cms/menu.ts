/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from "zod";

import { nullableIdSchema, withAliases } from "../shared/aliases";
import { baseStubSchema } from "../shared/base";
import { preprocess } from "../shared/preprocess";

export enum MenuType {
  web_url = "web_url",
  postback = "postback",
  nested = "nested",
}

const menuTypeSchema = z.enum(MenuType);
const menuAliasMap = {
  parentId: "parent",
} as const;
const menuStubObjectSchema = baseStubSchema.extend({
  title: z.string(),
  type: menuTypeSchema,
  payload: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
});

export const menuStubSchema = menuStubObjectSchema;

export const menuSchema = preprocess(
  (value) => withAliases(value, menuAliasMap),
  menuStubObjectSchema.extend({
    parent: nullableIdSchema.optional(),
  }),
);

export const menuFullSchema = menuStubObjectSchema.extend({
  parent: menuSchema.nullable().optional(),
  children: preprocess(
    (value) => (Array.isArray(value) ? value : []),
    z.array(menuSchema),
  ).optional(),
});

export type MenuStub = z.infer<typeof menuStubSchema>;

export type Menu = z.infer<typeof menuSchema>;

export type MenuFull = z.infer<typeof menuFullSchema>;
