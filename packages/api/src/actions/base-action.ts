/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { AbstractAction, BaseWorkflowContext } from '@hexabot-ai/agentic';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { z, type ZodType } from 'zod';

import { RuntimeBindings } from '@/bindings/runtime-bindings';
import type { ConversationalWorkflowContext } from '@/workflow/contexts/conversational-workflow.context';
import { WorkflowType } from '@/workflow/types';

import { ActionService } from './actions.service';
import {
  ActionMetadata,
  ActionName,
  ALL_WORKFLOW_TYPES,
  DEFAULT_ACTION_COLOR,
  DEFAULT_ACTION_GROUP,
  DEFAULT_ACTION_ICON,
  ExecArgs,
} from './types';

const defaultSchema = z.object({}).strict();
const resolveSchema = <T>(schema?: ZodType<T>): ZodType<T> =>
  (schema ?? defaultSchema) as unknown as ZodType<T>;

@Injectable()
export abstract class BaseAction<
    I = unknown,
    O = unknown,
    C extends BaseWorkflowContext = ConversationalWorkflowContext,
    S = unknown,
  >
  extends AbstractAction<I, O, C, S, RuntimeBindings>
  implements OnModuleInit
{
  public readonly icon: string;

  public readonly color: string;

  public readonly group: string;

  public readonly workflowTypes: WorkflowType[];

  protected constructor(
    metadata: ActionMetadata<I, O, S>,
    private readonly actionService: ActionService,
  ) {
    super({
      ...metadata,
      inputSchema: resolveSchema(metadata.inputSchema),
      outputSchema: resolveSchema(metadata.outputSchema),
      settingsSchema: resolveSchema(metadata.settingsSchema),
    });
    this.icon = metadata.icon ?? DEFAULT_ACTION_ICON;
    this.color = metadata.color ?? DEFAULT_ACTION_COLOR;
    this.group = metadata.group ?? DEFAULT_ACTION_GROUP;
    this.workflowTypes = metadata.workflowTypes ?? ALL_WORKFLOW_TYPES;
  }

  getIcon(): string {
    return this.icon as string;
  }

  getName(): ActionName {
    return this.name as ActionName;
  }

  async onModuleInit() {
    this.actionService.register(this);
  }

  abstract execute(args: ExecArgs<I, C, S>): Promise<O>;
}
