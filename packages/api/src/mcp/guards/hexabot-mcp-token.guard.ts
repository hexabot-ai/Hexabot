/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { extractBearerToken } from '@/user/utils/authenticated-user';

import { McpTokenService } from '../services/mcp-token.service';
import { HexabotMcpRequest } from '../types';

@Injectable()
export class HexabotMcpTokenGuard implements CanActivate {
  constructor(private readonly moduleRef: ModuleRef) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<HexabotMcpRequest>();
    const token = extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('MCP bearer token is required');
    }

    const { user, tokenId } =
      await this.getMcpTokenService().authenticateBearerToken(token);

    // `user` is the slot `@rekog/mcp-nest` owns: it reads `request.user` for
    // tool visibility and its own JWT/OAuth flows overwrite it, so we set it to
    // stay "authenticated" to the library. `hexabotUser` is our own namespaced,
    // type-stable copy that the library never touches; consumers read
    // `hexabotUser ?? user` so they always get a proper Hexabot `User`.
    request.hexabotUser = user;
    request.user = user;
    request.mcpTokenId = tokenId;

    return true;
  }

  private getMcpTokenService(): McpTokenService {
    return this.moduleRef.get(McpTokenService, { strict: false });
  }
}
