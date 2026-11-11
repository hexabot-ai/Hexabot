/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import { BeforeInsert, BeforeUpdate, PrimaryColumn } from 'typeorm';
import type { ZodTypeAny } from 'zod';

import { DatetimeColumn } from '@/database/decorators/datetime-column.decorator';
import type { InferTransformDto, TDto } from '@/utils/types/dto.types';

type TransformerField = 'plainCls' | 'fullCls';

export abstract class BaseOrmEntity<Dto extends TDto = TDto> {
  abstract plainCls: Dto['transformers']['plain'];

  abstract fullCls: Dto['transformers']['full'];

  declare readonly __dtoType: Dto;

  @PrimaryColumn()
  id!: string;

  @DatetimeColumn({ name: 'created_at', nullable: true })
  createdAt!: Date;

  @DatetimeColumn({ name: 'updated_at', nullable: true })
  updatedAt!: Date;

  @BeforeInsert()
  protected setDefaults(): void {
    const now = new Date();
    if (!this.id) {
      this.id = randomUUID();
    }
    this.createdAt = this.createdAt ?? now;
    this.updatedAt = this.updatedAt ?? now;
  }

  @BeforeUpdate()
  protected touchUpdatedAt(): void {
    this.updatedAt = new Date();
  }

  private isZodSchema(value: unknown): value is ZodTypeAny {
    return (
      typeof value === 'object' &&
      value !== null &&
      'parse' in value &&
      typeof (value as { parse?: unknown }).parse === 'function' &&
      'safeParse' in value &&
      typeof (value as { safeParse?: unknown }).safeParse === 'function'
    );
  }

  private getTransformerTargetName(target: unknown): string {
    if (target === null) {
      return 'null';
    }

    if (typeof target === 'function') {
      return target.name || 'function';
    }

    if (typeof target !== 'object') {
      return typeof target;
    }

    const constructorName = (target as { constructor?: { name?: unknown } })
      .constructor?.name;

    return typeof constructorName === 'string' && constructorName.length > 0
      ? constructorName
      : 'object';
  }

  private transform<T>(target: unknown, field: TransformerField): T {
    if (this.isZodSchema(target)) {
      return target.parse(this) as T;
    }

    const targetName = this.getTransformerTargetName(target);
    throw new TypeError(
      `[BaseOrmEntity] ${this.constructor.name}.${field} must be a zod schema (must expose parse and safeParse). Received: ${targetName}.`,
    );
  }

  public toPlainCls(): InferTransformDto<Dto['transformers']['plain']> {
    return this.transform<InferTransformDto<Dto['transformers']['plain']>>(
      this.plainCls,
      'plainCls',
    );
  }

  public toFullCls(): InferTransformDto<Dto['transformers']['full']> {
    return this.transform<InferTransformDto<Dto['transformers']['full']>>(
      this.fullCls,
      'fullCls',
    );
  }
}
