/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { Request } from 'express';

import { UuidParam } from '@/utils';

import { ApiTokenCreateDto } from '../dto/api-token.dto';
import { ApiTokenService } from '../services/api-token.service';
import { requireSessionUserId } from '../utils/authenticated-user';

@Controller('api-token')
export class ApiTokenController {
  constructor(private readonly apiTokenService: ApiTokenService) {}

  @Get()
  async list(@Req() req: Request) {
    return await this.apiTokenService.findOwnedApiTokens(
      requireSessionUserId(req),
    );
  }

  @Get('scopes')
  async scopes(@Req() req: Request) {
    return await this.apiTokenService.listAvailableScopes(
      requireSessionUserId(req),
    );
  }

  @Post()
  async create(@Body() dto: ApiTokenCreateDto, @Req() req: Request) {
    return await this.apiTokenService.createApiToken(
      requireSessionUserId(req),
      dto,
    );
  }

  @Post(':id/revoke')
  @HttpCode(200)
  async revoke(@UuidParam('id') id: string, @Req() req: Request) {
    return await this.apiTokenService.revokeOwnedApiToken(
      requireSessionUserId(req),
      id,
    );
  }
}
