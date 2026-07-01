/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { User } from '@hexabot-ai/types';
import { UnauthorizedException } from '@nestjs/common';
import { FindManyOptions, Like } from 'typeorm';

import { HexabotMcpRequest } from '../types';

import { PaginationArgs } from './hexabot-mcp.schemas';

export abstract class HexabotMcpToolBase {
  protected findOptions<Entity>(
    args: PaginationArgs,
    where: FindManyOptions<Entity>['where'],
  ): FindManyOptions<Entity> {
    return {
      where,
      take: args.limit,
      skip: args.skip,
      order: { [args.sortBy]: args.sortDirection } as any,
    };
  }

  protected async listWithCount<Entity>(
    service: {
      findAndPopulate(options?: FindManyOptions<Entity>): Promise<unknown[]>;
      count(options?: FindManyOptions<Entity>): Promise<number>;
    },
    options: FindManyOptions<Entity>,
  ) {
    const [items, total] = await Promise.all([
      service.findAndPopulate(options),
      service.count({ where: options.where }),
    ]);

    return {
      items,
      total,
      limit: options.take,
      skip: options.skip,
    };
  }

  protected contains(value: string) {
    return Like(`%${value}%`);
  }

  protected getActor(request?: HexabotMcpRequest): User {
    const actor = request?.hexabotUser ?? request?.user;
    if (!actor?.id) {
      throw new UnauthorizedException('MCP Hexabot user is required');
    }

    return actor as User;
  }

  protected getActorId(request?: HexabotMcpRequest): string {
    return this.getActor(request).id;
  }
}
