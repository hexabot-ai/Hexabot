/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { FindOneOptions } from 'typeorm';

import { BaseOrmEntity } from '@/database';

import { EHook } from '../generics/base-orm.repository';

import { InferCreateDto, InferUpdateDto, TEntityDto } from './dto.types';

type EventProps<Entity extends BaseOrmEntity> =
  | {
      action: EHook.preCreate;
      entity: Entity;
      payload: InferCreateDto<Entity>;
    }
  | {
      action: EHook.postCreate;
      entity: Entity;
      payload: InferCreateDto<Entity>;
    }
  | {
      action: EHook.preUpdate;
      entity: Entity;
      payload: InferUpdateDto<Entity>;
      databaseEntity: Entity;
    }
  | {
      action: EHook.postUpdate;
      entity: Entity;
      payload: InferUpdateDto<Entity>;
      databaseEntity: Entity;
    }
  | {
      action: EHook.preDelete;
      entity?: Entity;
      payload: string | FindOneOptions<Entity>;
      databaseEntity: Entity;
    }
  | {
      action: EHook.postDelete;
      entity?: Entity;
      payload: string | FindOneOptions<Entity>;
      databaseEntity: Entity;
    };

export type EmitEventProps<
  Entity extends BaseOrmEntity,
  H extends EHook,
> = Extract<EventProps<Entity>, { action: H }>;

export type InsertEntityEvent<
  Entity extends BaseOrmEntity<TEntityDto<Entity>>,
> = Extract<
  EventProps<Entity>,
  | {
      action: EHook.preCreate;
    }
  | {
      action: EHook.postCreate;
    }
>;

export type UpdateEntityEvent<
  Entity extends BaseOrmEntity<TEntityDto<Entity>>,
> = Extract<
  EventProps<Entity>,
  | {
      action: EHook.preUpdate;
    }
  | {
      action: EHook.postUpdate;
    }
>;

export type DeleteEntityEvent<
  Entity extends BaseOrmEntity<TEntityDto<Entity>>,
> = Extract<
  EventProps<Entity>,
  | {
      action: EHook.preDelete;
    }
  | {
      action: EHook.postDelete;
    }
>;
