/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  type WorkflowExportBundleCredential,
  WorkflowImportResourceResult,
} from '@hexabot-ai/types';
import { BadRequestException } from '@nestjs/common';

import { BaseOrmEntity } from '@/database/entities/base.entity';

/**
 * Workflow transfer persistence contract:
 * - WorkflowTransferService owns the import transaction boundary.
 * - Resource adapters receive EntityManager for transactional writes.
 * - Export reads use owning module services wherever available.
 * - Transfer does not introduce duplicate repositories for owned resources.
 */

export const PLACEHOLDER_CREDENTIAL_VALUE =
  '__HEXABOT_IMPORTED_CREDENTIAL_PLACEHOLDER__';

export type WorkflowTransferCredentialResource =
  WorkflowExportBundleCredential & {
    value?: string;
  };

export type WorkflowTransferPostCreateEvent<
  Entity extends BaseOrmEntity<any> = BaseOrmEntity<any>,
> = {
  entityName: string;
  entity: Entity;
  payload: unknown;
};

export type WorkflowTransferImportAdapterResult = {
  idMap: Record<string, string>;
  resources: WorkflowImportResourceResult[];
  warnings: string[];
  postCreateEvents: WorkflowTransferPostCreateEvent[];
  metadata?: Record<string, unknown>;
};

export type WorkflowTransferResourceIdMaps = Record<
  string,
  Record<string, string>
>;

export type ImportedWorkflowTransferResources = {
  bindingIdMaps: WorkflowTransferResourceIdMaps;
  taskIdMaps: WorkflowTransferResourceIdMaps;
  resources: WorkflowImportResourceResult[];
  warnings: string[];
  postCreateEvents: WorkflowTransferPostCreateEvent[];
};

type ResourceActionInput = Omit<WorkflowImportResourceResult, 'localId'> & {
  localId?: string;
};

export const uniqueResourceIds = (ids: string[]): string[] => {
  return Array.from(new Set(ids));
};

export const assertFoundAll = (
  resourceLabel: string,
  expectedIds: string[],
  foundIds: string[],
): void => {
  const found = new Set(foundIds);
  const missing = expectedIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new BadRequestException(
      `Unable to export workflow: missing ${resourceLabel}(s): ${missing.join(
        ', ',
      )}`,
    );
  }
};

/**
 * Loads the resources an export references, each once.
 *
 * @param resourceLabel - Name of the resource kind in the error message.
 * @param ids - Ids of the referenced resources, possibly repeated.
 * @param findByIds - Loads the resources of the given unique ids.
 * @throws BadRequestException when one of them no longer exists.
 */
export const findAllForExport = async <Resource extends { id: string }>(
  resourceLabel: string,
  ids: string[],
  findByIds: (uniqueIds: string[]) => Promise<Resource[]>,
): Promise<Resource[]> => {
  const uniqueIds = uniqueResourceIds(ids);
  if (uniqueIds.length === 0) {
    return [];
  }

  const resources = await findByIds(uniqueIds);
  assertFoundAll(
    resourceLabel,
    uniqueIds,
    resources.map(({ id }) => id),
  );

  return resources;
};

export const buildResourceResult = (
  input: ResourceActionInput,
): WorkflowImportResourceResult => {
  if (!input.localId) {
    throw new Error(`Missing local ID for imported ${input.kind}`);
  }

  return {
    kind: input.kind,
    exportId: input.exportId,
    localId: input.localId,
    name: input.name,
    action: input.action,
  };
};

export const buildPostCreateEvent = <Entity extends BaseOrmEntity<any>>(
  entityName: string,
  entity: Entity,
  payload: unknown,
): WorkflowTransferPostCreateEvent<Entity> => {
  return { entityName, entity, payload };
};
