/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from "zod";

const jsonObjectSchema: z.ZodType<Record<string, unknown>> = z.record(
  z.string(),
  z.unknown(),
);

export const channelVisibilitySchema = z.enum(["public", "system"]);

const channelMetadataObjectSchema = z.object({
  name: z.string(),
  settingsSchema: jsonObjectSchema,
  visibility: channelVisibilitySchema.default("public"),
});

export const channelMetadataSchema = channelMetadataObjectSchema;

export type ChannelVisibility = z.infer<typeof channelVisibilitySchema>;

export type ChannelMetadata = z.infer<typeof channelMetadataSchema>;
