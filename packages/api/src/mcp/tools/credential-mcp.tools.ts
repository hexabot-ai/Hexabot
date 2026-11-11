/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action } from '@hexabot-ai/types';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';

import { CredentialService } from '@/user/services/credential.service';

import { McpPermission } from '../decorators/mcp-permission.decorator';
import { HexabotMcpRequest } from '../types';

import { HexabotMcpToolBase } from './hexabot-mcp-tool.base';
import {
  PaginationArgs,
  paginationSchema,
  uuidSchema,
} from './hexabot-mcp.schemas';
import { sanitizeCredential } from './hexabot-mcp.utils';

@Injectable()
export class HexabotCredentialMcpTools extends HexabotMcpToolBase {
  constructor(private readonly credentialService: CredentialService) {
    super();
  }

  @McpPermission('credential', Action.READ)
  @Tool({
    name: 'hexabot_credential_search',
    description:
      'Search credentials by metadata only. Secret credential values are never returned.',
    parameters: z.object({
      query: z.string().optional(),
      ownerId: uuidSchema.optional(),
      ...paginationSchema,
    }),
  })
  async searchCredentials(
    args: { query?: string; ownerId?: string } & PaginationArgs,
  ) {
    const where = {
      ...(args.ownerId ? { owner: { id: args.ownerId } } : {}),
      ...(args.query ? { name: this.contains(args.query) } : {}),
    } as any;
    const result = await this.listWithCount(
      this.credentialService,
      this.findOptions(args, where),
    );

    return {
      ...result,
      items: result.items.map((credential) =>
        sanitizeCredential(credential as Record<string, unknown>),
      ),
    };
  }

  @McpPermission('credential', Action.READ)
  @Tool({
    name: 'hexabot_credential_get',
    description:
      'Read credential metadata. Secret credential values are never returned.',
    parameters: z.object({
      id: uuidSchema,
    }),
  })
  async getCredential(args: { id: string }) {
    const credential = await this.credentialService.findOneAndPopulate(args.id);
    if (!credential) {
      throw new NotFoundException(`Credential ${args.id} not found`);
    }

    return sanitizeCredential(credential as Record<string, unknown>);
  }

  @McpPermission('credential', Action.CREATE)
  @Tool({
    name: 'hexabot_credential_create',
    description:
      'Store a secret (API key, token, password, connection string) as a credential owned by the MCP token user. Workflows, MCP servers and webhook triggers reference it by id. The value is write-only: no tool ever returns it.',
    parameters: z.object({
      name: z.string().min(1),
      value: z.string().min(1),
    }),
  })
  async createCredential(
    args: { name: string; value: string },
    _context: unknown,
    request?: HexabotMcpRequest,
  ) {
    const owner = this.getActorId(request);
    await this.assertNameAvailable(args.name);
    const credential = await this.credentialService.create({
      ...args,
      owner,
    });

    return sanitizeCredential(credential as Record<string, unknown>);
  }

  @McpPermission('credential', Action.UPDATE)
  @Tool({
    name: 'hexabot_credential_update',
    description:
      'Rename a credential or replace its secret value. The value is write-only: no tool ever returns it.',
    parameters: z.object({
      id: uuidSchema,
      name: z.string().min(1).optional(),
      value: z.string().min(1).optional(),
    }),
  })
  async updateCredential(args: { id: string; name?: string; value?: string }) {
    const { id, ...updates } = args;
    if (updates.name === undefined && updates.value === undefined) {
      throw new BadRequestException('Provide a new name or value to update');
    }

    const credential = await this.credentialService.findOne(id);
    if (!credential) {
      throw new NotFoundException(`Credential ${id} not found`);
    }
    if (updates.name !== undefined && updates.name !== credential.name) {
      await this.assertNameAvailable(updates.name);
    }

    return sanitizeCredential(
      (await this.credentialService.updateOne(id, updates)) as Record<
        string,
        unknown
      >,
    );
  }

  /**
   * Refuse a name another credential has, with a message the client can act
   * on instead of the database's unique constraint error.
   */
  private async assertNameAvailable(name: string) {
    if (await this.credentialService.findOne({ where: { name } })) {
      throw new ConflictException(
        `A credential named "${name}" already exists`,
      );
    }
  }
}
