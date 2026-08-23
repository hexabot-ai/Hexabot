/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { StepExecutionRecord, StepInfo } from '@hexabot-ai/agentic';
import type { HttpException } from '@nestjs/common';
import type { OnEventType } from '@nestjs/event-emitter';
import type { OnEventOptions } from '@nestjs/event-emitter/dist/interfaces';
import type {
  EventEmitter2 as EventEmitter2Base,
  event as EventKey,
  eventNS as EventNamespace,
  Listener,
  ListenerFn,
  OnOptions,
} from 'eventemitter2';
import type { Session as ExpressSession } from 'express-session';
import type { Socket } from 'socket.io';

import type {
  StatsOrmEntity,
  StatsType,
} from '@/analytics/entities/stats.entity';
import type { AttachmentOrmEntity } from '@/attachment/entities/attachment.entity';
import type { MessageInboundEvent } from '@/channel/lib/inbound-events';
import type { Message, MessageCreateDto } from '@/chat/dto/message.dto';
import type {
  Subscriber,
  SubscriberUpdateDto,
} from '@/chat/dto/subscriber.dto';
import type { LabelGroupOrmEntity } from '@/chat/entities/label-group.entity';
import type { LabelOrmEntity } from '@/chat/entities/label.entity';
import type { MessageOrmEntity } from '@/chat/entities/message.entity';
import type { SubscriberOrmEntity } from '@/chat/entities/subscriber.entity';
import type { ThreadOrmEntity } from '@/chat/entities/thread.entity';
import type { ContentTypeOrmEntity } from '@/cms/entities/content-type.entity';
import type { ContentOrmEntity } from '@/cms/entities/content.entity';
import type { MenuOrmEntity } from '@/cms/entities/menu.entity';
import type {
  DeliveryNotificationInboundEvent,
  ReadNotificationInboundEvent,
} from '@/extensions/channels/web/inbound';
import type { LanguageOrmEntity } from '@/i18n/entities/language.entity';
import type { TranslationOrmEntity } from '@/i18n/entities/translation.entity';
import type { Setting } from '@/setting/dto/setting.dto';
import type { MetadataOrmEntity } from '@/setting/entities/metadata.entity';
import type { SettingOrmEntity } from '@/setting/entities/setting.entity';
import type { ModelOrmEntity } from '@/user/entities/model.entity';
import type { PermissionOrmEntity } from '@/user/entities/permission.entity';
import type { RoleOrmEntity } from '@/user/entities/role.entity';
import type { UserOrmEntity } from '@/user/entities/user.entity';
import type { EmitEventProps, EventProps } from '@/utils';
import type { DummyOrmEntity } from '@/utils/test/dummy/entities/dummy.entity';
import type { DtoActionConfig } from '@/utils/types/dto.types';
import type {
  DeleteEntityEvent,
  InsertEntityEvent,
  UpdateEntityEvent,
} from '@/utils/types/entity-event.types';
import type { THydratedDocument } from '@/utils/types/filter.types';
import type { WorkflowRunOrmEntity } from '@/workflow/entities/workflow-run.entity';
import type { WorkflowOrmEntity } from '@/workflow/entities/workflow.entity';

type AnyMessageInboundEvent = MessageInboundEvent<any>;

type DefaultHookSettingsMap = {
  [Group in keyof Settings & string]: Record<
    keyof Settings[Group] & string,
    Setting
  >;
};

type UnionToIntersection<U> = (
  U extends never ? never : (arg: U) => void
) extends (arg: infer I) => void
  ? I
  : never;

type OrmLifecycleEvent<Entity> =
  | InsertEntityEvent<Entity>
  | UpdateEntityEvent<Entity>
  | DeleteEntityEvent<Entity>;

type InsertHook =
  | 'preCreateValidate'
  | 'preCreate'
  | 'postCreateValidate'
  | 'postCreate';

type UpdateHook =
  | 'preUpdateValidate'
  | 'preUpdate'
  | 'postUpdateValidate'
  | 'postUpdate'
  | 'preUpdateMany'
  | 'postUpdateMany';

type DeleteHook = 'preDelete' | 'postDelete';

type HookAction = Extract<
  Exclude<TNormalizedEvents, '*'>,
  EventProps<any, DtoActionConfig>['action']
>;

type HookEventProps<
  Entity,
  Hook extends Exclude<TNormalizedEvents, '*'>,
> = Hook extends HookAction
  ? Extract<EventProps<Entity, DtoActionConfig>, { action: Hook }>
  : never;

type HookEmitEventPayload<
  Entity,
  Hook extends Exclude<TNormalizedEvents, '*'>,
> = Hook extends HookAction
  ? EmitEventProps<Entity, Hook, DtoActionConfig> & HookEventProps<Entity, Hook>
  : never;

