/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from "zod";

import { attachmentSchema } from "../attachment/attachment";
import { labelSchema } from "../chat/label";
import {
  idArraySchema,
  nullableIdSchema,
  withAliases,
} from "../shared/aliases";
import { nullableStringSchema, preprocess } from "../shared/preprocess";
import { subscriberBaseSchema } from "../shared/profile";

import { roleSchema } from "./role";
import {
  userProfileAssignedSchema,
  userProviderSchema,
} from "./user-profile-assigned";

const userAliasMap = {
  labelIds: "labels",
  assignedToId: "assignedTo",
  roleIds: "roles",
  avatarId: "avatar",
} as const;
const userStubObjectSchema = subscriberBaseSchema.extend({
  username: z.string(),
  email: z.string(),
  sendEmail: z.coerce.boolean(),
  state: z.coerce.boolean(),
  resetCount: z.coerce.number(),
  resetToken: nullableStringSchema,
  provider: userProviderSchema.optional(),
});

export const userStubSchema = userStubObjectSchema;

export const userSchema = preprocess(
  (value) => withAliases(value, userAliasMap),
  userStubObjectSchema.extend({
    labels: idArraySchema,
    assignedTo: nullableIdSchema,
    roles: idArraySchema,
    avatar: nullableIdSchema,
  }),
);

export const userFullSchema = userStubObjectSchema.extend({
  labels: preprocess(
    (value) => (Array.isArray(value) ? value : []),
    z.array(z.lazy(() => labelSchema)),
  ),
  assignedTo: preprocess(
    (value) => (value == null ? null : value),
    userProfileAssignedSchema.nullable(),
  ),
  roles: preprocess(
    (value) => (Array.isArray(value) ? value : []),
    z.array(z.lazy(() => roleSchema)),
  ),
  avatar: preprocess(
    (value) => (value == null ? null : value),
    attachmentSchema.nullable(),
  ),
});

export type UserStub = z.infer<typeof userStubSchema>;

export type User = z.infer<typeof userSchema>;

export type UserFull = z.infer<typeof userFullSchema>;
