/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { issueMessages, validateWorkflow } from '@hexabot-ai/agentic';
import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

import { RuntimeBindingsService } from '@/bindings/runtime-bindings.service';

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

/**
 * Validate that an object matches the workflow definition schema.
 */
export const IsWorkflowDefinition =
  (options?: ValidationOptions) => (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isWorkflowDefinition',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          if (!isPlainObject(value)) {
            return false;
          }

          return validateWorkflow(value, {
            bindingKinds: RuntimeBindingsService.getRegistry(),
          }).success;
        },
        defaultMessage(args?: ValidationArguments) {
          if (!isPlainObject(args?.value)) {
            return 'Workflow definition must be an object';
          }

          const validation = validateWorkflow(args?.value, {
            bindingKinds: RuntimeBindingsService.getRegistry(),
          });

          if (!validation.success) {
            return `Invalid workflow definition: ${issueMessages(validation.issues).join('; ')}`;
          }

          return 'Invalid workflow definition';
        },
      },
    });
  };
