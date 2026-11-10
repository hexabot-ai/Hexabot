/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from "zod";

import { attachmentSchema } from "../attachment/attachment";
import { sourceSchema } from "../channel/source";
import {
  idArraySchema,
  nullableIdSchema,
  withAliases,
} from "../shared/aliases";
import { preprocess } from "../shared/preprocess";
import { subscriberBaseSchema } from "../shared/profile";
import { userProfileAssignedSchema } from "../user/user-profile-assigned";

import { labelSchema } from "./label";

const subscriberAliasMap = {
  labelIds: "labels",
  assignedToId: "assignedTo",
  avatarId: "avatar",
  sourceId: "source",
} as const;
const subscriberObjectSchema = subscriberBaseSchema.extend({
  labels: idArraySchema,
  assignedTo: nullableIdSchema,
  avatar: nullableIdSchema,
  source: nullableIdSchema,
});

export const subscriberStubSchema = subscriberBaseSchema;

export const subscriberSchema = preprocess(
  (value) => withAliases(value, subscriberAliasMap),
  subscriberObjectSchema,
);

export const subscriberFullSchema = subscriberBaseSchema.extend({
  labels: preprocess(
    (value) => (Array.isArray(value) ? value : []),
    z.array(z.lazy(() => labelSchema)),
  ),
  assignedTo: preprocess(
    (value) => (value == null ? null : value),
    userProfileAssignedSchema.nullable(),
  ),
  avatar: preprocess(
    (value) => (value == null ? null : value),
    attachmentSchema.nullable(),
  ),
  source: preprocess(
    (value) => (value == null ? null : value),
    sourceSchema.nullable(),
  ),
});

export type SubscriberStub = z.infer<typeof subscriberStubSchema>;

export type Subscriber = z.infer<typeof subscriberSchema>;

export type SubscriberFull = z.infer<typeof subscriberFullSchema>;
