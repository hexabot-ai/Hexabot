/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { BaseWorkflowContext } from '@hexabot-ai/agentic';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { I18nContext } from 'nestjs-i18n';

import { I18nService } from '@/i18n/services/i18n.service';
import { LoggerService } from '@/logger/logger.service';
import { toDraft07JsonSchema } from '@/utils/helpers/zod';
import { WorkflowType } from '@/workflow/types';

import type { BaseAction } from './base-action';
import { ActionName, ActionRegistry } from './types';

@Injectable()
export class ActionService {
  private readonly registry: ActionRegistry<
    BaseAction<any, any, BaseWorkflowContext, any>
  > = new Map();

  constructor(
    private readonly logger: LoggerService,
    private readonly i18nService: I18nService,
  ) {}

  register<C extends BaseWorkflowContext>(
    action: BaseAction<any, any, C, any>,
  ) {
    const name = action.getName();
    if (this.registry.has(name)) {
      throw new InternalServerErrorException(
        `Action with name ${name} already exist`,
      );
    }

    this.registry.set(name, action);
    this.logger.log(`Action "${name}" has been registered!`);
  }

  get(name: ActionName) {
    const action = this.registry.get(name);
    if (!action) {
      throw new Error(`Unable to find action "${name}"`);
    }

    return action;
  }

  getAll() {
    return Array.from(this.registry.values());
  }

  getAllSchemaDefinitions(workflowType?: WorkflowType) {
    const actions = workflowType
      ? this.getAll().filter((action) =>
          action.workflowTypes.includes(workflowType),
        )
      : this.getAll();
    const lang = I18nContext.current()?.lang;

    return actions.map((action) => {
      const name = action.getName();
      const localizationOptions =
        this.i18nService.getJsonSchemaLocalizationOptions(name, lang);
      const inputSchema = toDraft07JsonSchema(
        action.inputSchema,
        localizationOptions,
      );

      this.applyActionSchemaContext(inputSchema, name, workflowType);

      return {
        name,
        description: action.description,
        icon: action.icon,
        color: action.color,
        group: action.group,
        workflowTypes: action.workflowTypes,
        supportedBindings: action.supportedBindings ?? [],
        inputSchema,
        outputSchema: toDraft07JsonSchema(
          action.outputSchema,
          localizationOptions,
        ),
        settingSchema: toDraft07JsonSchema(
          action.settingSchema,
          localizationOptions,
        ),
      };
    });
  }

  private applyActionSchemaContext(
    inputSchema: Record<string, any>,
    actionName: string,
    workflowType?: WorkflowType,
  ): void {
    if (actionName !== 'call_workflow' || !workflowType) {
      return;
    }

    const workflowIdSchema = inputSchema.properties?.workflow_id;
    if (!workflowIdSchema || typeof workflowIdSchema !== 'object') {
      return;
    }

    // The same call_workflow action is available to every workflow type, but a
    // specific workflow can only call another workflow with the same trigger
    // type. The catalog endpoint has the active type, so it can scope the UI
    // picker before the action is saved.
    workflowIdSchema['ui:options'] = {
      ...(workflowIdSchema['ui:options'] ?? {}),
      where: {
        ...(workflowIdSchema['ui:options']?.where ?? {}),
        type: workflowType,
      },
    };
  }

  getRegistry(): Record<
    ActionName,
    BaseAction<any, any, BaseWorkflowContext, any>
  > {
    return Object.fromEntries(
      this.getAll().map((action) => [action.getName(), action]),
    );
  }
}