type HookEventPayload<
  Entity,
  Hook extends Exclude<TNormalizedEvents, '*'>,
> = Hook extends InsertHook
  ? [InsertEntityEvent<Entity> | HookEmitEventPayload<Entity, Hook>]
  : Hook extends UpdateHook
    ? [UpdateEntityEvent<Entity> | HookEmitEventPayload<Entity, Hook>]
    : Hook extends DeleteHook
      ? [DeleteEntityEvent<Entity> | HookEmitEventPayload<Entity, Hook>]
      : never;

type HookWildcardPayload<Entity> = [OrmLifecycleEvent<Entity>];

type StepWorkflowEventPayload = {
  runId?: string;
  step: StepInfo;
  stepExecution?: StepExecutionRecord;
};

declare module '@nestjs/event-emitter' {
  interface IHookSettingsGroupLabelOperationMap
    extends DefaultHookSettingsMap {}

  interface IHookExtensionsOperationMap {
    [namespace: string]: TDefinition;
  }

  type TDefinition<
    TPayload extends object = object,
    TSettings extends Record<string, unknown> = Record<string, unknown>,
  > = {
    payload: TPayload;
    settings: TSettings;
  };

  interface OrmEntityRegistry {
    attachment: AttachmentOrmEntity;
    stats: StatsOrmEntity;
    content: ContentOrmEntity;
    contentType: ContentTypeOrmEntity;
    dummy: DummyOrmEntity;
    label: LabelOrmEntity;
    labelGroup: LabelGroupOrmEntity;
    language: LanguageOrmEntity;
    menu: MenuOrmEntity;
    metadata: MetadataOrmEntity;
    message: MessageOrmEntity;
    model: ModelOrmEntity;
    permission: PermissionOrmEntity;
    role: RoleOrmEntity;
    setting: SettingOrmEntity;
    subscriber: SubscriberOrmEntity;
    thread: ThreadOrmEntity;
    translation: TranslationOrmEntity;
    user: UserOrmEntity;
    workflow: WorkflowOrmEntity;
    workflowRun: WorkflowRunOrmEntity;
  }

  type IHookEntities = keyof OrmEntityRegistry & string;

  type TNormalizedEvents = InsertHook | UpdateHook | DeleteHook | '*';

  type OrmLifecycleEventMap = UnionToIntersection<
    {
      [Entity in keyof OrmEntityRegistry & string]:
        | {
            [Hook in Exclude<
              TNormalizedEvents,
              '*'
            > as `hook:${Entity}:${Hook}`]: HookEventPayload<
              OrmEntityRegistry[Entity],
              Hook
            >;
          }
        | {
            [`hook:${Entity}:*`]: HookWildcardPayload<
              OrmEntityRegistry[Entity]
            >;
          };
    }[keyof OrmEntityRegistry & string]
  >;

  type SettingsEventMap = UnionToIntersection<
    {
      [Group in keyof IHookSettingsGroupLabelOperationMap & string]:
        | {
            [Label in keyof IHookSettingsGroupLabelOperationMap[Group] &
              string as `hook:${Group}:${Label}`]: [
              IHookSettingsGroupLabelOperationMap[Group][Label],
            ];
          }
        | {
            [`hook:${Group}:*`]: [
              IHookSettingsGroupLabelOperationMap[Group][keyof IHookSettingsGroupLabelOperationMap[Group] &
                string],
            ];
          };
    }[keyof IHookSettingsGroupLabelOperationMap & string]
  >;

  interface CustomEventMap {
    'hook:chatbot:echo': [AnyMessageInboundEvent];
    'hook:chatbot:delivery': [DeliveryNotificationInboundEvent];
    'hook:chatbot:message': [AnyMessageInboundEvent];
    'hook:chatbot:read': [ReadNotificationInboundEvent];
    'hook:chatbot:received': [AnyMessageInboundEvent];
    'hook:chatbot:sent': [MessageCreateDto];
    'hook:message:preCreate': [THydratedDocument<Message>];
    'hook:stats:entry': [StatsType, string, Subscriber?];
    'hook:subscriber:assign': [SubscriberUpdateDto, Subscriber];
    'hook:user:lastvisit': [Subscriber];
    'hook:user:logout': [ExpressSession];
    'hook:websocket:connection': [Socket];
    'hook:websocket:error': [Socket, Error | HttpException];
    'hook:workflow:start': [{ runId?: string }];
    'hook:workflow:finish': [
      { runId?: string; output: Record<string, unknown> },
    ];
    'hook:workflow:failure': [{ runId?: string; error: unknown }];
    'hook:workflow:suspended': [
      { runId?: string; step: StepInfo; reason?: string; data?: unknown },
    ];
    'hook:step:start': [StepWorkflowEventPayload];
    'hook:step:success': [StepWorkflowEventPayload];
    'hook:step:error': [StepWorkflowEventPayload & { error: unknown }];
    'hook:step:cancelled': [StepWorkflowEventPayload & { error: unknown }];
    'hook:step:suspended': [
      StepWorkflowEventPayload & { reason?: string; data?: unknown },
    ];
    'hook:step:skipped': [{ runId?: string; step: StepInfo; reason?: string }];
  }

