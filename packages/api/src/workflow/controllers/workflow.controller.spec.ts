/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import { Workflow as WorkflowHelper } from '@hexabot-ai/agentic';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { TestingModule } from '@nestjs/testing';
import { JSONSchema7 as JsonSchema } from 'json-schema';
import { I18nContext } from 'nestjs-i18n';
import { z } from 'zod';

import { ActionService } from '@/actions/actions.service';
import { BaseAction } from '@/actions/base-action';
import { RuntimeBindingsService } from '@/bindings/runtime-bindings.service';
import { aiMemoryBindingSchema } from '@/extensions/actions/ai/memory.binding';
import { aiModelBindingSchema } from '@/extensions/actions/ai/model.binding';
import { aiToolBindingSchema } from '@/extensions/actions/ai/tools.binding';
import { SendTextMessageAction } from '@/extensions/actions/messaging/text-message.action';
import { I18nService } from '@/i18n/services/i18n.service';
import { LoggerService } from '@/logger/logger.service';
import { IGNORED_TEST_FIELDS } from '@/utils/test/constants';
import { userFixtureIds } from '@/utils/test/fixtures/user';
import {
  installMessagingWorkflowFixturesTypeOrm,
  installScheduledWorkflowFixturesTypeOrm,
  messagingWorkflowDefinition,
  messagingWorkflowFixtures,
} from '@/utils/test/fixtures/workflow';
import { I18nServiceProvider } from '@/utils/test/providers/i18n-service.provider';
import { closeTypeOrmConnections } from '@/utils/test/test';
import { buildTestingMocks } from '@/utils/test/utils';
import { WEBSOCKET_GATEWAY } from '@/websocket/tokens';
import type { WebsocketGateway } from '@/websocket/websocket.gateway';
import {
  conversationalWorkflowInputJsonSchema,
  scheduledWorkflowInputJsonSchema,
} from '@/workflow/schemas/workflow-input-schemas';

import { ManualWorkflowContext } from '../contexts/manual-workflow.context';
import { WorkflowUpdateDto } from '../dto/workflow.dto';
import {
  ManualEventWrapper,
  ScheduledEventWrapper,
} from '../lib/trigger-event-wrapper';
import { WorkflowVersionRepository } from '../repositories/workflow-version.repository';
import { AgenticService } from '../services/agentic.service';
import { WorkflowRunService } from '../services/workflow-run.service';
import { WorkflowService } from '../services/workflow.service';
import { DirectionType, WorkflowType } from '../types';

import { WorkflowController } from './workflow.controller';

const weatherBindingSchema = z.strictObject({
  city: z.string().min(1),
});

class ManualOnlyAction extends BaseAction<
  Record<string, never>,
  Record<string, never>,
  ManualWorkflowContext
> {
  constructor(actionService: ActionService) {
    super(
      {
        name: 'manual_only_action',
        description: 'Manual only action for tests',
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        settingsSchema: z.object({
          custom_flag: z.boolean().optional(),
        }),
        workflowTypes: [WorkflowType.manual],
      },
      actionService,
    );
  }

  async execute() {
    return {};
  }
}

