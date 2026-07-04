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
  type WorkflowExportBundle,
  type WorkflowExportBundleWorkflowDependency,
  type WorkflowFull,
  type WorkflowImportResult,
  type WorkflowVersion,
  workflowExportBundleSchema,
  workflowImportResultSchema,
} from '@hexabot-ai/types';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import sanitizeFilename from 'sanitize-filename';
import { DataSource, EntityManager } from 'typeorm';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { EHook } from '@/utils/generics/base-orm.repository';
import { WorkflowOrmEntity } from '@/workflow/entities/workflow.entity';
import { WorkflowVersionService } from '@/workflow/services/workflow-version.service';
import { WorkflowService } from '@/workflow/services/workflow.service';
import { WorkflowVersionAction } from '@/workflow/types';

import { WorkflowTransferAdapterRegistry } from './workflow-transfer-adapter.registry';
import {
  type WorkflowBindingResourceRefs,
  WorkflowTransferDefinitionService,
  type WorkflowTaskResourceRefs,
} from './workflow-transfer-definition.service';
import {
  WorkflowTransferExportContext,
  WorkflowTransferImportContext,
  type WorkflowTransferResourceAdapter,
} from './workflow-transfer-resource-adapter';
import {
  buildResourceResult,
  buildPostCreateEvent,
  type ImportedWorkflowTransferResources,
  type WorkflowTransferPostCreateEvent,
} from './workflow-transfer.types';

type ExportedWorkflowFile = {
  filename: string;
  content: string;
};

type ParsedWorkflowImportSource = {
  exportId?: string;
  workflow: WorkflowExportBundle['workflow'];
  version: WorkflowExportBundle['version'];
  definitionYml: string;
  definition: WorkflowDefinition;
  isRoot: boolean;
};

type ImportedWorkflowSource = ParsedWorkflowImportSource & {
  localId: string;
  localName: string;
  workflowEntity: WorkflowOrmEntity;
  workflowPayload: WorkflowCreateWithManagerPayload;
};

type WorkflowCreateWithManagerPayload = Parameters<
  WorkflowService['createWithManager']
>[1];

const WORKFLOW_RESOURCE_KIND = 'workflow';
const WORKFLOW_RESOURCE_KEY = 'workflows';

