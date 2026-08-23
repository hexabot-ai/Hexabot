/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { BadRequestException, Inject, NotFoundException } from '@nestjs/common';
import type { HookEventEmitter } from '@nestjs/event-emitter';
import { FindManyOptions, In } from 'typeorm';

import { BaseOrmEntity } from '@/database/entities/base.entity';
import { LoggerService } from '@/logger/logger.service';

import { TEntityDto } from '../types/dto.types';

import { BaseOrmRepository } from './base-orm.repository';
import { BaseOrmService } from './base-orm.service';

export abstract class BaseOrmController<
  Entity extends BaseOrmEntity<TEntityDto<Entity>>,
> {
  @Inject(LoggerService)
  readonly logger: LoggerService;

  protected constructor(protected readonly service: BaseOrmService<Entity>) {}

  get eventEmitter(): HookEventEmitter {
    return this.service.eventEmitter;
  }

  protected getEntityName(repository: BaseOrmRepository<Entity>) {
    return repository['repository']['target']['name'].replace(/OrmEntity$/, '');
  }

  async count(
    options: FindManyOptions<Entity> = {},
  ): Promise<{ count: number }> {
    return { count: await this.service.count(options) };
  }

  async find(options: FindManyOptions<Entity> = {}, populate: string[] = []) {
    return this.service.canPopulate(populate)
      ? await this.service.findAndPopulate(options)
      : await this.service.find(options);
  }

  async findOne(id: string, populate: string[] = []) {
    const record = this.service.canPopulate(populate)
      ? await this.service.findOneAndPopulate(id)
      : await this.service.findOne(id);
    if (!record) {
      const repository = this.service.getRepository();
      const entityName = this.getEntityName(repository);
      this.logger.warn(`Unable to find ${entityName} by id ${id}`);
      throw new NotFoundException(`${entityName} with ID ${id} not found`);
    }

    return record;
  }

  async deleteOne(id: string) {
    const result = await this.service.deleteOne(id);
    const repository = this.service.getRepository();
    const entityName = this.getEntityName(repository);

    if (result.deletedCount === 0) {
      this.logger.warn(`Unable to delete ${entityName} by id ${id}`);
      throw new NotFoundException(`${entityName} with ID ${id} not found`);
    }
    this.logger.log(`Successfully deleted ${entityName} with ID ${id}`);

    return result;
  }

  async deleteMany(ids?: string[]) {
    if (!ids?.length) {
      throw new BadRequestException('No IDs provided for deletion.');
    }

    const deleteResult = await this.service.deleteMany({
      where: { id: In(ids) },
    } as FindManyOptions<Entity>);
    const repository = this.service.getRepository();
    const entityName = this.getEntityName(repository);

    if (deleteResult.deletedCount === 0) {
      this.logger.warn(
        `Unable to delete ${entityName} with provided IDs: ${ids}`,
      );
      throw new NotFoundException(`${entityName}s with provided IDs not found`);
    }
    this.logger.log(`Successfully deleted ${entityName}s with IDs: ${ids}`);

    return deleteResult;
  }
}