  interface IBaseHookEventMap
    extends OrmLifecycleEventMap,
      SettingsEventMap,
      CustomEventMap {}

  interface IHookEventMap extends IBaseHookEventMap {}

  type HookEventKey = keyof IHookEventMap & string;

  type HookEventArgs<K extends HookEventKey> = IHookEventMap[K] extends any[]
    ? IHookEventMap[K]
    : never;

  type HookEventListener<K extends HookEventKey> = (
    ...args: HookEventArgs<K>
  ) => unknown;

  type HookEventEmitter = Omit<EventEmitter2Base, 'emit' | 'emitAsync'> & {
    emit<K extends HookEventKey>(
      event: K,
      ...values: HookEventArgs<K>
    ): boolean;
    emitAsync<K extends HookEventKey>(
      event: K,
      ...values: HookEventArgs<K>
    ): Promise<any[]>;
  };

  interface EventEmitter2 extends EventEmitter2Base {
    addListener<K extends HookEventKey>(
      event: K,
      listener: HookEventListener<K>,
    ): this | Listener;
    addListener(
      event: EventKey | EventNamespace | Array<EventKey | EventNamespace>,
      listener: ListenerFn,
    ): this | Listener;

    on<K extends HookEventKey>(
      event: K,
      listener: HookEventListener<K>,
      options?: boolean | OnOptions,
    ): this | Listener;
    on(
      event: EventKey | EventNamespace | Array<EventKey | EventNamespace>,
      listener: ListenerFn,
      options?: boolean | OnOptions,
    ): this | Listener;

    once<K extends HookEventKey>(
      event: K,
      listener: HookEventListener<K>,
      options?: true | OnOptions,
    ): this | Listener;
    once(
      event: EventKey | EventNamespace | Array<EventKey | EventNamespace>,
      listener: ListenerFn,
      options?: true | OnOptions,
    ): this | Listener;

    prependListener<K extends HookEventKey>(
      event: K,
      listener: HookEventListener<K>,
      options?: boolean | OnOptions,
    ): this | Listener;
    prependListener(
      event: EventKey | EventNamespace | Array<EventKey | EventNamespace>,
      listener: ListenerFn,
      options?: boolean | OnOptions,
    ): this | Listener;

    prependOnceListener<K extends HookEventKey>(
      event: K,
      listener: HookEventListener<K>,
      options?: boolean | OnOptions,
    ): this | Listener;
    prependOnceListener(
      event: EventKey | EventNamespace | Array<EventKey | EventNamespace>,
      listener: ListenerFn,
      options?: boolean | OnOptions,
    ): this | Listener;

    many<K extends HookEventKey>(
      event: K,
      timesToListen: number,
      listener: HookEventListener<K>,
      options?: boolean | OnOptions,
    ): this | Listener;
    many(
      event: EventKey | EventNamespace | Array<EventKey | EventNamespace>,
      timesToListen: number,
      listener: ListenerFn,
      options?: boolean | OnOptions,
    ): this | Listener;

    prependMany<K extends HookEventKey>(
      event: K,
      timesToListen: number,
      listener: HookEventListener<K>,
      options?: boolean | OnOptions,
    ): this | Listener;
    prependMany(
      event: EventKey | EventNamespace | Array<EventKey | EventNamespace>,
      timesToListen: number,
      listener: ListenerFn,
      options?: boolean | OnOptions,
    ): this | Listener;

    off<K extends HookEventKey>(event: K, listener: HookEventListener<K>): this;
    off(
      event: EventKey | EventNamespace | Array<EventKey | EventNamespace>,
      listener: ListenerFn,
    ): this;

    removeListener<K extends HookEventKey>(
      event: K,
      listener: HookEventListener<K>,
    ): this;
    removeListener(
      event: EventKey | EventNamespace | Array<EventKey | EventNamespace>,
      listener: ListenerFn,
    ): this;
  }

  type OnEventMethodDecorator<K extends HookEventKey> = <
    T extends HookEventListener<K>,
  >(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>,
  ) => void;

  function OnEvent<K extends HookEventKey>(
    event: K,
    options?: OnEventOptions,
  ): OnEventMethodDecorator<K>;
  function OnEvent<K extends HookEventKey>(
    event: readonly K[],
    options?: OnEventOptions,
  ): OnEventMethodDecorator<K>;
  function OnEvent(
    event: OnEventType,
    options?: OnEventOptions,
  ): MethodDecorator;
}