@Injectable()
export class WorkflowTransferService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly workflowService: WorkflowService,
    private readonly workflowVersionService: WorkflowVersionService,
    private readonly workflowTransferDefinitionService: WorkflowTransferDefinitionService,
    private readonly workflowTransferAdapterRegistry: WorkflowTransferAdapterRegistry,
  ) {}

  async exportWorkflow(id: string): Promise<ExportedWorkflowFile> {
    const workflow = await this.workflowService.findOneAndPopulate(id);
    if (!workflow) {
      throw new NotFoundException(`Workflow with ID ${id} not found`);
    }

    const version = workflow.currentVersion;
    if (!version?.definitionYml) {
      throw new BadRequestException(
        'Workflow must have a current version to be exported',
      );
    }

    const definition =
      this.workflowTransferDefinitionService.parseWithLocalCatalog(
        version.definitionYml,
      );
    const dependencyExport = await this.buildWorkflowDependencyResources(
      workflow.id,
      definition,
    );
    const { bindingRefs, taskRefs } = this.collectDefinitionResourceRefs([
      definition,
      ...dependencyExport.definitions,
    ]);
    const resources = await this.buildExportResources(
      this.withoutResourceKind(bindingRefs, WORKFLOW_RESOURCE_KIND),
      this.withoutResourceKind(taskRefs, WORKFLOW_RESOURCE_KIND),
    );
    (resources as Record<string, unknown[]>)[WORKFLOW_RESOURCE_KEY] =
      dependencyExport.resources;
    const bundle: WorkflowExportBundle = {
      kind: WORKFLOW_EXPORT_BUNDLE_KIND,
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      workflow: {
        exportId: workflow.id,
        name: workflow.name,
        description: workflow.description ?? null,
        type: workflow.type,
        schedule: workflow.schedule ?? null,
        inputSchema: workflow.inputSchema,
        layout: {
          x: workflow.x,
          y: workflow.y,
          zoom: workflow.zoom,
          direction: workflow.direction,
        },
      },
      version: {
        number: version.version,
        checksum: version.checksum,
        message: version.message ?? null,
        exportedVersionId: version.id,
      },
      definitionYml: version.definitionYml,
      resources,
    };

    return {
      filename: this.buildExportFilename(workflow.name),
      content: stringifyYaml(workflowExportBundleSchema.parse(bundle), {
        lineWidth: 0,
      }),
    };
  }

  async importWorkflow(
    content: string,
    createdBy: string,
  ): Promise<WorkflowImportResult> {
    const bundle = this.parseBundle(content);
    this.assertUniqueWorkflowExportIds(bundle);
    const definition =
      this.workflowTransferDefinitionService.parseWithLocalCatalog(
        bundle.definitionYml,
      );
    const sources = this.parseWorkflowImportSources(bundle, definition);
    const { bindingRefs, taskRefs } = this.collectDefinitionResourceRefs(
      sources.map((source) => source.definition),
    );

    this.assertBundleResourceBucketsAreSupported(bundle.resources);
    this.assertBundleContainsReferencedResources(bundle, bindingRefs, taskRefs);

    const { workflowId, resources, warnings, postCreateEvents } =
      await this.dataSource.transaction(async (manager) => {
        const importedResources = await this.importResources(
          manager,
          bundle.resources,
          createdBy,
        );
        const importedWorkflows = await this.importWorkflowDefinitions(
          manager,
          sources,
          importedResources,
          createdBy,
        );

        return {
          workflowId: importedWorkflows.rootWorkflowId,
          resources: [
            ...importedResources.resources,
            ...importedWorkflows.resources,
          ],
          warnings: importedResources.warnings,
          postCreateEvents: [
            ...importedResources.postCreateEvents,
            ...importedWorkflows.postCreateEvents,
          ],
        };
      });
    await this.emitPostCreateEvents(postCreateEvents);

    const workflow = await this.workflowService.findOne(workflowId);
    if (!workflow) {
      throw new Error(`Unable to load imported workflow ${workflowId}`);
    }

    return workflowImportResultSchema.parse({
      workflow,
      resources,
      warnings,
    });
  }

  private parseBundle(content: string): WorkflowExportBundle {
    let parsed: unknown;
    try {
      parsed = parseYaml(content);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid workflow bundle YAML',
      );
    }

    const validation = workflowExportBundleSchema.safeParse(parsed);
    if (!validation.success) {
      throw new BadRequestException(
        validation.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
      );
    }

    return validation.data;
  }

  private async buildWorkflowDependencyResources(
    rootWorkflowId: string,
    rootDefinition: WorkflowDefinition,
  ): Promise<{
    resources: WorkflowExportBundleWorkflowDependency[];
    definitions: WorkflowDefinition[];
  }> {
    const resources: WorkflowExportBundleWorkflowDependency[] = [];
    const definitions: WorkflowDefinition[] = [];
    const visitedWorkflowIds = new Set<string>([rootWorkflowId]);
    const pendingWorkflowIds = [
      ...this.getWorkflowRefsFromDefinition(rootDefinition),
    ];

    for (let index = 0; index < pendingWorkflowIds.length; index += 1) {
      const workflowId = pendingWorkflowIds[index];
      if (visitedWorkflowIds.has(workflowId)) {
        continue;
      }
      visitedWorkflowIds.add(workflowId);

      const { workflow, version } =
        await this.loadWorkflowDependencyForExport(workflowId);
      const definition =
        this.workflowTransferDefinitionService.parseWithLocalCatalog(
          version.definitionYml,
        );

      resources.push(
        this.buildWorkflowDependencyExportResource(workflow, version),
      );
      definitions.push(definition);
      pendingWorkflowIds.push(
        ...this.getWorkflowRefsFromDefinition(definition),
      );
    }

    return { resources, definitions };
  }

  private async loadWorkflowDependencyForExport(
    workflowId: string,
  ): Promise<{ workflow: WorkflowFull; version: WorkflowVersion }> {
    const workflow = await this.workflowService.findOneAndPopulate(workflowId);
    if (!workflow) {
      throw new BadRequestException(
        `Unable to export workflow: missing workflow(s): ${workflowId}`,
      );
    }

    const version = workflow.currentVersion;
    if (!version?.definitionYml) {
      throw new BadRequestException(
        `Called workflow "${workflow.name}" must have a current version to be exported`,
      );
    }

    return { workflow, version };
  }

  private buildWorkflowDependencyExportResource(
    workflow: WorkflowFull,
    version: WorkflowVersion,
  ): WorkflowExportBundleWorkflowDependency {
    const { exportId: _exportId, ...workflowMetadata } =
      this.buildWorkflowExportMetadata(workflow);

    return {
      exportId: workflow.id,
      workflow: workflowMetadata,
      version: this.buildWorkflowVersionExportMetadata(version),
      definitionYml: version.definitionYml,
    };
  }

  private buildWorkflowExportMetadata(
    workflow: WorkflowFull,
  ): WorkflowExportBundle['workflow'] {
    return {
      exportId: workflow.id,
      name: workflow.name,
      description: workflow.description ?? null,
      type: workflow.type,
      schedule: workflow.schedule ?? null,
      inputSchema: workflow.inputSchema,
      layout: {
        x: workflow.x,
        y: workflow.y,
        zoom: workflow.zoom,
        direction: workflow.direction,
      },
    };
  }

  private buildWorkflowVersionExportMetadata(
    version: WorkflowVersion,
  ): WorkflowExportBundle['version'] {
    return {
      number: version.version,
      checksum: version.checksum,
      message: version.message ?? null,
      exportedVersionId: version.id,
    };
  }

  private getWorkflowRefsFromDefinition(
    definition: WorkflowDefinition,
  ): string[] {
    return (
      this.workflowTransferDefinitionService.collectTaskResourceRefs(
        definition,
      )[WORKFLOW_RESOURCE_KIND] ?? []
    );
  }

  private collectDefinitionResourceRefs(definitions: WorkflowDefinition[]): {
    bindingRefs: WorkflowBindingResourceRefs;
    taskRefs: WorkflowTaskResourceRefs;
  } {
    let bindingRefs: WorkflowBindingResourceRefs = {};
    let taskRefs: WorkflowTaskResourceRefs = {};

    for (const definition of definitions) {
      bindingRefs = this.mergeResourceRefs(
        bindingRefs,
        this.workflowTransferDefinitionService.collectBindingResourceRefs(
          definition,
        ),
      );
      taskRefs = this.mergeResourceRefs(
        taskRefs,
        this.workflowTransferDefinitionService.collectTaskResourceRefs(
          definition,
        ),
      );
    }

    return {
      bindingRefs,
      taskRefs,
    };
  }

  private parseWorkflowImportSources(
    bundle: WorkflowExportBundle,
    rootDefinition: WorkflowDefinition,
  ): ParsedWorkflowImportSource[] {
    return [
      {
        exportId: bundle.workflow.exportId,
        workflow: bundle.workflow,
        version: bundle.version,
        definitionYml: bundle.definitionYml,
        definition: rootDefinition,
        isRoot: true,
      },
      ...bundle.resources.workflows.map((resource) => ({
        exportId: resource.exportId,
        workflow: resource.workflow,
        version: resource.version,
        definitionYml: resource.definitionYml,
        definition:
          this.workflowTransferDefinitionService.parseWithLocalCatalog(
            resource.definitionYml,
          ),
        isRoot: false,
      })),
    ];
  }

  private assertUniqueWorkflowExportIds(bundle: WorkflowExportBundle): void {
    const seen = new Set<string>();
    const exportIds = [
      bundle.workflow.exportId,
      ...bundle.resources.workflows.map((workflow) => workflow.exportId),
    ].filter((id): id is string => typeof id === 'string' && id.length > 0);

    for (const exportId of exportIds) {
      if (seen.has(exportId)) {
        throw new BadRequestException(
          `Workflow bundle contains duplicate workflow export ID "${exportId}"`,
        );
      }
      seen.add(exportId);
    }
  }

  private async importWorkflowDefinitions(
    manager: EntityManager,
    sources: ParsedWorkflowImportSource[],
    importedResources: ImportedWorkflowTransferResources,
    createdBy: string,
  ): Promise<{
    rootWorkflowId: string;
    resources: WorkflowImportResult['resources'];
    postCreateEvents: WorkflowTransferPostCreateEvent[];
  }> {
    const importedWorkflows: ImportedWorkflowSource[] = [];
    const workflowIdMap: Record<string, string> = {};
    const resources: WorkflowImportResult['resources'] = [];
    const postCreateEvents: WorkflowTransferPostCreateEvent[] = [];

    for (const source of sources) {
      const localName = await this.buildImportedWorkflowName(
        manager,
        source.workflow.name,
      );
      const workflowPayload = this.buildImportedWorkflowPayload(
        source.workflow,
        localName,
        createdBy,
      );
      const workflowEntity = await this.workflowService.createWithManager(
        manager,
        workflowPayload,
      );

      if (source.exportId) {
        workflowIdMap[source.exportId] = workflowEntity.id;
      }
      if (!source.isRoot && source.exportId) {
        resources.push(
          buildResourceResult({
            kind: WORKFLOW_RESOURCE_KIND,
            exportId: source.exportId,
            localId: workflowEntity.id,
            name: localName,
            action: 'created',
          }),
        );
      }

      postCreateEvents.push(
        buildPostCreateEvent('workflow', workflowEntity, workflowPayload),
      );
      importedWorkflows.push({
        ...source,
        localId: workflowEntity.id,
        localName,
        workflowEntity,
        workflowPayload,
      });
    }

    for (const importedWorkflow of importedWorkflows) {
      const definitionYml = this.buildImportedDefinitionYml(
        importedWorkflow.definition,
        importedResources,
        workflowIdMap,
      );
      const workflowVersionPayload = {
        workflow: importedWorkflow.localId,
        definitionYml,
        action: WorkflowVersionAction.import,
        message:
          importedWorkflow.version.message ??
          `Imported from workflow version ${importedWorkflow.version.number}`,
        parentVersion: null,
        createdBy,
      };
      const workflowVersion =
        await this.workflowVersionService.createSnapshotWithManager(
          manager,
          workflowVersionPayload,
        );

      // The version's lifecycle hook moved the workflow's currentVersion
      // pointer on a separately-loaded row; mirror it on the in-memory entity
      // so the deferred workflow postCreate event carries the final pointer.
      importedWorkflow.workflowEntity.currentVersion = workflowVersion;

      postCreateEvents.push(
        buildPostCreateEvent(
          'workflowVersion',
          workflowVersion,
          workflowVersionPayload,
        ),
      );
    }

    const rootWorkflow = importedWorkflows.find((workflow) => workflow.isRoot);
    if (!rootWorkflow) {
      throw new Error('Imported workflow bundle is missing a root workflow');
    }

    return {
      rootWorkflowId: rootWorkflow.localId,
      resources,
      postCreateEvents,
    };
  }

  private buildImportedWorkflowPayload(
    workflow: WorkflowExportBundle['workflow'],
    name: string,
    createdBy: string,
  ): WorkflowCreateWithManagerPayload {
    return {
      name,
      description: workflow.description ?? undefined,
      type: workflow.type,
      schedule: workflow.schedule,
      inputSchema: workflow.inputSchema,
      builtin: false,
      x: workflow.layout.x,
      y: workflow.layout.y,
      zoom: workflow.layout.zoom,
      direction: workflow.layout.direction,
      createdBy,
    };
  }

  private buildImportedDefinitionYml(
    definition: WorkflowDefinition,
    importedResources: ImportedWorkflowTransferResources,
    workflowIdMap: Record<string, string>,
  ): string {
    const remappedBindingDefinition =
      this.workflowTransferDefinitionService.remapBindingResourceRefs(
        definition,
        importedResources.bindingIdMaps,
      );
    const remappedDefinition =
      this.workflowTransferDefinitionService.remapTaskResourceRefs(
        remappedBindingDefinition,
        {
          ...importedResources.taskIdMaps,
          [WORKFLOW_RESOURCE_KIND]: workflowIdMap,
        },
      );
    const definitionYml =
      AgenticWorkflow.stringifyDefinition(remappedDefinition);

    this.workflowTransferDefinitionService.parseWithLocalCatalog(definitionYml);

    return definitionYml;
  }

  private async buildExportResources(
    bindingRefs: WorkflowBindingResourceRefs,
    taskRefs: WorkflowTaskResourceRefs,
  ): Promise<WorkflowExportBundle['resources']> {
    const resources = this.createEmptyResourceBuckets();
    const exportContext = new WorkflowTransferExportContext(
      this.mergeResourceRefs(bindingRefs, taskRefs),
    );

    for (const adapter of this.workflowTransferAdapterRegistry.listInReverseDependencyOrder()) {
      const adapterResources =
        await adapter.buildExportResources(exportContext);
      this.mergeAdapterResources(resources, adapter, adapterResources);
    }

    return resources as WorkflowExportBundle['resources'];
  }

  private assertBundleContainsReferencedResources(
    bundle: WorkflowExportBundle,
    refs: WorkflowBindingResourceRefs,
    taskRefs: WorkflowTaskResourceRefs,
  ): void {
    const mergedRefs = this.mergeResourceRefs(refs, taskRefs);
    const workflowRefs = mergedRefs[WORKFLOW_RESOURCE_KIND] ?? [];

    if (workflowRefs.length > 0) {
      this.assertRefsAreBundled(
        WORKFLOW_RESOURCE_KIND,
        workflowRefs,
        this.getBundledWorkflowExportIds(bundle),
      );
    }

    for (const [kind, resourceRefs] of Object.entries(
      this.withoutResourceKind(mergedRefs, WORKFLOW_RESOURCE_KIND),
    )) {
      if (resourceRefs.length === 0) {
        continue;
      }

      const adapter = this.workflowTransferAdapterRegistry.get(kind);
      if (!adapter) {
        throw new BadRequestException(
          `Workflow bundle references unsupported resource kind "${kind}"`,
        );
      }

      this.assertRefsAreBundled(
        kind,
        resourceRefs,
        this.getBundledExportIds(bundle.resources, adapter.resourceKeys[0]),
      );
    }
  }

  private assertRefsAreBundled(
    resourceLabel: string,
    refs: string[],
    bundledIds: string[],
  ): void {
    const bundled = new Set(bundledIds);
    const missing = Array.from(new Set(refs)).filter((id) => !bundled.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Workflow bundle is missing referenced ${resourceLabel}(s): ${missing.join(
          ', ',
        )}`,
      );
    }
  }

  private assertBundleResourceBucketsAreSupported(
    resources: WorkflowExportBundle['resources'],
  ): void {
    const supportedResourceKeys = new Set([
      ...this.workflowTransferAdapterRegistry.getResourceKeys(),
      WORKFLOW_RESOURCE_KEY,
    ]);

    for (const [key, value] of Object.entries(
      resources as Record<string, unknown[]>,
    )) {
      if (supportedResourceKeys.has(key) || value.length === 0) {
        continue;
      }

      throw new BadRequestException(
        `Workflow bundle contains unsupported resource section "${key}"`,
      );
    }
  }

  private createEmptyResourceBuckets(): Record<string, unknown[]> {
    return Object.fromEntries(
      this.workflowTransferAdapterRegistry
        .listInDependencyOrder()
        .flatMap((adapter) =>
          adapter.resourceKeys.map((resourceKey) => [
            resourceKey,
            [] as unknown[],
          ]),
        ),
    );
  }

  private mergeAdapterResources(
    resources: Record<string, unknown[]>,
    adapter: WorkflowTransferResourceAdapter,
    adapterResources: Record<string, unknown[]>,
  ): void {
    const declaredResourceKeys = new Set(adapter.resourceKeys);

    for (const [key, value] of Object.entries(adapterResources)) {
      if (!declaredResourceKeys.has(key)) {
        throw new Error(
          `Workflow transfer adapter "${adapter.kind}" returned undeclared resource key "${key}"`,
        );
      }

      if (!Array.isArray(value)) {
        throw new Error(
          `Workflow transfer adapter "${adapter.kind}" returned non-array resources for "${key}"`,
        );
      }

      resources[key] = value;
    }

    for (const resourceKey of adapter.resourceKeys) {
      resources[resourceKey] ??= [];
    }
  }

  private mergeResourceRefs(
    refs: WorkflowBindingResourceRefs,
    taskRefs: WorkflowTaskResourceRefs,
  ): Record<string, string[]> {
    const merged = new Map<string, Set<string>>();

    for (const refSet of [refs, taskRefs]) {
      for (const [kind, ids] of Object.entries(refSet)) {
        const kindRefs = merged.get(kind) ?? new Set<string>();
        for (const id of ids) {
          kindRefs.add(id);
        }
        merged.set(kind, kindRefs);
      }
    }

    return Object.fromEntries(
      Array.from(merged.entries()).map(([kind, ids]) => [
        kind,
        Array.from(ids),
      ]),
    );
  }

  private withoutResourceKind(
    refs: Record<string, string[]>,
    ignoredKind: string,
  ): Record<string, string[]> {
    return Object.fromEntries(
      Object.entries(refs).filter(([kind]) => kind !== ignoredKind),
    );
  }

  private getBundledWorkflowExportIds(bundle: WorkflowExportBundle): string[] {
    return [
      bundle.workflow.exportId,
      ...bundle.resources.workflows.map((workflow) => workflow.exportId),
    ].filter((id): id is string => typeof id === 'string' && id.length > 0);
  }

  private getBundledExportIds(
    resources: WorkflowExportBundle['resources'],
    resourceKey: string,
  ): string[] {
    const resourceBucket = (resources as Record<string, unknown[]>)[
      resourceKey
    ];

    return (resourceBucket ?? []).flatMap((resource) => {
      if (
        typeof resource === 'object' &&
        resource !== null &&
        'exportId' in resource &&
        typeof resource.exportId === 'string'
      ) {
        return [resource.exportId];
      }

      return [];
    });
  }

  private async importResources(
    manager: EntityManager,
    resources: WorkflowExportBundle['resources'],
    ownerId: string,
  ): Promise<ImportedWorkflowTransferResources> {
    const adapters =
      this.workflowTransferAdapterRegistry.listInDependencyOrder();
    const importContext = new WorkflowTransferImportContext(
      manager,
      resources,
      ownerId,
    );

    for (const adapter of adapters) {
      importContext.addResult(
        adapter.kind,
        await adapter.importResources(importContext),
      );
    }

    const results = importContext.getResultsInOrder(
      adapters.map((adapter) => adapter.kind),
    );
    const idMaps = importContext.getIdMaps();

    return {
      bindingIdMaps: idMaps,
      taskIdMaps: idMaps,
      resources: results.flatMap((result) => result.resources),
      warnings: results.flatMap((result) => result.warnings),
      postCreateEvents: results.flatMap((result) => result.postCreateEvents),
    };
  }

  private async emitPostCreateEvents(
    events: WorkflowTransferPostCreateEvent[],
  ): Promise<void> {
    for (const event of events) {
      await this.eventEmitter.emitAsync(`hook:${event.entityName}:postCreate`, {
        action: EHook.postCreate,
        entity: event.entity,
        payload: event.payload,
        entityName: event.entityName,
      });
    }
  }

  private async buildImportedWorkflowName(
    manager: EntityManager,
    sourceName: string,
  ): Promise<string> {
    const baseName = sourceName.trim() || 'Imported workflow';
    const suffixes = [
      '',
      ' (imported)',
      ...Array.from({ length: 999 }, (_, index) => {
        return ` (imported ${index + 2})`;
      }),
    ];

    for (const suffix of suffixes) {
      const normalized = this.truncateWorkflowName(baseName, suffix);
      const existing = await manager.findOne(WorkflowOrmEntity, {
        where: { name: normalized },
      });
      if (!existing) {
        return normalized;
      }
    }

    throw new ConflictException('Unable to generate a unique workflow name');
  }

  private truncateWorkflowName(name: string, suffix = ''): string {
    const maxBaseLength = Math.max(1, 255 - suffix.length);
    const normalizedBase =
      name.length <= maxBaseLength ? name : name.slice(0, maxBaseLength);

    return `${normalizedBase}${suffix}`;
  }

  private buildExportFilename(name: string): string {
    const safeName = sanitizeFilename(name.trim()) || 'workflow';

    return `${safeName}.workflow.yml`;
  }
}
