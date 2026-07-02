/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { createHash, randomBytes } from 'crypto';

import {
  Action,
  ApiToken,
  ApiTokenScope,
  ApiTokenType,
  McpToken,
  TModel,
  User,
  apiTokenScopeSchema,
  mcpTokenSchema,
} from '@hexabot-ai/types';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { BaseOrmService } from '@/utils/generics/base-orm.service';

import { ApiTokenCreateDto } from '../dto/api-token.dto';
import { ApiTokenOrmEntity } from '../entities/api-token.entity';
import { UserOrmEntity } from '../entities/user.entity';
import { ApiTokenRepository } from '../repositories/api-token.repository';

import { PermissionService } from './permission.service';
import { UserService } from './user.service';

export const API_PERSONAL_TOKEN_PREFIX = 'hbt_api_';

export const MCP_PERSONAL_TOKEN_PREFIX = 'hbt_mcp_';

/**
 * Minimum interval between `lastUsedAt` writes for a single token. Bearer
 * tokens are verified on every request, so persisting the timestamp each time
 * would add a DB write to the hot path; a coarse "last used" is enough.
 */
const LAST_USED_THROTTLE_MS = 60_000;

@Injectable()
export class ApiTokenService extends BaseOrmService<ApiTokenOrmEntity> {
  constructor(
    readonly repository: ApiTokenRepository,
    private readonly userService: UserService,
    private readonly permissionService: PermissionService,
  ) {
    super(repository);
  }

  async createApiToken(
    ownerId: string,
    dto: ApiTokenCreateDto,
  ): Promise<{ token: string; record: ApiToken }> {
    const scopes = await this.normalizeAndValidateScopes(ownerId, dto.scopes);

    return await this.createPersonalToken(ownerId, {
      name: dto.name,
      expiresAt: dto.expiresAt,
      scopes,
      tokenType: ApiTokenType.API,
      prefix: API_PERSONAL_TOKEN_PREFIX,
    });
  }

  async createMcpToken(
    ownerId: string,
    dto: { name: string; expiresAt?: string | null },
  ): Promise<{ token: string; record: McpToken }> {
    const result = await this.createPersonalToken(ownerId, {
      name: dto.name,
      expiresAt: dto.expiresAt,
      scopes: [],
      tokenType: ApiTokenType.MCP,
      prefix: MCP_PERSONAL_TOKEN_PREFIX,
    });

    return { token: result.token, record: mcpTokenSchema.parse(result.record) };
  }

  async findOwnedApiTokens(ownerId: string): Promise<ApiToken[]> {
    return await this.findOwnedTokens(ownerId, ApiTokenType.API);
  }

  async findOwnedMcpTokens(ownerId: string): Promise<McpToken[]> {
    const tokens = await this.findOwnedTokens(ownerId, ApiTokenType.MCP);

    return tokens.map((token) => mcpTokenSchema.parse(token));
  }

  async revokeOwnedApiToken(ownerId: string, id: string): Promise<ApiToken> {
    return await this.revokeOwnedToken(ownerId, id, ApiTokenType.API);
  }

  async revokeOwnedMcpToken(ownerId: string, id: string): Promise<McpToken> {
    const token = await this.revokeOwnedToken(ownerId, id, ApiTokenType.MCP);

    return mcpTokenSchema.parse(token);
  }

  async listAvailableScopes(ownerId: string): Promise<ApiTokenScope[]> {
    const user = await this.findActiveOwner(ownerId);

    return this.getAllowedScopes(user);
  }

  async authenticateApiBearerToken(
    token: string,
  ): Promise<{ user: User; tokenId: string; scopes: ApiTokenScope[] }> {
    const record = await this.authenticateBearerToken(
      token,
      ApiTokenType.API,
      API_PERSONAL_TOKEN_PREFIX,
      'API token',
    );

    return {
      user: (record.owner as UserOrmEntity).toPlainCls() as User,
      tokenId: record.id,
      scopes: this.normalizeScopes(record.scopes),
    };
  }

  async authenticateMcpBearerToken(
    token: string,
  ): Promise<{ user: User; tokenId: string }> {
    const record = await this.authenticateBearerToken(
      token,
      ApiTokenType.MCP,
      MCP_PERSONAL_TOKEN_PREFIX,
      'MCP token',
    );

    return {
      user: (record.owner as UserOrmEntity).toPlainCls() as User,
      tokenId: record.id,
    };
  }

  async hasTokenScope(
    requestToken: { scopes?: ApiTokenScope[] } | undefined,
    model: TModel,
    action: Action,
  ): Promise<boolean> {
    if (!requestToken) {
      return true;
    }

    return this.normalizeScopes(requestToken.scopes).some(
      (scope) => scope.model === model && scope.action === action,
    );
  }

  async assertTokenScope(
    requestToken: { scopes?: ApiTokenScope[] } | undefined,
    model: TModel,
    action: Action,
  ): Promise<void> {
    const allowed = await this.hasTokenScope(requestToken, model, action);
    if (!allowed) {
      throw new ForbiddenException(
        `API token requires ${action} scope on ${model}`,
      );
    }
  }

  private async createPersonalToken(
    ownerId: string,
    params: {
      name: string;
      expiresAt?: string | null;
      scopes: ApiTokenScope[];
      tokenType: ApiTokenType;
      prefix: string;
    },
  ): Promise<{ token: string; record: ApiToken }> {
    const token = this.generateToken(params.prefix);
    const expiresAt = this.parseOptionalExpiry(params.expiresAt);
    const record = await this.repository.create({
      name: params.name,
      owner: ownerId,
      tokenHash: this.hashToken(token),
      tokenPrefix: this.getTokenPrefix(token, params.prefix),
      tokenType: params.tokenType,
      scopes: params.scopes,
      expiresAt,
      lastUsedAt: null,
      revokedAt: null,
    });

    return { token, record };
  }

