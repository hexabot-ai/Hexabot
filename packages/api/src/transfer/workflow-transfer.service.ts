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
  isStrongWorkflowCredentialPassword,
  WORKFLOW_EXPORT_BUNDLE_KIND,
  workflowExportBundleSchema,
  workflowImportResultSchema,
  type WorkflowExportBundle,
  type WorkflowExportBundleWorkflowDependency,
  type WorkflowFull,
  type WorkflowImportResult,
  type WorkflowVersion,
  type WebhookTriggerConfig,
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
import { computeIntegrity, verifyIntegrity } from '@/utils/hmac-integrity';
import { WorkflowOrmEntity } from '@/workflow/entities/workflow.entity';
import { upgradeLegacyWorkflowInputs } from '@/workflow/lib/legacy-workflow-inputs';
import { WorkflowVersionService } from '@/workflow/services/workflow-version.service';
import { WorkflowService } from '@/workflow/services/workflow.service';
import { WorkflowType, WorkflowVersionAction } from '@/workflow/types';

import { WorkflowTransferAdapterRegistry } from './workflow-transfer-adapter.registry';
import {
  decryptWorkflowCredentialValues,
  deriveWorkflowCredentialKeys,
  encryptWorkflowCredentialValues,
} from './workflow-transfer-credential-crypto';
import {
  WorkflowTransferDefinitionService,
  type WorkflowBindingResourceRefs,
  type WorkflowTaskResourceRefs,
} from './workflow-transfer-definition.service';
import {
  WorkflowTransferExportContext,
  WorkflowTransferImportContext,
  type WorkflowTransferResourceAdapter,
} from './workflow-transfer-resource-adapter';
import {
  buildPostCreateEvent,
  buildResourceResult,
  type ImportedWorkflowTransferResources,
  type WorkflowTransferCredentialResource,
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

  async exportWorkflow(
    id: string,
    credentialPassword?: string,
  ): Promise<ExportedWorkflowFile> {
    if (
      credentialPassword !== undefined &&
      !isStrongWorkflowCredentialPassword(credentialPassword)
    ) {
      throw new BadRequestException(
        'Credential export password must be at least 12 characters and include uppercase, lowercase, number, and special characters',
      );
    }

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
    bindingRefs.credential = [
      ...(bindingRefs.credential ?? []),
      ...this.collectWebhookCredentialRefs([
        workflow,
        ...dependencyExport.resources.map((resource) => resource.workflow),
      ]),
    ];
    const resources = await this.buildExportResources(
      this.withoutResourceKind(bindingRefs, WORKFLOW_RESOURCE_KIND),
      this.withoutResourceKind(taskRefs, WORKFLOW_RESOURCE_KIND),
      credentialPassword !== undefined,
    );
    (resources as Record<string, unknown[]>)[WORKFLOW_RESOURCE_KEY] =
      dependencyExport.resources;
    const credentialResources =
      resources.credentials as WorkflowTransferCredentialResource[];
    const [credentialProtection, integrityKey] = credentialPassword
      ? await encryptWorkflowCredentialValues(
          credentialResources,
          credentialPassword,
        )
      : [];
    if (credentialProtection) {
      resources.credentials = credentialResources.map(
        ({ value: _value, ...credential }) => credential,
      );
    }
    const bundleContent: Omit<WorkflowExportBundle, 'integrity'> = {
      kind: WORKFLOW_EXPORT_BUNDLE_KIND,
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      workflow: this.buildWorkflowExportMetadata(workflow),
      version: {
        number: version.version,
        checksum: version.checksum,
        message: version.message ?? null,
        exportedVersionId: version.id,
      },
      definitionYml: version.definitionYml,
      credentialProtection,
      resources,
    };
    const bundle = workflowExportBundleSchema.parse({
      ...bundleContent,
      integrity: integrityKey
        ? computeIntegrity(bundleContent, integrityKey)
        : undefined,
    });

    return {
      filename: this.buildExportFilename(
        workflow.name,
        Boolean(credentialProtection),
      ),
      content: stringifyYaml(bundle, {
        lineWidth: 0,
      }),
    };
  }

  async importWorkflow(
    content: string,
    createdBy: string,
    credentialPassword?: string,
  ): Promise<WorkflowImportResult> {
    const parsedBundle = this.parseBundle(content);
    const { bundle: decryptedBundle, integrityVerified } =
      await this.decryptCredentialBundle(parsedBundle, credentialPassword);
    const { bundle, warnings: upgradeWarnings } =
      this.upgradeLegacyBundle(decryptedBundle);
    this.assertUniqueWorkflowExportIds(bundle);
    const definition =
      this.workflowTransferDefinitionService.parseWithLocalCatalog(
        bundle.definitionYml,
      );
    const sources = this.parseWorkflowImportSources(bundle, definition);
    const { bindingRefs, taskRefs } = this.collectDefinitionResourceRefs(
      sources.map((source) => source.definition),
    );
    bindingRefs.credential = [
      ...(bindingRefs.credential ?? []),
      ...this.collectWebhookCredentialRefs(
        sources.map((source) => source.workflow),
      ),
    ];

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
          warnings: [...upgradeWarnings, ...importedResources.warnings],
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
      integrityVerified,
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

  /**
   * Bring the workflows of a bundle exported by v3.6 or earlier to the form
   * definitions have now: such a bundle carries the input schema of a manual
   * workflow beside its definition (`workflow.inputSchema`), and `inputs`
   * as a field map inside it. A bundle already in the new form is returned
   * unchanged.
   *
   * @returns The bundle to import, and what could not be carried over as it
   * was.
   */
  private upgradeLegacyBundle(bundle: WorkflowExportBundle): {
    bundle: WorkflowExportBundle;
    warnings: string[];
  } {
    const warnings: string[] = [];
    const upgrade = <
      T extends {
        workflow: Omit<WorkflowExportBundle['workflow'], 'exportId'>;
        definitionYml: string;
      },
    >(
      source: T,
    ): T => {
      const { inputSchema, ...workflow } = source.workflow;
      const upgraded = upgradeLegacyWorkflowInputs(source.definitionYml, {
        type: workflow.type,
        inputSchema,
      });
      warnings.push(
        ...upgraded.warnings.map(
          (warning) => `Workflow "${workflow.name}": ${warning}.`,
        ),
      );

      return { ...source, workflow, definitionYml: upgraded.definitionYml };
    };

    return {
      bundle: {
        ...upgrade(bundle),
        resources: {
          ...bundle.resources,
          workflows: bundle.resources.workflows.map(upgrade),
        },
      },
      warnings,
    };
  }

  private async decryptCredentialBundle(
    bundle: WorkflowExportBundle,
    credentialPassword?: string,
  ): Promise<{ bundle: WorkflowExportBundle; integrityVerified: boolean }> {
    if (!bundle.credentialProtection) {
      if (bundle.integrity) {
        throw new BadRequestException(
          'Workflow export integrity requires password-protected credentials',
        );
      }

      return { bundle, integrityVerified: false };
    }
    if (!credentialPassword) {
      throw new BadRequestException(
        'A password is required to import encrypted credentials',
      );
    }

    try {
      const [encryptionKey, integrityKey] = await deriveWorkflowCredentialKeys(
        credentialPassword,
        Buffer.from(bundle.credentialProtection.salt, 'base64'),
      );
      const values = decryptWorkflowCredentialValues(
        bundle.credentialProtection,
        encryptionKey,
      );
      if (!verifyIntegrity(bundle, integrityKey)) {
        throw new BadRequestException(
          'Workflow export integrity check failed: the file was modified or corrupted',
        );
      }
      const credentials = bundle.resources.credentials.map((credential) => ({
        ...credential,
        value: values[credential.exportId],
      }));

      return {
        bundle: {
          ...bundle,
          resources: { ...bundle.resources, credentials },
        },
        integrityVerified: true,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        'Unable to decrypt credentials: the password is incorrect or the export file was modified',
      );
    }
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
      ...(workflow.type === WorkflowType.manual
        ? { webhookTrigger: workflow.webhookTrigger ?? null }
        : {}),
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
        importedResources.bindingIdMaps.credential ?? {},
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
    credentialIdMap: Record<string, string>,
  ): WorkflowCreateWithManagerPayload {
    return {
      name,
      description: workflow.description ?? undefined,
      type: workflow.type,
      schedule: workflow.schedule,
      webhookTrigger: this.remapWebhookTrigger(
        workflow.webhookTrigger,
        credentialIdMap,
      ),
      builtin: false,
      x: workflow.layout.x,
      y: workflow.layout.y,
      zoom: workflow.layout.zoom,
      direction: workflow.layout.direction,
      createdBy,
    };
  }

  private collectWebhookCredentialRefs(
    workflows: Array<{ webhookTrigger?: WebhookTriggerConfig | null }>,
  ): string[] {
    return workflows.flatMap(({ webhookTrigger }) => {
      switch (webhookTrigger?.authType) {
        case 'basic':
          return webhookTrigger.passwordCredentialId ?? [];
        case 'header':
          return webhookTrigger.headerValueCredentialId ?? [];
        case 'jwt':
          return webhookTrigger.jwtSecretCredentialId ?? [];
        default:
          return [];
      }
    });
  }

  private remapWebhookTrigger(
    webhookTrigger: WebhookTriggerConfig | null | undefined,
    credentialIdMap: Record<string, string>,
  ): WebhookTriggerConfig | null | undefined {
    if (!webhookTrigger || webhookTrigger.authType === 'none') {
      return webhookTrigger;
    }

    const remap = (exportId: string | null | undefined) => {
      if (!exportId) {
        return exportId;
      }

      const localId = credentialIdMap[exportId];
      if (!localId) {
        throw new BadRequestException(
          `Workflow webhook references missing credential "${exportId}"`,
        );
      }

      return localId;
    };

    switch (webhookTrigger.authType) {
      case 'basic':
        return {
          ...webhookTrigger,
          passwordCredentialId: remap(webhookTrigger.passwordCredentialId),
        };
      case 'header':
        return {
          ...webhookTrigger,
          headerValueCredentialId: remap(
            webhookTrigger.headerValueCredentialId,
          ),
        };
      case 'jwt':
        return {
          ...webhookTrigger,
          jwtSecretCredentialId: remap(webhookTrigger.jwtSecretCredentialId),
        };
    }
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
    includeCredentials: boolean,
  ): Promise<WorkflowExportBundle['resources']> {
    const resources = this.createEmptyResourceBuckets();
    const exportContext = new WorkflowTransferExportContext(
      this.mergeResourceRefs(bindingRefs, taskRefs),
      includeCredentials,
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

  private buildExportFilename(name: string, isProtected: boolean): string {
    const safeName = sanitizeFilename(name.trim()) || 'workflow';
    const prefix = isProtected ? 'protected-' : '';

    return `${prefix}${safeName}.workflow.yml`;
  }
}
