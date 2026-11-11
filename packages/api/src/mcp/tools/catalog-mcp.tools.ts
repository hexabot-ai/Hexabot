/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action } from '@hexabot-ai/types';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';

import { ActionService } from '@/actions/actions.service';
import { RuntimeBindingsService } from '@/bindings/runtime-bindings.service';
import { WorkflowType } from '@/workflow/types';

import { McpPermission } from '../decorators/mcp-permission.decorator';

@Injectable()
export class HexabotCatalogMcpTools {
  constructor(
    private readonly actionService: ActionService,
    private readonly runtimeBindingsService: RuntimeBindingsService,
  ) {}

  @McpPermission('workflow', Action.READ)
  @Tool({
    name: 'hexabot_action_search',
    description: 'Search available workflow actions and their schemas.',
    parameters: z.object({
      query: z.string().optional(),
      workflowType: z.enum(WorkflowType).optional(),
    }),
  })
  async searchActions(args: { query?: string; workflowType?: WorkflowType }) {
    const query = args.query?.toLowerCase();
    const actions = this.actionService.getAllSchemaDefinitions(
      args.workflowType,
    );

    return {
      items: query
        ? actions.filter((action) =>
            [
              action.name,
              action.description,
              action.group,
              ...(action.workflowTypes ?? []),
            ]
              .filter(Boolean)
              .some((value) => `${value}`.toLowerCase().includes(query)),
          )
        : actions,
    };
  }

  @McpPermission('workflow', Action.READ)
  @Tool({
    name: 'hexabot_action_get',
    description: 'Read schema metadata for one workflow action.',
    parameters: z.object({
      name: z.string().min(1),
    }),
  })
  async getAction(args: { name: string }) {
    const action = this.actionService
      .getAllSchemaDefinitions()
      .find((entry) => entry.name === args.name);
    if (!action) {
      throw new NotFoundException(`Action ${args.name} not found`);
    }

    return action;
  }

  @McpPermission('workflow', Action.READ)
  @Tool({
    name: 'hexabot_binding_search',
    description: 'Search workflow runtime binding kind schemas.',
    parameters: z.object({
      query: z.string().optional(),
    }),
  })
  async searchBindings(args: { query?: string }) {
    const query = args.query?.toLowerCase();
    const entries = Object.entries(
      this.runtimeBindingsService.getAllSchemaDefinitions(),
    ).map(([kind, definition]) => ({ kind, ...definition }));

    return {
      items: query
        ? entries.filter((entry) =>
            [entry.kind, entry.icon, entry.color]
              .filter(Boolean)
              .some((value) => `${value}`.toLowerCase().includes(query)),
          )
        : entries,
    };
  }

  @McpPermission('workflow', Action.READ)
  @Tool({
    name: 'hexabot_binding_get',
    description: 'Read schema metadata for one workflow runtime binding kind.',
    parameters: z.object({
      kind: z.string().min(1),
    }),
  })
  async getBinding(args: { kind: string }) {
    const bindings = this.runtimeBindingsService.getAllSchemaDefinitions();
    const binding = bindings[args.kind];
    if (!binding) {
      throw new NotFoundException(`Binding kind ${args.kind} not found`);
    }

    return { kind: args.kind, ...binding };
  }
}