  private async findOwnedTokens(
    ownerId: string,
    tokenType: ApiTokenType,
  ): Promise<ApiToken[]> {
    return await this.repository.find({
      where: { owner: { id: ownerId }, tokenType },
      order: { createdAt: 'DESC' },
    });
  }

  private async revokeOwnedToken(
    ownerId: string,
    id: string,
    tokenType: ApiTokenType,
  ): Promise<ApiToken> {
    const token = await this.repository.findOne({
      where: { id, owner: { id: ownerId }, tokenType },
    });

    if (!token) {
      throw new NotFoundException(`API token ${id} not found`);
    }

    return await this.repository.updateOne(
      { where: { id, owner: { id: ownerId }, tokenType } },
      { revokedAt: new Date() },
    );
  }

  private async authenticateBearerToken(
    token: string,
    tokenType: ApiTokenType,
    expectedPrefix: string,
    label: string,
  ): Promise<ApiTokenOrmEntity> {
    if (!token.startsWith(expectedPrefix)) {
      throw new UnauthorizedException(`Invalid ${label}`);
    }

    const record = await this.repository.findOneByHash(
      this.hashToken(token),
      tokenType,
    );

    if (!record) {
      throw new UnauthorizedException(`Invalid ${label}`);
    }

    if (record.revokedAt) {
      throw new UnauthorizedException(`${label} has been revoked`);
    }

    if (record.expiresAt && record.expiresAt <= new Date()) {
      throw new UnauthorizedException(`${label} has expired`);
    }

    const owner = record.owner as UserOrmEntity | undefined;
    if (!owner?.state) {
      throw new UnauthorizedException(`${label} owner is inactive`);
    }

    this.touchLastUsedAt(record);

    return record;
  }

  /**
   * Records that a token was used, off the request's critical path and
   * throttled so we don't write on every request. Failures are logged but
   * never propagated: a telemetry write must not break authentication.
   */
  private touchLastUsedAt(record: ApiTokenOrmEntity): void {
    const lastUsedAt = record.lastUsedAt?.getTime() ?? 0;
    if (Date.now() - lastUsedAt < LAST_USED_THROTTLE_MS) {
      return;
    }

    void this.repository.touchLastUsedAt(record.id).catch((error) => {
      this.logger.warn(
        `Failed to update lastUsedAt for token ${record.id}: ${error}`,
      );
    });
  }

  private async normalizeAndValidateScopes(
    ownerId: string,
    scopes: ApiTokenScope[],
  ): Promise<ApiTokenScope[]> {
    const requested = this.normalizeScopes(scopes);
    if (requested.length === 0) {
      throw new BadRequestException('At least one API token scope is required');
    }

    const owner = await this.findActiveOwner(ownerId);
    const allowed = await this.getAllowedScopes(owner);
    const allowedKeys = new Set(
      allowed.map((scope) => this.getScopeKey(scope.model, scope.action)),
    );
    const invalid = requested.find(
      (scope) => !allowedKeys.has(this.getScopeKey(scope.model, scope.action)),
    );

    if (invalid) {
      throw new ForbiddenException(
        `Owner is not allowed to grant ${invalid.action} on ${invalid.model}`,
      );
    }

    return requested;
  }

  private async findActiveOwner(ownerId: string): Promise<User> {
    const owner = await this.userService.findOne(ownerId);
    if (!owner?.state) {
      throw new UnauthorizedException('API token owner is inactive');
    }

    return owner;
  }

  private async getAllowedScopes(user: User): Promise<ApiTokenScope[]> {
    const roleIds = Array.isArray(user.roles) ? user.roles : [];
    const permissions = await this.permissionService.getPermissions();
    const scopeMap = new Map<string, ApiTokenScope>();

    for (const roleId of roleIds) {
      const models = permissions[roleId] ?? {};

      for (const [model, actions] of Object.entries(models) as Array<
        [TModel, Action[]]
      >) {
        for (const action of actions) {
          scopeMap.set(this.getScopeKey(model, action), { model, action });
        }
      }
    }

    return [...scopeMap.values()].sort((left, right) => {
      const modelCompare = left.model.localeCompare(right.model);

      return modelCompare || left.action.localeCompare(right.action);
    });
  }

  private normalizeScopes(scopes?: ApiTokenScope[] | null): ApiTokenScope[] {
    const scopeMap = new Map<string, ApiTokenScope>();

    for (const scope of scopes ?? []) {
      const parsed = apiTokenScopeSchema.parse(scope);

      scopeMap.set(this.getScopeKey(parsed.model, parsed.action), parsed);
    }

    return [...scopeMap.values()];
  }

  private getScopeKey(model: TModel, action: Action): string {
    return `${model}:${action}`;
  }

  private generateToken(prefix: string): string {
    return `${prefix}${randomBytes(32).toString('base64url')}`;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private getTokenPrefix(token: string, prefix: string): string {
    return token.slice(0, prefix.length + 8);
  }

  private parseOptionalExpiry(value?: string | null): Date | null {
    if (!value) {
      return null;
    }

    const expiresAt = new Date(value);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException('Invalid API token expiry date');
    }

    if (expiresAt <= new Date()) {
      throw new BadRequestException('API token expiry must be in the future');
    }

    return expiresAt;
  }
}
