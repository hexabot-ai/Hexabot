/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { type WorkflowExportBundleCredential } from '@hexabot-ai/types';
import { ConflictException, Injectable } from '@nestjs/common';
import { In } from 'typeorm';

import { CredentialOrmEntity } from '@/user/entities/credential.entity';
import { CredentialService } from '@/user/services/credential.service';

import {
  WorkflowTransferAdapter,
  WorkflowTransferExportContext,
  WorkflowTransferImportContext,
  WorkflowTransferImportResults,
  WorkflowTransferResourceAdapter,
} from '../workflow-transfer-resource-adapter';
import {
  findAllForExport,
  PLACEHOLDER_CREDENTIAL_VALUE,
  type WorkflowTransferCredentialResource,
  type WorkflowTransferImportAdapterResult,
} from '../workflow-transfer.types';

@WorkflowTransferAdapter()
@Injectable()
export class CredentialTransferAdapter extends WorkflowTransferResourceAdapter {
  override readonly kind = 'credential';

  override readonly resourceKeys = ['credentials'];

  constructor(private readonly credentialService: CredentialService) {
    super();
  }

  override async buildExportResources(
    ctx: WorkflowTransferExportContext,
  ): Promise<Record<string, WorkflowExportBundleCredential[]>> {
    return {
      credentials: await this.buildCredentialExportResources(
        ctx.getRefs(this.kind),
        ctx.includeCredentials,
      ),
    };
  }

  private async buildCredentialExportResources(
    ids: string[],
    includeCredentials: boolean,
  ): Promise<WorkflowTransferCredentialResource[]> {
    const credentials = await findAllForExport('credential', ids, (uniqueIds) =>
      this.credentialService.find({ where: { id: In(uniqueIds) } }),
    );

    return await Promise.all(
      credentials.map(async (credential) => ({
        exportId: credential.id,
        name: credential.name,
        exportedOwnerId: credential.owner,
        ...(includeCredentials
          ? { value: await this.credentialService.findOneValue(credential.id) }
          : {}),
      })),
    );
  }

  override async importResources(
    ctx: WorkflowTransferImportContext,
  ): Promise<WorkflowTransferImportAdapterResult> {
    const credentials =
      ctx.getResources<WorkflowTransferCredentialResource>('credentials');
    const results = new WorkflowTransferImportResults(this.kind);
    const placeholderExportIds = new Set<string>();

    for (const credential of credentials) {
      const existingByName = await ctx.manager.findOne(CredentialOrmEntity, {
        where: { name: credential.name },
        relations: ['owner'],
      });

      if (existingByName) {
        const existingOwnerId =
          existingByName.owner && typeof existingByName.owner === 'object'
            ? existingByName.owner.id
            : null;
        if (existingOwnerId !== ctx.ownerId) {
          throw new ConflictException(
            `Credential "${credential.name}" already exists for another user`,
          );
        }

        results.reused(credential, existingByName.id);
        continue;
      }

      const isPlaceholder =
        !credential.value || credential.value === PLACEHOLDER_CREDENTIAL_VALUE;
      const payload = {
        name: credential.name,
        value: isPlaceholder ? PLACEHOLDER_CREDENTIAL_VALUE : credential.value,
        owner: { id: ctx.ownerId },
      };
      const created = await ctx.manager.save(
        CredentialOrmEntity,
        ctx.manager.create(CredentialOrmEntity, payload),
      );

      results.created(
        credential,
        created,
        payload,
        isPlaceholder ? 'placeholder_created' : 'created',
      );
      if (isPlaceholder) {
        placeholderExportIds.add(credential.exportId);
        results.warn(
          `Credential "${credential.name}" was imported as a placeholder and must be updated before use.`,
        );
      }
    }

    return results.toResult({ placeholderExportIds });
  }
}
