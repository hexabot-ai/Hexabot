/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { McpToken, User } from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';

import {
  ApiTokenService,
  MCP_PERSONAL_TOKEN_PREFIX,
} from '@/user/services/api-token.service';

import { McpTokenCreateDto } from '../dto/mcp-token.dto';

@Injectable()
export class McpTokenService {
  constructor(private readonly apiTokenService: ApiTokenService) {}

  async createPersonalToken(
    ownerId: string,
    dto: McpTokenCreateDto,
  ): Promise<{ token: string; record: McpToken }> {
    return await this.apiTokenService.createMcpToken(ownerId, dto);
  }

  async findOwnedTokens(ownerId: string): Promise<McpToken[]> {
    return await this.apiTokenService.findOwnedMcpTokens(ownerId);
  }

  async revokeOwnedToken(ownerId: string, id: string): Promise<McpToken> {
    return await this.apiTokenService.revokeOwnedMcpToken(ownerId, id);
  }

  async authenticateBearerToken(
    token: string,
  ): Promise<{ user: User; tokenId: string }> {
    return await this.apiTokenService.authenticateMcpBearerToken(token);
  }
}

export { MCP_PERSONAL_TOKEN_PREFIX };
