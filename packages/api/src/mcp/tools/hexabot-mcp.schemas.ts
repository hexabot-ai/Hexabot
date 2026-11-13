/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import {
  DirectionType,
  McpServerTransport,
  WorkflowType,
} from '@/workflow/types';

export const uuidSchema = z.string().uuid();

export const jsonObjectSchema = z.record(z.string(), z.unknown());

export const paginationSchema = {
  limit: z.number().int().min(1).max(100).default(20),
  skip: z.number().int().min(0).default(0),
  sortBy: z.string().default('createdAt'),
  sortDirection: z.enum(['ASC', 'DESC']).default('DESC'),
};

export const workflowPayloadSchema = {
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: z.enum(WorkflowType).optional(),
  schedule: z.string().nullable().optional(),
  // No longer taken: the tools refuse it and say where the input is declared,
  // so that a caller still sending it is not ignored silently.
  inputSchema: jsonObjectSchema
    .optional()
    .describe(
      'Not accepted any more. Declare the input of a manual workflow in ' +
        'definitionYml, under inputs.schema.',
    ),
  builtin: z.boolean().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  zoom: z.number().optional(),
  direction: z.enum(DirectionType).optional(),
};

export const mcpServerPayloadSchema = {
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  transport: z.enum(McpServerTransport).optional(),
  url: z.string().nullable().optional(),
  command: z.string().nullable().optional(),
  args: z.array(z.string()).nullable().optional(),
  cwd: z.string().nullable().optional(),
  credential: uuidSchema.nullable().optional(),
};

export type PaginationArgs = {
  limit: number;
  skip: number;
  sortBy: string;
  sortDirection: 'ASC' | 'DESC';
};