describe('WorkflowController (TypeORM)', () => {
  let module: TestingModule;
  let workflowController: WorkflowController;
  let workflowService: WorkflowService;
  let agenticService: AgenticService;
  let logger: LoggerService;
  let actionService: ActionService;
  let runtimeBindingsService: RuntimeBindingsService;
  let i18nService: I18nService<unknown>;
  const agenticServiceMock = {
    handleEvent: jest.fn().mockResolvedValue(null),
  } as jest.Mocked<Pick<AgenticService, 'handleEvent'>>;
  const workflowRunServiceMock = {
    findOne: jest.fn(),
  } as jest.Mocked<Pick<WorkflowRunService, 'findOne'>>;
  const websocketGatewayMock = {
    joinSockets: jest.fn(),
    broadcastWorkflowEvent: jest.fn(),
  } as jest.Mocked<
    Pick<WebsocketGateway, 'joinSockets' | 'broadcastWorkflowEvent'>
  >;
  const createdWorkflowIds = new Set<string>();
  let counter = 0;

  const buildWorkflowPayload = () => {
    return {
      name: `workflow_${++counter}`,
      description: 'Workflow controller test definition',
      type: WorkflowType.conversational,
      schedule: null,
      inputSchema: conversationalWorkflowInputJsonSchema,
      createdBy: userFixtureIds.admin,
      direction: DirectionType.HORIZONTAL,
      x: 0,
      y: 0,
      zoom: 1,
      builtin: false,
      runAfterMs: 0,
    };
  };

  beforeAll(async () => {
    const { module: testingModule, getMocks } = await buildTestingMocks({
      autoInjectFrom: ['controllers'],
      controllers: [WorkflowController],
      providers: [
        {
          provide: ModuleRef,
          useValue: {
            resolve: () => new ManualWorkflowContext(),
          },
        },
        I18nServiceProvider,
        WorkflowVersionRepository,
        {
          provide: AgenticService,
          useValue: agenticServiceMock,
        },
        {
          provide: WorkflowRunService,
          useValue: workflowRunServiceMock,
        },
        {
          provide: WEBSOCKET_GATEWAY,
          useValue: websocketGatewayMock,
        },
      ],
      typeorm: {
        fixtures: [
          installMessagingWorkflowFixturesTypeOrm,
          installScheduledWorkflowFixturesTypeOrm,
        ],
      },
    });
    module = testingModule;
    [
      agenticService,
      workflowController,
      workflowService,
      actionService,
      runtimeBindingsService,
      i18nService,
    ] = await getMocks([
      AgenticService,
      WorkflowController,
      WorkflowService,
      ActionService,
      RuntimeBindingsService,
      I18nService,
    ]);
    runtimeBindingsService.reset();
    runtimeBindingsService.register({
      kind: 'tools',
      schema: aiToolBindingSchema,
      multiple: true,
      color: '#f59e0b',
      icon: 'Wrench',
      supportedBindings: ['tools', 'model', 'memory'],
      actionPolicy: 'required',
    });
    runtimeBindingsService.register({
      kind: 'model',
      schema: aiModelBindingSchema,
      multiple: false,
      color: '#ad46fc',
      icon: 'Brain',
      supportedBindings: [],
      actionPolicy: 'forbidden',
    });
    runtimeBindingsService.register({
      kind: 'memory',
      schema: aiMemoryBindingSchema,
      multiple: true,
      color: '#0ea5e9',
      icon: 'Database',
      supportedBindings: [],
      actionPolicy: 'forbidden',
    });
    runtimeBindingsService.register({
      kind: 'weather',
      schema: weatherBindingSchema,
      multiple: false,
      color: '#22c55e',
      icon: 'CloudSun',
    });
    logger = workflowController.logger;
    actionService.register(new SendTextMessageAction(actionService));
    actionService.register(new ManualOnlyAction(actionService));
  });

  afterEach(async () => {
    jest.clearAllMocks();
    const ids = Array.from(createdWorkflowIds);

    for (const id of ids) {
      await workflowService.deleteOne(id);
      createdWorkflowIds.delete(id);
    }
  });

  afterAll(async () => {
    if (module) {
      await module.close();
    }
    await closeTypeOrmConnections();
  });

  describe('findMany', () => {
    it('returns workflows matching the provided filters', async () => {
      const options = {
        where: { name: 'messaging_workflow_fixture' },
      };
      const findSpy = jest.spyOn(workflowService, 'findAndPopulate');
      const result = await workflowController.findWorkflows(options, [
        'currentVersion',
        'createdBy',
      ]);

      expect(findSpy).toHaveBeenCalledWith(options);
      expect(result).toEqualPayload(
        [
          {
            ...messagingWorkflowFixtures[0],
            definition: messagingWorkflowDefinition,
            currentVersion: {
              definitionYml: WorkflowHelper.stringifyDefinition(
                messagingWorkflowDefinition,
              ),
              message: null,
              parentVersion: null,
              version: 1,
            },
            publishedVersion: null,
          },
        ],
        [...IGNORED_TEST_FIELDS, 'createdBy', 'action', 'checksum', 'workflow'],
      );
    });
  });

  describe('findActions', () => {
    beforeEach(() => {
      (i18nService.t as jest.Mock).mockImplementation(
        (key: string, options?: { defaultValue?: string }) => {
          return options?.defaultValue ?? key;
        },
      );
    });

    it('returns action schema definitions', () => {
      const actions = workflowController.findActions();
      const action = actions.find(({ name }) => name === 'send_text_message');

      expect(action).toBeDefined();
      expect(action?.inputSchema.$schema).toBe(
        'http://json-schema.org/draft-07/schema#',
      );
      expect(action?.supportedBindings).toEqual([]);
    });

    it('localizes action description and schema metadata using request language', () => {
      (i18nService.t as jest.Mock).mockImplementation(
        (
          key: string,
          options?: { ns?: string; lang?: string; defaultValue?: string },
        ) => {
          if (options?.lang === 'fr' && options?.ns === 'send_text_message') {
            if (key === 'Sends a text message to the subscriber.') {
              return 'FR Sends text';
            }
            if (key === 'Text') {
              return 'FR Text';
            }
            if (key === 'The text message to be sent.') {
              return 'FR Text help';
            }
          }

          return options?.defaultValue ?? key;
        },
      );
      const currentSpy = jest
        .spyOn(I18nContext, 'current')
        .mockReturnValue({ lang: 'fr' } as unknown as I18nContext<unknown>);
      const actions = workflowController.findActions();
      const action = actions.find(({ name }) => name === 'send_text_message');
      const inputDefinition = action?.inputSchema as
        | {
            properties?: Record<
              string,
              { title?: string; description?: string; default?: string }
            >;
          }
        | undefined;

      expect(action?.description).toBe('FR Sends text');
      expect(inputDefinition?.properties?.text?.title).toBe('FR Text');
      expect(inputDefinition?.properties?.text?.description).toBe(
        'FR Text help',
      );
      expect(inputDefinition?.properties?.text?.default).toBe('Hello World!');

      currentSpy.mockRestore();
    });

    it('filters actions by workflow type when provided', () => {
      const actions = workflowController.findActions(
        WorkflowType.conversational,
      );

      expect(actions.some(({ name }) => name === 'manual_only_action')).toBe(
        false,
      );
      expect(actions.some(({ name }) => name === 'send_text_message')).toBe(
        true,
      );
    });

    it('throws for invalid workflow type', () => {
      expect(() =>
        workflowController.findActions('invalid' as WorkflowType),
      ).toThrow(new BadRequestException('Invalid workflow type "invalid"'));
    });
  });

  describe('findBindings', () => {
    beforeEach(() => {
      (i18nService.t as jest.Mock).mockImplementation(
        (key: string, options?: { defaultValue?: string }) => {
          return options?.defaultValue ?? key;
        },
      );
    });

    it('returns runtime binding schema definitions', () => {
      const bindings = workflowController.findBindings();

      expect(bindings.tools).toBeDefined();
      expect(bindings.model).toBeDefined();
      expect(bindings.memory).toBeDefined();
      expect(bindings.weather).toBeDefined();
      expect(bindings.tools.multiple).toBe(true);
      expect(bindings.model.multiple).toBe(false);
      expect(bindings.memory.multiple).toBe(true);
      expect(bindings.weather.multiple).toBe(false);
      expect(bindings.tools.color).toBe('#f59e0b');
      expect(bindings.tools.icon).toBe('Wrench');
      expect(bindings.model.color).toBe('#ad46fc');
      expect(bindings.model.icon).toBe('Brain');
      expect(bindings.memory.color).toBe('#0ea5e9');
      expect(bindings.memory.icon).toBe('Database');
      expect(bindings.weather.color).toBe('#22c55e');
      expect(bindings.weather.icon).toBe('CloudSun');
      expect(bindings.tools.supportedBindings).toEqual([
        'tools',
        'model',
        'memory',
      ]);
      expect(bindings.model.supportedBindings).toEqual([]);
      expect(bindings.memory.supportedBindings).toEqual([]);
      expect(bindings.weather.supportedBindings).toEqual([]);
      expect(bindings.tools.actionPolicy).toBe('required');
      expect(bindings.model.actionPolicy).toBe('forbidden');
      expect(bindings.memory.actionPolicy).toBe('forbidden');
      expect(bindings.weather.actionPolicy).toBe('optional');
      expect(bindings.tools.schema.$schema).toBe(
        'http://json-schema.org/draft-07/schema#',
      );
      expect(bindings.model.schema.$schema).toBe(
        'http://json-schema.org/draft-07/schema#',
      );
      expect(bindings.memory.schema.$schema).toBe(
        'http://json-schema.org/draft-07/schema#',
      );
      const toolsDefinition = bindings.tools.schema as
        | {
            properties?: Record<string, { type?: string }>;
            additionalProperties?: unknown;
          }
        | undefined;
      const modelDefinition = bindings.model.schema as
        | { properties?: Record<string, { type?: string }> }
        | undefined;
      const memoryDefinition = bindings.memory.schema as
        | { properties?: Record<string, { type?: string }> }
        | undefined;
      const weatherDefinition = bindings.weather.schema as
        | { properties?: Record<string, { type?: string }> }
        | undefined;

      expect(toolsDefinition?.properties?.action).toBeUndefined();
      expect(toolsDefinition?.additionalProperties).toBeDefined();
      expect(modelDefinition?.properties?.provider?.type).toBe('string');
      expect(modelDefinition?.properties?.model_id?.type).toBe('string');
      expect(memoryDefinition?.properties?.definition_id?.type).toBe('string');
      expect(weatherDefinition?.properties?.city?.type).toBe('string');
    });

    it('localizes binding schema metadata and keeps non-localized fields intact', () => {
      (i18nService.t as jest.Mock).mockImplementation(
        (
          key: string,
          options?: { ns?: string; lang?: string; defaultValue?: string },
        ) => {
          if (options?.lang === 'fr' && options?.ns === 'memory') {
            if (key === 'Memory definition') {
              return 'FR Memory definition';
            }
            if (
              key ===
              'Select a memory definition that can be mounted into AI action memory bindings.'
            ) {
              return 'FR Memory description';
            }
          }

          return options?.defaultValue ?? key;
        },
      );
      const currentSpy = jest
        .spyOn(I18nContext, 'current')
        .mockReturnValue({ lang: 'fr' } as unknown as I18nContext<unknown>);
      const bindings = workflowController.findBindings();
      const memoryDefinition = bindings.memory.schema as
        | {
            properties?: Record<
              string,
              { title?: string; description?: string; 'ui:widget'?: string }
            >;
          }
        | undefined;

      expect(memoryDefinition?.properties?.definition_id?.title).toBe(
        'FR Memory definition',
      );
      expect(memoryDefinition?.properties?.definition_id?.description).toBe(
        'FR Memory description',
      );
      expect(memoryDefinition?.properties?.definition_id?.['ui:widget']).toBe(
        'AutoCompleteWidget',
      );

      currentSpy.mockRestore();
    });
  });

  describe('create', () => {
    it('creates a workflow', async () => {
      const payload = buildWorkflowPayload();
      const createSpy = jest.spyOn(workflowService, 'create');
      const userId = userFixtureIds.admin;
      const created = await workflowController.create(payload, {
        session: { passport: { user: { id: userId } } },
      } as any);
      createdWorkflowIds.add(created.id);

      expect(createSpy).toHaveBeenCalledWith({
        ...payload,
        createdBy: userId,
      });
      expect(created).toEqualPayload(
        {
          ...payload,
          createdBy: userId,
        },
        [...IGNORED_TEST_FIELDS],
      );
    });
  });

  describe('findOne', () => {
    it('returns a workflow when it exists', async () => {
      const [existing] = await workflowService.find({ take: 1 });
      expect(existing).toBeDefined();

      const findSpy = jest.spyOn(workflowService, 'findOne');
      const result = await workflowController.findWorkflow(existing.id, []);

      expect(findSpy).toHaveBeenCalledWith(existing.id);
      expect(result).toEqualPayload(existing);
    });

    it('throws NotFoundException when workflow is missing', async () => {
      const id = randomUUID();
      const warnSpy = jest.spyOn(logger, 'warn');

      await expect(workflowController.findWorkflow(id, [])).rejects.toThrow(
        new NotFoundException(`Workflow with ID ${id} not found`),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        `Unable to find Workflow by id ${id}`,
      );
    });
  });

  describe('updateOne', () => {
    it('updates an existing workflow', async () => {
      const created = await workflowService.create({
        ...buildWorkflowPayload(),
        createdBy: userFixtureIds.admin,
      });
      createdWorkflowIds.add(created.id);
      const updates: WorkflowUpdateDto = { description: 'Updated workflow' };
      const findOneSpy = jest.spyOn(workflowService, 'findOne');
      const updateSpy = jest.spyOn(workflowService, 'updateOne');
      const result = await workflowController.updateOne(created.id, updates);

      expect(findOneSpy).toHaveBeenCalledWith(created.id);
      expect(updateSpy).toHaveBeenCalledWith(created.id, updates);
      expect(result).toEqualPayload(
        {
          ...created,
          ...updates,
          createdBy: userFixtureIds.admin,
        },
        [...IGNORED_TEST_FIELDS, 'currentVersion', 'publishedVersion'],
      );
    });

    it('rejects workflow type changes', async () => {
      const created = await workflowService.create({
        ...buildWorkflowPayload(),
        createdBy: userFixtureIds.admin,
      });
      createdWorkflowIds.add(created.id);

      await expect(
        workflowController.updateOne(created.id, {
          type: WorkflowType.manual,
        } as WorkflowUpdateDto & {
          type: WorkflowType;
        }),
      ).rejects.toThrow(
        new BadRequestException('Workflow type cannot be changed once created'),
      );
    });

    it('throws NotFoundException when attempting to update a missing workflow', async () => {
      const id = randomUUID();
      const updateSpy = jest.spyOn(workflowService, 'updateOne');
      const warnSpy = jest.spyOn(logger, 'warn');

      await expect(
        workflowController.updateOne(id, { description: 'Missing workflow' }),
      ).rejects.toThrow(
        new NotFoundException(`Workflow with ID ${id} not found`),
      );

      expect(updateSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        `Unable to update Workflow by id ${id}`,
      );
    });
  });

  describe('deleteOne', () => {
    it('removes an existing workflow', async () => {
      const created = await workflowService.create(buildWorkflowPayload());
      createdWorkflowIds.add(created.id);
      const deleteSpy = jest.spyOn(workflowService, 'deleteOne');
      const result = await workflowController.deleteOne(created.id);

      expect(deleteSpy).toHaveBeenCalledWith(created.id);
      expect(result).toEqualPayload({ acknowledged: true, deletedCount: 1 });
      expect(await workflowService.findOne(created.id)).toBeNull();
    });

    it('throws NotFoundException when deletion does not remove anything', async () => {
      const id = randomUUID();
      const deleteSpy = jest.spyOn(workflowService, 'deleteOne');
      const warnSpy = jest.spyOn(logger, 'warn');

      await expect(workflowController.deleteOne(id)).rejects.toThrow(
        new NotFoundException(`Workflow with ID ${id} not found`),
      );
      expect(deleteSpy).toHaveBeenCalledWith(id);
      expect(warnSpy).toHaveBeenCalledWith(
        `Unable to delete Workflow by id ${id}`,
      );
    });
  });

  describe('publish and unpublish', () => {
    it('publishes the current version without creating a new version', async () => {
      const created = await workflowService.create({
        ...buildWorkflowPayload(),
        createdBy: userFixtureIds.admin,
      });
      createdWorkflowIds.add(created.id);
      const before = await workflowService.findOne(created.id);
      const currentVersionBefore = before?.currentVersion ?? null;
      const published = await workflowController.publish(created.id, {
        session: { passport: { user: { id: userFixtureIds.admin } } },
      } as any);
      const after = await workflowService.findOne(created.id);

      expect(published.publishedVersion).toBe(currentVersionBefore);
      expect(published.currentVersion).toBe(currentVersionBefore);
      expect(after?.currentVersion).toBe(currentVersionBefore);
    });

    it('clears published version without creating a new version', async () => {
      const created = await workflowService.create({
        ...buildWorkflowPayload(),
        createdBy: userFixtureIds.admin,
      });
      createdWorkflowIds.add(created.id);

      await workflowController.publish(created.id, {
        session: { passport: { user: { id: userFixtureIds.admin } } },
      } as any);
      const before = await workflowService.findOne(created.id);
      const currentVersionBefore = before?.currentVersion ?? null;
      const unpublished = await workflowController.unpublish(created.id, {
        session: { passport: { user: { id: userFixtureIds.admin } } },
      } as any);
      const after = await workflowService.findOne(created.id);

      expect(unpublished.publishedVersion).toBeNull();
      expect(unpublished.currentVersion).toBe(currentVersionBefore);
      expect(after?.currentVersion).toBe(currentVersionBefore);
    });

    it('rejects publish when user session is missing', async () => {
      const created = await workflowService.create({
        ...buildWorkflowPayload(),
        createdBy: userFixtureIds.admin,
      });
      createdWorkflowIds.add(created.id);

      await expect(
        workflowController.publish(created.id, {} as any),
      ).rejects.toThrow(
        new UnauthorizedException(
          'Only authenticated users can publish workflows',
        ),
      );
    });

    it('rejects unpublish when user session is missing', async () => {
      const created = await workflowService.create({
        ...buildWorkflowPayload(),
        createdBy: userFixtureIds.admin,
      });
      createdWorkflowIds.add(created.id);

      await expect(
        workflowController.unpublish(created.id, {} as any),
      ).rejects.toThrow(
        new UnauthorizedException(
          'Only authenticated users can unpublish workflows',
        ),
      );
    });

    it('throws NotFoundException when publishing a missing workflow', async () => {
      const id = randomUUID();
      const warnSpy = jest.spyOn(logger, 'warn');

      await expect(
        workflowController.publish(id, {
          session: { passport: { user: { id: userFixtureIds.admin } } },
        } as any),
      ).rejects.toThrow(
        new NotFoundException(`Workflow with ID ${id} not found`),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        `Unable to publish Workflow by id ${id}`,
      );
    });

    it('throws NotFoundException when unpublishing a missing workflow', async () => {
      const id = randomUUID();
      const warnSpy = jest.spyOn(logger, 'warn');

      await expect(
        workflowController.unpublish(id, {
          session: { passport: { user: { id: userFixtureIds.admin } } },
        } as any),
      ).rejects.toThrow(
        new NotFoundException(`Workflow with ID ${id} not found`),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        `Unable to unpublish Workflow by id ${id}`,
      );
    });

    it('throws BadRequestException when publishing without a current version', async () => {
      const created = await workflowService.create({
        ...buildWorkflowPayload(),
        createdBy: userFixtureIds.admin,
      });
      createdWorkflowIds.add(created.id);
      await workflowService.updateOne(created.id, {
        currentVersion: null,
      });

      await expect(
        workflowController.publish(created.id, {
          session: { passport: { user: { id: userFixtureIds.admin } } },
        } as any),
      ).rejects.toThrow(
        new BadRequestException(
          'Workflow must have a current version to be published',
        ),
      );
    });
  });

  describe('runManually', () => {
    it('validates and runs a manual workflow when input matches the schema', async () => {
      const manualInputSchema: JsonSchema = {
        type: 'object',
        properties: {
          customerId: { type: 'string' },
          retryCount: { type: 'integer', minimum: 0 },
        },
        required: ['customerId'],
        additionalProperties: false,
      };
      const manual = await workflowService.create({
        ...buildWorkflowPayload(),
        type: WorkflowType.manual,
        inputSchema: manualInputSchema,
        createdBy: userFixtureIds.admin,
      });
      createdWorkflowIds.add(manual.id);
      const input = { customerId: 'cust-1', retryCount: 1 };
      const userId = userFixtureIds.admin;
      const spyAgenticService = jest.spyOn(agenticService, 'handleEvent');
      const result = await workflowController.runManually(manual.id, input, {
        session: { passport: { user: { id: userId } } },
      } as any);

      expect(spyAgenticService).toHaveBeenCalledTimes(1);
      const [eventArg] = spyAgenticService.mock.calls[0];
      expect(eventArg).toBeInstanceOf(ManualEventWrapper);
      expect(eventArg.buildInput()).toEqual(input);
      expect(eventArg.getInitiator()?.id).toEqual(userId);
      expect(eventArg.getWorkflowId()).toEqual(manual.id);
      expect(result).toEqual({ accepted: true });
    });

    it('rejects a manual workflow run when input does not match the schema', async () => {
      const manualInputSchema: JsonSchema = {
        type: 'object',
        properties: {
          customerId: { type: 'string' },
        },
        required: ['customerId'],
        additionalProperties: false,
      };
      const manual = await workflowService.create({
        ...buildWorkflowPayload(),
        type: WorkflowType.manual,
        inputSchema: manualInputSchema,
        createdBy: userFixtureIds.admin,
      });
      createdWorkflowIds.add(manual.id);

      let thrown: unknown;
      try {
        await workflowController.runManually(manual.id, { customerId: 42 }, {
          session: { passport: { user: { id: userFixtureIds.admin } } },
        } as any);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(BadRequestException);
      const response = (thrown as BadRequestException).getResponse() as {
        message?: string;
        details?: {
          fieldErrors?: Record<string, string[]>;
        };
      };
      expect(response.message).toEqual(
        'Manual workflow input validation failed',
      );
      expect(response.details?.fieldErrors?.customerId).toBeDefined();
      expect(agenticService.handleEvent).not.toHaveBeenCalled();
    });

    it('runs a scheduled workflow for an authenticated user', async () => {
      const scheduled = await workflowService.create({
        ...buildWorkflowPayload(),
        type: WorkflowType.scheduled,
        schedule: '*/5 * * * * *',
        inputSchema: scheduledWorkflowInputJsonSchema,
        createdBy: userFixtureIds.admin,
      });
      createdWorkflowIds.add(scheduled.id);
      const input = { run: true };
      const userId = userFixtureIds.admin;
      const spyAgenticService = jest.spyOn(agenticService, 'handleEvent');
      const result = await workflowController.runManually(scheduled.id, input, {
        session: { passport: { user: { id: userId } } },
      } as any);
      expect(spyAgenticService).toHaveBeenCalledTimes(1);
      const [eventArg] = spyAgenticService.mock.calls[0];
      expect(eventArg).toBeInstanceOf(ScheduledEventWrapper);
      expect(eventArg.buildInput()).toEqual(
        expect.objectContaining({
          schedule: scheduled.schedule,
          triggered_at: expect.any(String),
        }),
      );
      expect(eventArg.getInitiator()?.id).toEqual(userId);
      expect(eventArg.getWorkflowId()).toEqual(scheduled.id);
      expect(eventArg.getMetadata()).toEqual(
        expect.objectContaining({
          trigger: WorkflowType.scheduled,
          schedule: scheduled.schedule,
          triggered_at: expect.any(Date),
        }),
      );

      expect(result).toEqual({ accepted: true });
    });

    it('rejects manual execution for conversational workflows', async () => {
      const [conversational] = await workflowService.find({
        where: { type: WorkflowType.conversational },
        take: 1,
      });
      expect(conversational).toBeDefined();

      await expect(
        workflowController.runManually(conversational.id, {}, {
          session: { passport: { user: { id: userFixtureIds.admin } } },
        } as any),
      ).rejects.toThrow(
        new BadRequestException(
          'Workflow must be manual or scheduled to run manually',
        ),
      );
      expect(agenticService.handleEvent).not.toHaveBeenCalled();
    });

    it('throws when user session is missing', async () => {
      const scheduled = await workflowService.create({
        ...buildWorkflowPayload(),
        type: WorkflowType.scheduled,
        schedule: '*/5 * * * * *',
        inputSchema: scheduledWorkflowInputJsonSchema,
        createdBy: userFixtureIds.admin,
      });
      createdWorkflowIds.add(scheduled.id);

      await expect(
        workflowController.runManually(scheduled.id, {}, {} as any),
      ).rejects.toThrow(
        new UnauthorizedException(
          'Only authenticated users can run workflows manually',
        ),
      );
      expect(agenticService.handleEvent).not.toHaveBeenCalled();
    });
  });
});
