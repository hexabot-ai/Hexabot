/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Workflow as AgenticWorkflow,
  type WorkflowDefinition,
} from '@hexabot-ai/agentic';
import {
  WORKFLOW_EXPORT_BUNDLE_KIND,
  workflowExportBundleSchema,
} from '@hexabot-ai/types';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

import { ActionService } from '@/actions/actions.service';
import { RuntimeBindingsService } from '@/bindings/runtime-bindings.service';
import { LabelGroupOrmEntity } from '@/chat/entities/label-group.entity';
import { LabelOrmEntity } from '@/chat/entities/label.entity';
import { LabelService } from '@/chat/services/label.service';
import { ContentTypeOrmEntity } from '@/cms/entities/content-type.entity';
import { ContentTypeService } from '@/cms/services/content-type.service';
import { aiMcpToolBindingSchema } from '@/extensions/actions/ai/mcp.binding';
import { aiMemoryBindingSchema } from '@/extensions/actions/ai/memory.binding';
import { CredentialService } from '@/user/services/credential.service';
import {
  installUserFixturesTypeOrm,
  userFixtureIds,
} from '@/utils/test/fixtures/user';
import { closeTypeOrmConnections } from '@/utils/test/test';
import { buildTestingMocks } from '@/utils/test/utils';
import { WEBSOCKET_GATEWAY } from '@/websocket/tokens';
import type { WebsocketGateway } from '@/websocket/websocket.gateway';
import { workflowResourceRef } from '@/workflow/resource-refs';
import { McpClientPoolService } from '@/workflow/services/mcp-client-pool.service';
import { McpServerService } from '@/workflow/services/mcp-server.service';
import { MemoryDefinitionService } from '@/workflow/services/memory-definition.service';
import { WorkflowRunService } from '@/workflow/services/workflow-run.service';
import { WorkflowVersionService } from '@/workflow/services/workflow-version.service';
import { WorkflowService } from '@/workflow/services/workflow.service';
import {
  McpServerTransport,
  MemoryScope,
  WorkflowType,
  WorkflowVersionAction,
} from '@/workflow/types';

import { ContentTypeTransferAdapter } from './adapters/content-type-transfer.adapter';
import { CredentialTransferAdapter } from './adapters/credential-transfer.adapter';
import { LabelTransferAdapter } from './adapters/label-transfer.adapter';
import { McpServerTransferAdapter } from './adapters/mcp-server-transfer.adapter';
import { MemoryDefinitionTransferAdapter } from './adapters/memory-definition-transfer.adapter';
import { WorkflowTransferAdapterRegistry } from './workflow-transfer-adapter.registry';
import {
  WorkflowTransferAdapter,
  type WorkflowTransferExportContext,
  type WorkflowTransferImportContext,
  WorkflowTransferResourceAdapter,
} from './workflow-transfer-resource-adapter';
import { WorkflowTransferService } from './workflow-transfer.service';
import { type WorkflowTransferImportAdapterResult } from './workflow-transfer.types';

type KnowledgeBaseExportResource = {
  exportId: string;
  name: string;
};

@WorkflowTransferAdapter()
class KnowledgeBaseTransferAdapter extends WorkflowTransferResourceAdapter {
  override readonly kind = 'knowledgeBase';

  override readonly resourceKeys = ['knowledgeBases'];

  override async buildExportResources(
    ctx: WorkflowTransferExportContext,
  ): Promise<Record<string, KnowledgeBaseExportResource[]>> {
    return {
      knowledgeBases: ctx.getRefs(this.kind).map((id) => ({
        exportId: id,
        name: `Knowledge base ${id}`,
      })),
    };
  }

  override async importResources(
    ctx: WorkflowTransferImportContext,
  ): Promise<WorkflowTransferImportAdapterResult> {
    const knowledgeBases =
      ctx.getResources<KnowledgeBaseExportResource>('knowledgeBases');

    return {
      idMap: Object.fromEntries(
        knowledgeBases.map((resource, index) => [
          resource.exportId,
          `knowledge-base-local-${index + 1}`,
        ]),
      ),
      resources: knowledgeBases.map((resource, index) => ({
        kind: this.kind,
        exportId: resource.exportId,
        localId: `knowledge-base-local-${index + 1}`,
        name: resource.name,
        action: 'created',
      })),
      warnings: [],
      postCreateEvents: [],
    };
  }
}

