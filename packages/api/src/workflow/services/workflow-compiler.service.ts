/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Workflow as AgenticWorkflow,
  JsonataFunctionRegistry,
  WorkflowDefinition,
} from '@hexabot-ai/agentic';
import { WorkflowRunFull } from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';

import { ActionService } from '@/actions/actions.service';
import { RuntimeBindingsService } from '@/bindings/runtime-bindings.service';
import { I18nService } from '@/i18n/services/i18n.service';

import { TriggerEventWrapper } from '../lib/trigger-event-wrapper';
import { parseWorkflowDefinition } from '../lib/workflow-definition';

/** The definition a run pins, and the workflow compiled from it. */
export type CompiledRun = {
  definition: WorkflowDefinition;
  workflow: AgenticWorkflow;
};

/**
 * Compiles the workflow definition a run pins against the registered actions
 * and binding kinds, so `AgenticService` can start or resume it.
 */
@Injectable()
export class WorkflowCompiler {
  constructor(
    private readonly actionService: ActionService,
    private readonly runtimeBindingsService: RuntimeBindingsService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * Compile the definition pinned by a run's workflow version.
   *
   * @returns The compiled run, or `undefined` when the run pins no definition.
   * @throws When the definition no longer parses or compiles against the
   * registered actions and binding kinds.
   */
  compile(
    run: WorkflowRunFull,
    event: TriggerEventWrapper,
  ): CompiledRun | undefined {
    const definition = this.resolveRunDefinition(run);
    if (!definition) {
      return undefined;
    }

    const workflow = AgenticWorkflow.fromDefinition(definition, {
      actions: this.actionService.getRegistry(),
      bindingKinds: this.runtimeBindingsService.getRegistry(),
      jsonataFunctions: this.buildJsonataFunctions(event),
    });

    return { definition, workflow };
  }

  /**
   * Build JSONata helpers scoped to the workflow initiator language.
   */
  private buildJsonataFunctions(
    event: TriggerEventWrapper,
  ): JsonataFunctionRegistry {
    const initiatorLanguage = event.getInitiator()?.language || undefined;

    return {
      t: (key: string, args?: Record<string, unknown>) =>
        this.i18n.t(key, {
          lang: initiatorLanguage,
          defaultValue: key,
          args,
        }),
    };
  }

  /**
   * Resolve the workflow definition snapshot used by the run.
   */
  private resolveRunDefinition(
    run: WorkflowRunFull,
  ): WorkflowDefinition | undefined {
    const definitionYml = run.workflowVersion?.definitionYml;
    if (typeof definitionYml === 'string' && definitionYml.trim() !== '') {
      return parseWorkflowDefinition(definitionYml);
    }
  }
}
