/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from "zod";

import {
  idArraySchema,
  nullableIdSchema,
  withAliases,
} from "../shared/aliases";
import { nullableStringSchema, preprocess } from "../shared/preprocess";
import { subscriberBaseSchema } from "../shared/profile";

const userProfileAssignedAliasMap = {
  labelIds: "labels",
  assignedToId: "assignedTo",
  roleIds: "roles",
  avatarId: "avatar",
} as const;

export const userProviderSchema = z.object({
  strategy: z.literal("local"),
  sub: z.string().optional(),
});

const userProfileAssignedObjectSchema = subscriberBaseSchema.extend({
  labels: idArraySchema,
  assignedTo: nullableIdSchema,
  username: z.string(),
  email: z.string(),
  sendEmail: z.coerce.boolean(),
  state: z.coerce.boolean(),
  resetCount: z.coerce.number(),
  resetToken: nullableStringSchema,
  provider: userProviderSchema.optional(),
  roles: idArraySchema,
  avatar: nullableIdSchema,
});

export const userProfileAssignedStubSchema = userProfileAssignedObjectSchema;

export const userProfileAssignedSchema = preprocess(
  (value) => withAliases(value, userProfileAssignedAliasMap),
  userProfileAssignedObjectSchema,
);

export const userProfileAssignedFullSchema = userProfileAssignedSchema;

export type UserProvider = z.infer<typeof userProviderSchema>;

export type UserProfileAssignedStub = z.infer<
  typeof userProfileAssignedStubSchema
>;

export type UserProfileAssigned = z.infer<typeof userProfileAssignedSchema>;

export type UserProfileAssignedFull = z.infer<
  typeof userProfileAssignedFullSchema
>;