describe('WorkflowTransferService', () => {
  let module: TestingModule;
  let transferService: WorkflowTransferService;
  let workflowService: WorkflowService;
  let workflowVersionService: WorkflowVersionService;
  let memoryDefinitionService: MemoryDefinitionService;
  let mcpServerService: McpServerService;
  let credentialService: CredentialService;
  let runtimeBindingsService: RuntimeBindingsService;
  let actionService: ActionService;
  let dataSource: DataSource;
  let eventEmitter: EventEmitter2;

  const websocketGatewayMock = {
    joinSockets: jest.fn(),
    broadcastWorkflowEvent: jest.fn(),
  } as jest.Mocked<
    Pick<WebsocketGateway, 'joinSockets' | 'broadcastWorkflowEvent'>
  >;
  const workflowRunServiceMock = {
    findOne: jest.fn(),
  };
  const mcpClientPoolServiceMock = {
    testServer: jest.fn(),
    listToolsForDiagnostics: jest.fn(),
  };
  const creatorId = userFixtureIds.admin;

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      imports: [DiscoveryModule],
      providers: [
        WorkflowTransferService,
        {
          provide: WorkflowTransferAdapterRegistry,
          useFactory: (discoveryService: DiscoveryService) =>
            new WorkflowTransferAdapterRegistry(discoveryService),
          inject: [DiscoveryService],
        },
        WorkflowService,
        WorkflowVersionService,
        MemoryDefinitionService,
        McpServerService,
        CredentialService,
        ContentTypeService,
        LabelService,
        CredentialTransferAdapter,
        MemoryDefinitionTransferAdapter,
        ContentTypeTransferAdapter,
        LabelTransferAdapter,
        McpServerTransferAdapter,
        KnowledgeBaseTransferAdapter,
        {
          provide: WEBSOCKET_GATEWAY,
          useValue: websocketGatewayMock,
        },
        {
          provide: McpClientPoolService,
          useValue: mcpClientPoolServiceMock,
        },
        {
          provide: WorkflowRunService,
          useValue: workflowRunServiceMock,
        },
      ],
      typeorm: {
        entities: [ContentTypeOrmEntity, LabelGroupOrmEntity, LabelOrmEntity],
        fixtures: installUserFixturesTypeOrm,
      },
    });

    module = testing.module;
    [
      transferService,
      workflowService,
      workflowVersionService,
      memoryDefinitionService,
      mcpServerService,
      credentialService,
      runtimeBindingsService,
      actionService,
    ] = await testing.getMocks([
      WorkflowTransferService,
      WorkflowService,
      WorkflowVersionService,
      MemoryDefinitionService,
      McpServerService,
      CredentialService,
      RuntimeBindingsService,
      ActionService,
    ]);
    dataSource = module.get(DataSource);
    eventEmitter = module.get(EventEmitter2);
  });

  beforeEach(() => {
    runtimeBindingsService.reset();
    runtimeBindingsService.register({
      kind: 'memory',
      schema: aiMemoryBindingSchema,
      multiple: true,
      color: '#0ea5e9',
      icon: 'Database',
    });
    runtimeBindingsService.register({
      kind: 'mcp',
      schema: aiMcpToolBindingSchema,
      multiple: true,
      color: '#14b8a6',
      icon: 'Plug',
      actionPolicy: 'forbidden',
    });
    jest.spyOn(actionService, 'getRegistry').mockReturnValue({
      retrieve_rag_content: {
        supportedBindings: [],
        inputSchema: z.strictObject({}),
        settingSchema: z.strictObject({
          content_type_id: z
            .string()
            .optional()
            .meta(workflowResourceRef('contentType')),
        }),
      },
      send_list: {
        supportedBindings: [],
        inputSchema: z.strictObject({
          content: z.strictObject({
            contentType: z
              .string()
              .optional()
              .meta(workflowResourceRef('contentType')),
          }),
        }),
        settingSchema: z.strictObject({}),
      },
      subscriber_update_labels: {
        supportedBindings: [],
        inputSchema: z.strictObject({
          labels_to_assign: z
            .array(z.string())
            .optional()
            .meta(workflowResourceRef('label')),
          labels_to_remove: z
            .array(z.string())
            .optional()
            .meta(workflowResourceRef('label')),
        }),
        settingSchema: z.strictObject({}),
      },
      custom_use_knowledge: {
        supportedBindings: [],
        inputSchema: z.strictObject({
          knowledge_base_id: z
            .string()
            .meta(workflowResourceRef('knowledgeBase')),
        }),
        settingSchema: z.strictObject({}),
      },
      call_workflow: {
        supportedBindings: [],
        inputSchema: z.strictObject({
          workflow_id: z.string().meta(workflowResourceRef('workflow')),
          input: z.record(z.string(), z.any()).optional(),
        }),
        settingSchema: z.strictObject({}),
      },
    } as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (module) {
      await module.close();
    }
    await closeTypeOrmConnections();
  });

  const createDefinitionYml = (
    memoryId: string,
    mcpServerId: string,
    taskResources?: { contentTypeId: string; labelId: string },
  ) => {
    const definition: WorkflowDefinition = {
      defs: {
        profile_memory: {
          kind: 'memory',
          settings: { definition_id: memoryId },
        },
        search_mcp: {
          kind: 'mcp',
          settings: { server_id: mcpServerId },
        },
        ...(taskResources
          ? {
              assign_label: {
                kind: 'task',
                action: 'subscriber_update_labels',
                inputs: {
                  labels_to_assign: [taskResources.labelId],
                  labels_to_remove: ['=$input.dynamicLabel'],
                },
              },
              send_content: {
                kind: 'task',
                action: 'send_list',
                inputs: {
                  content: {
                    display: 'list',
                    contentType: taskResources.contentTypeId,
                    fields: { title: 'title', subtitle: 'subtitle' },
                    buttons: [],
                    limit: 2,
                  },
                },
              },
              retrieve_content: {
                kind: 'task',
                action: 'retrieve_rag_content',
                inputs: {
                  query: '=$input.text',
                },
                settings: {
                  content_type_id: taskResources.contentTypeId,
                },
              },
            }
          : {}),
      },
      flow: [],
      outputs: { ok: '=true' },
    };

    return AgenticWorkflow.stringifyDefinition(definition);
  };
  const createContentTypeResource = async (name = `Article ${Date.now()}`) => {
    const repository = dataSource.getRepository(ContentTypeOrmEntity);

    return await repository.save(
      repository.create({
        name,
        schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            subtitle: { type: 'string' },
          },
        },
      }),
    );
  };
  const createLabelResource = async ({
    title = `Qualified ${Date.now()}`,
    name = `QUALIFIED_${Date.now()}`,
    description = 'Qualified lead',
    groupName = `Lead status ${Date.now()}`,
  }: {
    title?: string;
    name?: string;
    description?: string | null;
    groupName?: string;
  } = {}) => {
    const groupRepository = dataSource.getRepository(LabelGroupOrmEntity);
    const labelRepository = dataSource.getRepository(LabelOrmEntity);
    const group = await groupRepository.save(
      groupRepository.create({ name: groupName }),
    );
    const label = await labelRepository.save(
      labelRepository.create({
        title,
        name,
        description,
        group,
        builtin: false,
      }),
    );

    return { group, label };
  };
  const createWorkflowWithTransferDefinition = async ({
    name = `Transfer workflow ${Date.now()}-${Math.random()}`,
    definition,
    type = WorkflowType.conversational,
  }: {
    name?: string;
    definition: WorkflowDefinition;
    type?: WorkflowType;
  }) => {
    const workflow = await workflowService.create({
      name,
      type,
      schedule: null,
      createdBy: creatorId,
    });
    await workflowVersionService.commit({
      workflow: workflow.id,
      definitionYml: AgenticWorkflow.stringifyDefinition(definition),
      action: WorkflowVersionAction.update,
      createdBy: creatorId,
    });
    const populated = await workflowService.findOneAndPopulate(workflow.id);
    if (!populated) {
      throw new Error(`Unable to create workflow ${workflow.id}`);
    }

    return populated;
  };
  const createCallWorkflowDefinition = (
    workflowId: string,
  ): WorkflowDefinition => ({
    defs: {
      call_child: {
        kind: 'task',
        action: 'call_workflow',
        inputs: {
          workflow_id: workflowId,
        },
      },
    },
    flow: [{ do: 'call_child' }],
    outputs: { ok: '=true' },
  });

  it('exports referenced resources without credential secret values', async () => {
    const memoryDefinition = await memoryDefinitionService.create({
      name: `Profile ${Date.now()}`,
      slug: `profile_${Date.now()}`,
      scope: MemoryScope.workflow,
      schema: { type: 'object' },
      ttlSeconds: null,
    });
    const credential = await credentialService.create({
      name: `Search API ${Date.now()}`,
      value: 'secret-value',
      owner: creatorId,
    });
    const mcpServer = await mcpServerService.create({
      name: `Search MCP ${Date.now()}`,
      enabled: true,
      transport: McpServerTransport.http,
      url: 'https://mcp.example.com',
      command: null,
      args: null,
      cwd: null,
      credential: credential.id,
    });
    const contentType = await createContentTypeResource();
    const { group: labelGroup, label } = await createLabelResource();
    const workflow = await workflowService.create({
      name: `Export workflow ${Date.now()}`,
      description: 'Export test',
      type: WorkflowType.conversational,
      schedule: null,
      createdBy: creatorId,
    });
    await workflowVersionService.commit({
      workflow: workflow.id,
      definitionYml: createDefinitionYml(memoryDefinition.id, mcpServer.id, {
        contentTypeId: contentType.id,
        labelId: label.id,
      }),
      action: WorkflowVersionAction.update,
      createdBy: creatorId,
    });

    const exported = await transferService.exportWorkflow(workflow.id);
    const bundle = workflowExportBundleSchema.parse(
      parseYaml(exported.content),
    );

    expect(bundle.kind).toBe(WORKFLOW_EXPORT_BUNDLE_KIND);
    expect(bundle.resources.memoryDefinitions).toHaveLength(1);
    expect(bundle.resources.mcpServers).toHaveLength(1);
    expect(bundle.resources.contentTypes).toEqual([
      {
        exportId: contentType.id,
        name: contentType.name,
        schema: contentType.schema,
      },
    ]);
    expect(bundle.resources.labelGroups).toEqual([
      {
        exportId: labelGroup.id,
        name: labelGroup.name,
      },
    ]);
    expect(bundle.resources.labels).toEqual([
      {
        exportId: label.id,
        title: label.title,
        name: label.name,
        description: label.description,
        groupExportId: labelGroup.id,
      },
    ]);
    expect(bundle.resources.credentials).toEqual([
      {
        exportId: credential.id,
        name: credential.name,
        exportedOwnerId: creatorId,
      },
    ]);
    expect(exported.content).not.toContain('secret-value');
    expect(exported.filename).toMatch(/\.workflow\.yml$/);
  });

  it('exports recursively referenced call_workflow dependencies and their resources', async () => {
    const memoryDefinition = await memoryDefinitionService.create({
      name: `Dependency memory ${Date.now()}`,
      slug: `dependency_memory_${Date.now()}`,
      scope: MemoryScope.workflow,
      schema: { type: 'object' },
      ttlSeconds: null,
    });
    const grandchild = await createWorkflowWithTransferDefinition({
      name: `Grandchild dependency ${Date.now()}`,
      definition: {
        defs: {
          profile_memory: {
            kind: 'memory',
            settings: { definition_id: memoryDefinition.id },
          },
        },
        flow: [],
        outputs: { ok: '=true' },
      },
    });
    const child = await createWorkflowWithTransferDefinition({
      name: `Child dependency ${Date.now()}`,
      definition: createCallWorkflowDefinition(grandchild.id),
    });
    const parent = await createWorkflowWithTransferDefinition({
      name: `Parent dependency ${Date.now()}`,
      definition: createCallWorkflowDefinition(child.id),
    });
    const exported = await transferService.exportWorkflow(parent.id);
    const bundle = workflowExportBundleSchema.parse(
      parseYaml(exported.content),
    );

    expect(bundle.workflow.exportId).toBe(parent.id);
    expect(
      bundle.resources.workflows.map((workflow) => workflow.exportId),
    ).toEqual([child.id, grandchild.id]);
    expect(bundle.resources.workflows[0]).toMatchObject({
      exportId: child.id,
      workflow: {
        name: child.name,
        type: child.type,
      },
    });
    expect(bundle.resources.workflows[1]?.definitionYml).toContain(
      memoryDefinition.id,
    );
    expect(bundle.resources.memoryDefinitions).toEqual([
      expect.objectContaining({
        exportId: memoryDefinition.id,
        slug: memoryDefinition.slug,
      }),
    ]);
  });

  it('imports recursive call_workflow dependencies and remaps workflow ids', async () => {
    const grandchild = await createWorkflowWithTransferDefinition({
      name: `Import grandchild dependency ${Date.now()}`,
      definition: {
        defs: {},
        flow: [],
        outputs: { ok: '=true' },
      },
    });
    const child = await createWorkflowWithTransferDefinition({
      name: `Import child dependency ${Date.now()}`,
      definition: createCallWorkflowDefinition(grandchild.id),
    });
    const parent = await createWorkflowWithTransferDefinition({
      name: `Import parent dependency ${Date.now()}`,
      definition: createCallWorkflowDefinition(child.id),
    });
    const exported = await transferService.exportWorkflow(parent.id);
    const result = await transferService.importWorkflow(
      exported.content,
      creatorId,
    );
    const workflowResults = result.resources.filter(
      (resource) => resource.kind === 'workflow',
    );
    const childResult = workflowResults.find(
      (resource) => resource.exportId === child.id,
    );
    const grandchildResult = workflowResults.find(
      (resource) => resource.exportId === grandchild.id,
    );
    const importedRoot = await workflowService.findOneAndPopulate(
      result.workflow.id,
    );
    const importedChild = childResult
      ? await workflowService.findOneAndPopulate(childResult.localId)
      : null;

    expect(workflowResults).toHaveLength(2);
    expect(childResult?.action).toBe('created');
    expect(grandchildResult?.action).toBe('created');
    expect(childResult?.localId).not.toBe(child.id);
    expect(grandchildResult?.localId).not.toBe(grandchild.id);
    expect(importedRoot?.definitionYml).toContain(childResult?.localId);
    expect(importedRoot?.definitionYml).not.toContain(child.id);
    expect(importedChild?.definitionYml).toContain(grandchildResult?.localId);
    expect(importedChild?.definitionYml).not.toContain(grandchild.id);
  });

  it('imports resources, creates placeholder credentials, and remaps definition references', async () => {
    const memoryExportId = '11111111-1111-4111-8111-111111111111';
    const mcpExportId = '22222222-2222-4222-8222-222222222222';
    const credentialExportId = '33333333-3333-4333-8333-333333333333';
    const content = await buildBundleYaml({
      workflowName: `Imported workflow ${Date.now()}`,
      memoryExportId,
      mcpExportId,
      credentialExportId,
    });
    const emitSpy = jest.spyOn(eventEmitter, 'emitAsync');
    const result = await transferService.importWorkflow(content, creatorId);
    const credentialResult = result.resources.find(
      (resource) => resource.kind === 'credential',
    );
    const memoryResult = result.resources.find(
      (resource) => resource.kind === 'memoryDefinition',
    );
    const mcpResult = result.resources.find(
      (resource) => resource.kind === 'mcpServer',
    );
    const imported = await workflowService.findOneAndPopulate(
      result.workflow.id,
    );

    expect(result.workflow.publishedVersion).toBeNull();
    expect(credentialResult?.action).toBe('placeholder_created');
    expect(memoryResult?.action).toBe('created');
    expect(mcpResult?.action).toBe('created');
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('placeholder'),
        expect.stringContaining('disabled'),
      ]),
    );
    expect(imported?.definitionYml).toContain(memoryResult?.localId);
    expect(imported?.definitionYml).toContain(mcpResult?.localId);
    expect(imported?.definitionYml).not.toContain(memoryExportId);
    expect(imported?.definitionYml).not.toContain(mcpExportId);
    expect(emitSpy.mock.calls.map(([eventName]) => eventName)).toEqual(
      expect.arrayContaining([
        'hook:credential:postCreate',
        'hook:memoryDefinition:postCreate',
        'hook:mcpServer:postCreate',
        'hook:workflow:postCreate',
        'hook:workflowVersion:postCreate',
      ]),
    );
    expect(
      emitSpy.mock.calls.every(
        ([, event]) => (event as { action?: string }).action === 'postCreate',
      ),
    ).toBe(true);
  });

  it('imports content types and labels, then remaps task resource references', async () => {
    const contentTypeExportId = 'ct-export-1';
    const labelGroupExportId = 'label-group-export-1';
    const labelExportId = 'label-export-1';
    const content = buildTaskResourceBundleYaml({
      workflowName: `Task resources workflow ${Date.now()}`,
      contentTypeExportId,
      labelGroupExportId,
      labelExportId,
    });
    const result = await transferService.importWorkflow(content, creatorId);
    const contentTypeResult = result.resources.find(
      (resource) => resource.kind === 'contentType',
    );
    const labelGroupResult = result.resources.find(
      (resource) => resource.kind === 'labelGroup',
    );
    const labelResult = result.resources.find(
      (resource) => resource.kind === 'label',
    );
    const imported = await workflowService.findOneAndPopulate(
      result.workflow.id,
    );

    expect(contentTypeResult?.action).toBe('created');
    expect(labelGroupResult?.action).toBe('created');
    expect(labelResult?.action).toBe('created');
    expect(imported?.definitionYml).toContain(contentTypeResult?.localId);
    expect(imported?.definitionYml).toContain(labelResult?.localId);
    expect(imported?.definitionYml).toContain('=$input.dynamicLabel');
    expect(imported?.definitionYml).not.toContain(contentTypeExportId);
    expect(imported?.definitionYml).not.toContain(labelExportId);
  });

  it('exports and imports extension resource buckets through discovered adapters', async () => {
    const knowledgeBaseExportId = `knowledge_base_${Date.now()}`;
    const definition: WorkflowDefinition = {
      defs: {
        use_knowledge: {
          kind: 'task',
          action: 'custom_use_knowledge',
          inputs: {
            knowledge_base_id: knowledgeBaseExportId,
          },
        },
      },
      flow: [{ do: 'use_knowledge' }],
      outputs: { ok: '=true' },
    };
    const workflow = await workflowService.create({
      name: `Extension export workflow ${Date.now()}`,
      type: WorkflowType.conversational,
      schedule: null,
      createdBy: creatorId,
    });
    await workflowVersionService.commit({
      workflow: workflow.id,
      definitionYml: AgenticWorkflow.stringifyDefinition(definition),
      action: WorkflowVersionAction.update,
      createdBy: creatorId,
    });

    const exported = await transferService.exportWorkflow(workflow.id);
    const bundle = workflowExportBundleSchema.parse(
      parseYaml(exported.content),
    );

    expect(bundle.resources.knowledgeBases).toEqual([
      {
        exportId: knowledgeBaseExportId,
        name: `Knowledge base ${knowledgeBaseExportId}`,
      },
    ]);

    const result = await transferService.importWorkflow(
      exported.content,
      creatorId,
    );
    const knowledgeBaseResult = result.resources.find(
      (resource) => resource.kind === 'knowledgeBase',
    );
    const imported = await workflowService.findOneAndPopulate(
      result.workflow.id,
    );

    expect(knowledgeBaseResult?.action).toBe('created');
    expect(imported?.definitionYml).toContain(knowledgeBaseResult?.localId);
    expect(imported?.definitionYml).not.toContain(knowledgeBaseExportId);
  });

  it('fails when a matching memory definition has different configuration', async () => {
    await memoryDefinitionService.create({
      name: 'Existing profile',
      slug: 'conflicting_profile',
      scope: MemoryScope.workflow,
      schema: { type: 'object', properties: { existing: { type: 'string' } } },
      ttlSeconds: null,
    });
    const emitSpy = jest.spyOn(eventEmitter, 'emitAsync');

    await expect(
      transferService.importWorkflow(
        await buildBundleYaml({
          workflowName: `Conflict workflow ${Date.now()}`,
          memoryExportId: '44444444-4444-4444-8444-444444444444',
          mcpExportId: '55555555-5555-4555-8555-555555555555',
          credentialExportId: '66666666-6666-4666-8666-666666666666',
          memorySlug: 'conflicting_profile',
        }),
        creatorId,
      ),
    ).rejects.toThrow(ConflictException);
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('reuses equivalent local resources and remaps to local IDs', async () => {
    const memoryExportId = '77777777-7777-4777-8777-777777777777';
    const mcpExportId = '88888888-8888-4888-8888-888888888888';
    const credentialExportId = '99999999-9999-4999-8999-999999999999';
    const memorySlug = `reuse_profile_${Date.now()}`;
    const mcpName = `Reusable MCP ${Date.now()}`;
    const credentialName = `Reusable credential ${Date.now()}`;
    const memoryName = `Reusable profile ${Date.now()}`;
    const mcpUrl = 'https://reused-mcp.example.com';
    const existingMemory = await memoryDefinitionService.create({
      name: memoryName,
      slug: memorySlug,
      scope: MemoryScope.workflow,
      schema: { type: 'object' },
      ttlSeconds: null,
    });
    const existingCredential = await credentialService.create({
      name: credentialName,
      value: 'local-secret',
      owner: creatorId,
    });
    const existingMcpServer = await mcpServerService.create({
      name: mcpName,
      enabled: false,
      transport: McpServerTransport.http,
      url: mcpUrl,
      command: null,
      args: null,
      cwd: null,
      credential: existingCredential.id,
    });
    const result = await transferService.importWorkflow(
      await buildBundleYaml({
        workflowName: `Reuse workflow ${Date.now()}`,
        memoryExportId,
        mcpExportId,
        credentialExportId,
        memorySlug,
        mcpName,
        mcpUrl,
        credentialName,
        memoryName,
      }),
      creatorId,
    );
    const imported = await workflowService.findOneAndPopulate(
      result.workflow.id,
    );

    expect(result.warnings).toEqual([]);
    expect(result.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'memoryDefinition',
          exportId: memoryExportId,
          localId: existingMemory.id,
          action: 'reused',
        }),
        expect.objectContaining({
          kind: 'credential',
          exportId: credentialExportId,
          localId: existingCredential.id,
          action: 'reused',
        }),
        expect.objectContaining({
          kind: 'mcpServer',
          exportId: mcpExportId,
          localId: existingMcpServer.id,
          action: 'reused',
        }),
      ]),
    );
    expect(imported?.definitionYml).toContain(existingMemory.id);
    expect(imported?.definitionYml).toContain(existingMcpServer.id);
  });

  it('fails when a matching MCP server has different configuration', async () => {
    const mcpName = `Conflicting MCP ${Date.now()}`;
    await mcpServerService.create({
      name: mcpName,
      enabled: true,
      transport: McpServerTransport.http,
      url: 'https://local-mcp.example.com',
      command: null,
      args: null,
      cwd: null,
      credential: null,
    });

    await expect(
      transferService.importWorkflow(
        await buildBundleYaml({
          workflowName: `MCP conflict workflow ${Date.now()}`,
          memoryExportId: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
          mcpExportId: 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
          credentialExportId: null,
          memorySlug: `mcp_conflict_profile_${Date.now()}`,
          mcpName,
          mcpUrl: 'https://imported-mcp.example.com',
        }),
        creatorId,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('fails when a matching content type has different schema', async () => {
    const contentTypeName = `Conflicting content type ${Date.now()}`;
    await createContentTypeResource(contentTypeName);

    await expect(
      transferService.importWorkflow(
        buildTaskResourceBundleYaml({
          workflowName: `Content type conflict workflow ${Date.now()}`,
          contentTypeExportId: 'conflicting-content-type',
          contentTypeName,
          contentTypeSchema: {
            type: 'object',
            properties: {
              title: { type: 'number' },
            },
          },
          labelGroupExportId: 'conflict-label-group',
          labelExportId: 'conflict-label',
        }),
        creatorId,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('fails when a matching label has different configuration', async () => {
    const labelName = `CONFLICTING_LABEL_${Date.now()}`;
    await createLabelResource({
      title: `Local title ${Date.now()}`,
      name: labelName,
      description: 'Local description',
    });

    await expect(
      transferService.importWorkflow(
        buildTaskResourceBundleYaml({
          workflowName: `Label conflict workflow ${Date.now()}`,
          contentTypeExportId: 'label-conflict-content-type',
          labelGroupExportId: 'label-conflict-group',
          labelExportId: 'label-conflict',
          labelName,
          labelTitle: `Imported title ${Date.now()}`,
          labelDescription: 'Imported description',
        }),
        creatorId,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('fails when an imported label title already exists with another name', async () => {
    const labelTitle = `Duplicate label title ${Date.now()}`;
    await createLabelResource({
      title: labelTitle,
      name: `LOCAL_LABEL_${Date.now()}`,
    });

    await expect(
      transferService.importWorkflow(
        buildTaskResourceBundleYaml({
          workflowName: `Label title conflict workflow ${Date.now()}`,
          contentTypeExportId: 'label-title-conflict-content-type',
          labelGroupExportId: 'label-title-conflict-group',
          labelExportId: 'label-title-conflict',
          labelName: `IMPORTED_LABEL_${Date.now()}`,
          labelTitle,
        }),
        creatorId,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects invalid workflow bundle YAML', async () => {
    await expect(
      transferService.importWorkflow('kind: [', creatorId),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects non-empty resource buckets without a registered adapter', async () => {
    await expect(
      transferService.importWorkflow(
        stringifyYaml(
          {
            kind: WORKFLOW_EXPORT_BUNDLE_KIND,
            schemaVersion: 1,
            exportedAt: '2026-05-05T00:00:00.000Z',
            workflow: {
              name: `Unsupported resource workflow ${Date.now()}`,
              description: null,
              type: WorkflowType.conversational,
              schedule: null,
              inputSchema: {},
              layout: {
                x: 0,
                y: 0,
                zoom: 1,
                direction: 'horizontal',
              },
            },
            version: {
              number: 1,
              checksum: 'sha',
              message: null,
              exportedVersionId: 'version-1',
            },
            definitionYml: AgenticWorkflow.stringifyDefinition({
              defs: {},
              flow: [],
              outputs: { ok: '=true' },
            }),
            resources: {
              memoryDefinitions: [],
              mcpServers: [],
              credentials: [],
              unsupportedResources: [{ exportId: 'unsupported-1' }],
            },
          },
          { lineWidth: 0 },
        ),
        creatorId,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects bundles missing referenced resources', async () => {
    await expect(
      transferService.importWorkflow(
        await buildBundleYaml({
          workflowName: `Missing resource workflow ${Date.now()}`,
          memoryExportId: 'ccccccc1-cccc-4ccc-8ccc-ccccccccccc1',
          mcpExportId: 'ddddddd1-dddd-4ddd-8ddd-ddddddddddd1',
          credentialExportId: null,
          includeMcpResources: false,
        }),
        creatorId,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects bundles missing referenced task resources', async () => {
    await expect(
      transferService.importWorkflow(
        buildTaskResourceBundleYaml({
          workflowName: `Missing task resource workflow ${Date.now()}`,
          contentTypeExportId: 'missing-content-type',
          labelGroupExportId: 'missing-label-group',
          labelExportId: 'missing-label',
          includeContentTypeResources: false,
          includeLabelResources: false,
        }),
        creatorId,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects bundles missing referenced workflow dependencies', async () => {
    await expect(
      transferService.importWorkflow(
        stringifyYaml(
          {
            kind: WORKFLOW_EXPORT_BUNDLE_KIND,
            schemaVersion: 1,
            exportedAt: '2026-05-05T00:00:00.000Z',
            workflow: {
              exportId: 'parent-workflow-export-id',
              name: `Missing workflow dependency ${Date.now()}`,
              description: null,
              type: WorkflowType.conversational,
              schedule: null,
              inputSchema: {},
              layout: {
                x: 0,
                y: 0,
                zoom: 1,
                direction: 'horizontal',
              },
            },
            version: {
              number: 1,
              checksum: 'sha',
              message: null,
              exportedVersionId: 'version-1',
            },
            definitionYml: AgenticWorkflow.stringifyDefinition(
              createCallWorkflowDefinition('missing-workflow-export-id'),
            ),
            resources: {
              memoryDefinitions: [],
              mcpServers: [],
              credentials: [],
              workflows: [],
            },
          },
          { lineWidth: 0 },
        ),
        creatorId,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects definitions requiring missing local bindings or actions', async () => {
    const unknownBindingDefinition = {
      defs: {
        imported_unknown: {
          kind: 'missing-binding',
          settings: {},
        },
      },
      flow: [],
      outputs: {},
    } as unknown as WorkflowDefinition;
    const missingActionDefinition = {
      defs: {
        imported_task: {
          kind: 'task',
          action: 'missing.action',
        },
      },
      flow: [{ do: 'imported_task' }],
      outputs: {},
    } as unknown as WorkflowDefinition;

    await expect(
      transferService.importWorkflow(
        await buildBundleYaml({
          workflowName: `Missing binding workflow ${Date.now()}`,
          memoryExportId: 'eeeeeee1-eeee-4eee-8eee-eeeeeeeeeee1',
          mcpExportId: 'fffffff1-ffff-4fff-8fff-fffffffffff1',
          credentialExportId: null,
          definition: unknownBindingDefinition,
          includeMemoryResources: false,
          includeMcpResources: false,
        }),
        creatorId,
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      transferService.importWorkflow(
        await buildBundleYaml({
          workflowName: `Missing action workflow ${Date.now()}`,
          memoryExportId: '11111112-1111-4111-8111-111111111112',
          mcpExportId: '22222223-2222-4222-8222-222222222223',
          credentialExportId: null,
          definition: missingActionDefinition,
          includeMemoryResources: false,
          includeMcpResources: false,
        }),
        creatorId,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

const buildTaskResourceBundleYaml = ({
  workflowName,
  contentTypeExportId,
  contentTypeName = `Imported content type ${contentTypeExportId}`,
  contentTypeSchema = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      subtitle: { type: 'string' },
    },
  },
  labelGroupExportId,
  labelGroupName = `Imported label group ${labelGroupExportId}`,
  labelExportId,
  labelTitle = `Imported label ${labelExportId}`,
  labelName = `IMPORTED_LABEL_${labelExportId.replace(/[^A-Z0-9]/gi, '_').toUpperCase()}`,
  labelDescription = null,
  includeContentTypeResources = true,
  includeLabelGroupResources = true,
  includeLabelResources = true,
}: {
  workflowName: string;
  contentTypeExportId: string;
  contentTypeName?: string;
  contentTypeSchema?: Record<string, unknown>;
  labelGroupExportId: string;
  labelGroupName?: string;
  labelExportId: string;
  labelTitle?: string;
  labelName?: string;
  labelDescription?: string | null;
  includeContentTypeResources?: boolean;
  includeLabelGroupResources?: boolean;
  includeLabelResources?: boolean;
}) => {
  const definition: WorkflowDefinition = {
    defs: {
      assign_label: {
        kind: 'task',
        action: 'subscriber_update_labels',
        inputs: {
          labels_to_assign: [labelExportId, '=$input.dynamicLabel'],
        },
      },
      send_content: {
        kind: 'task',
        action: 'send_list',
        inputs: {
          content: {
            display: 'list',
            contentType: contentTypeExportId,
            fields: { title: 'title', subtitle: 'subtitle' },
            buttons: [],
            limit: 2,
          },
        },
      },
      retrieve_content: {
        kind: 'task',
        action: 'retrieve_rag_content',
        inputs: {
          query: '=$input.text',
        },
        settings: {
          content_type_id: contentTypeExportId,
        },
      },
    },
    flow: [],
    outputs: { ok: '=true' },
  };

  return stringifyYaml(
    {
      kind: WORKFLOW_EXPORT_BUNDLE_KIND,
      schemaVersion: 1,
      exportedAt: '2026-05-05T00:00:00.000Z',
      workflow: {
        name: workflowName,
        description: null,
        type: WorkflowType.conversational,
        schedule: null,
        inputSchema: {},
        layout: {
          x: 0,
          y: 0,
          zoom: 1,
          direction: 'horizontal',
        },
      },
      version: {
        number: 1,
        checksum: 'sha',
        message: null,
        exportedVersionId: 'version-1',
      },
      definitionYml: AgenticWorkflow.stringifyDefinition(definition),
      resources: {
        memoryDefinitions: [],
        mcpServers: [],
        credentials: [],
        contentTypes: includeContentTypeResources
          ? [
              {
                exportId: contentTypeExportId,
                name: contentTypeName,
                schema: contentTypeSchema,
              },
            ]
          : [],
        labelGroups: includeLabelGroupResources
          ? [
              {
                exportId: labelGroupExportId,
                name: labelGroupName,
              },
            ]
          : [],
        labels: includeLabelResources
          ? [
              {
                exportId: labelExportId,
                title: labelTitle,
                name: labelName,
                description: labelDescription,
                groupExportId: labelGroupExportId,
              },
            ]
          : [],
      },
    },
    { lineWidth: 0 },
  );
};
const buildBundleYaml = async ({
  workflowName,
  memoryExportId,
  mcpExportId,
  credentialExportId,
  memorySlug = `profile_${Date.now()}`,
  memoryName = `Imported profile ${memoryExportId.slice(0, 8)}`,
  mcpName = `Imported MCP ${mcpExportId.slice(0, 8)}`,
  mcpUrl = 'https://mcp.imported.example.com',
  credentialName = credentialExportId
    ? `Imported credential ${credentialExportId.slice(0, 8)}`
    : null,
  definition,
  includeMemoryResources = true,
  includeMcpResources = true,
}: {
  workflowName: string;
  memoryExportId: string;
  mcpExportId: string;
  credentialExportId: string | null;
  memorySlug?: string;
  memoryName?: string;
  mcpName?: string;
  mcpUrl?: string;
  credentialName?: string | null;
  definition?: WorkflowDefinition;
  includeMemoryResources?: boolean;
  includeMcpResources?: boolean;
}) => {
  const bundleDefinition: WorkflowDefinition = definition ?? {
    defs: {
      imported_memory: {
        kind: 'memory',
        settings: { definition_id: memoryExportId },
      },
      imported_mcp: {
        kind: 'mcp',
        settings: { server_id: mcpExportId },
      },
    },
    flow: [],
    outputs: { ok: '=true' },
  };

  return stringifyYaml(
    {
      kind: WORKFLOW_EXPORT_BUNDLE_KIND,
      schemaVersion: 1,
      exportedAt: '2026-05-05T00:00:00.000Z',
      workflow: {
        name: workflowName,
        description: null,
        type: WorkflowType.conversational,
        schedule: null,
        inputSchema: {},
        layout: {
          x: 0,
          y: 0,
          zoom: 1,
          direction: 'horizontal',
        },
      },
      version: {
        number: 1,
        checksum: 'sha',
        message: null,
        exportedVersionId: 'version-1',
      },
      definitionYml: AgenticWorkflow.stringifyDefinition(bundleDefinition),
      resources: {
        memoryDefinitions: includeMemoryResources
          ? [
              {
                exportId: memoryExportId,
                name: memoryName,
                slug: memorySlug,
                scope: MemoryScope.workflow,
                schema: { type: 'object' },
                ttlSeconds: null,
              },
            ]
          : [],
        mcpServers: includeMcpResources
          ? [
              {
                exportId: mcpExportId,
                name: mcpName,
                enabled: true,
                transport: McpServerTransport.http,
                url: mcpUrl,
                command: null,
                args: null,
                cwd: null,
                credentialExportId,
              },
            ]
          : [],
        credentials: credentialExportId
          ? [
              {
                exportId: credentialExportId,
                name: credentialName,
              },
            ]
          : [],
      },
    },
    { lineWidth: 0 },
  );
};
