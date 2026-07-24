/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { schema } from "normalizr";

import { IBaseSchema } from "@/types/base.types";
import { SubscriberStub } from "@/types/subscriber.types";
import { UserStub } from "@/types/user.types";
import { applyFullNameDerivedFields } from "@/utils/full-name.utils";

import { EntityType } from "./types";

const processCommonStrategy = <T extends IBaseSchema>(entity: T) => ({
  ...entity,
  ...(entity.createdAt && { createdAt: new Date(entity.createdAt) }),
  ...(entity.updatedAt && { updatedAt: new Date(entity.updatedAt) }),
});

export const RoleEntity = new schema.Entity(EntityType.ROLE, undefined, {
  idAttribute: ({ id }) => id,
  processStrategy: processCommonStrategy,
});

export const AttachmentEntity = new schema.Entity(
  EntityType.ATTACHMENT,
  undefined,
  {
    idAttribute: ({ id }) => id,
    processStrategy: processCommonStrategy,
  },
);

export const UserEntity = new schema.Entity(
  EntityType.USER,
  {
    roles: [RoleEntity],
    avatar: AttachmentEntity,
  },
  {
    idAttribute: ({ id }) => id,
    processStrategy: <T extends UserStub>(entity: T) =>
      processCommonStrategy(applyFullNameDerivedFields(entity)),
  },
);

export const SubscriberEntity = new schema.Entity(
  EntityType.SUBSCRIBER,
  {
    assignedTo: UserEntity,
  },
  {
    idAttribute: ({ id }) => id,
    processStrategy: <T extends SubscriberStub>(entity: T) => {
      if (entity.assignedAt) {
        entity.assignedAt = new Date(entity.assignedAt);
      }

      if (entity.lastvisit) {
        entity.lastvisit = new Date(entity.lastvisit);
      }

      if (entity.retainedFrom) {
        entity.retainedFrom = new Date(entity.retainedFrom);
      }

      return processCommonStrategy(applyFullNameDerivedFields(entity));
    },
  },
);

export const LabelGroupEntity = new schema.Entity(
  EntityType.LABEL_GROUP,
  {},
  {
    idAttribute: ({ id }) => id,
    processStrategy: processCommonStrategy,
  },
);

export const LabelEntity = new schema.Entity(
  EntityType.LABEL,
  {
    users: [SubscriberEntity],
    group: LabelGroupEntity,
  },
  {
    idAttribute: ({ id }) => id,
    processStrategy: processCommonStrategy,
  },
);
SubscriberEntity.define({
  labels: [LabelEntity],
});

export const ThreadEntity = new schema.Entity(
  EntityType.THREAD,
  {
    subscriber: SubscriberEntity,
  },
  {
    idAttribute: ({ id }) => id,
    processStrategy: processCommonStrategy,
  },
);

export const MessageEntity = new schema.Entity(
  EntityType.MESSAGE,
  {
    thread: ThreadEntity,
    sender: SubscriberEntity,
    recipient: SubscriberEntity,
    sentBy: UserEntity,
  },
  {
    idAttribute: ({ id }) => id,
    processStrategy: processCommonStrategy,
  },
);

export const PermissionEntity = new schema.Entity(
  EntityType.PERMISSION,
  undefined,
  {
    idAttribute: ({ id }) => id,
    processStrategy: processCommonStrategy,
  },
);

export const ModelEntity = new schema.Entity(
  EntityType.MODEL,
  { permissions: [PermissionEntity] },
  {
    idAttribute: ({ id }) => id,
  },
);

export const CredentialEntity = new schema.Entity(
  EntityType.CREDENTIAL,
  { owner: UserEntity },
  {
    idAttribute: ({ id }) => id,
    processStrategy: processCommonStrategy,
  },
);

export const McpServerEntity = new schema.Entity(
  EntityType.MCP_SERVER,
  { credential: CredentialEntity },
  {
    idAttribute: ({ id }) => id,
    processStrategy: processCommonStrategy,
  },
);

export const MenuLeafEntity = new schema.Entity(EntityType.MENU, undefined, {
  idAttribute: ({ id }) => id,
  processStrategy: processCommonStrategy,
});

export const MenuItemEntity = new schema.Entity(
  EntityType.MENU,
  {
    parent: MenuLeafEntity,
    call_to_actions: [MenuLeafEntity],
  },
  {
    idAttribute: ({ id }) => id,
    processStrategy: processCommonStrategy,
  },
);

export const MenuNodeEntity = new schema.Entity(EntityType.MENU, undefined, {
  idAttribute: ({ id }) => id,
  processStrategy: processCommonStrategy,
});

MenuNodeEntity.define({
  call_to_actions: [MenuNodeEntity],
});

export const ContentTypeEntity = new schema.Entity(
  EntityType.CONTENT_TYPE,
  undefined,
  {
    idAttribute: ({ id }) => id,
  },
);

export const ContentEntity = new schema.Entity(
  EntityType.CONTENT,
  { contentType: ContentTypeEntity },
  {
    idAttribute: ({ id }) => id,
    processStrategy: processCommonStrategy,
  },
);

export const SettingEntity = new schema.Entity(EntityType.SETTING, undefined, {
  idAttribute: ({ id }) => id,
  processStrategy: processCommonStrategy,
});

export const LanguageEntity = new schema.Entity(
  EntityType.LANGUAGE,
  undefined,
  {
    idAttribute: ({ id }) => id,
    processStrategy: processCommonStrategy,
  },
);

export const TranslationEntity = new schema.Entity(
  EntityType.TRANSLATION,
  undefined,
  {
    idAttribute: ({ id }) => id,
    processStrategy: processCommonStrategy,
  },
);

export const ChannelEntity = new schema.Entity(EntityType.CHANNEL, undefined, {
  idAttribute: ({ name }) => name,
});

export const HelperEntity = new schema.Entity(EntityType.HELPER, undefined, {
  idAttribute: ({ name }) => name,
});

export const StorageHelperEntity = new schema.Entity(
  EntityType.STORAGE_HELPER,
  undefined,
  {
    idAttribute: ({ name }) => name,
  },
);

export const RagHelperEntity = new schema.Entity(
  EntityType.RAG_HELPER,
  undefined,
  {
    idAttribute: ({ name }) => name,
  },
);

export const MemoryDefinitionEntity = new schema.Entity(
  EntityType.MEMORY_DEFINITION,
  undefined,
  {
    idAttribute: ({ id }) => id,
    processStrategy: processCommonStrategy,
  },
);

export const WorkflowVersionEntity = new schema.Entity(
  EntityType.WORKFLOW_VERSION,
  undefined,
  {
    idAttribute: ({ id }) => id,
    processStrategy: processCommonStrategy,
  },
);

export const WorkflowEntity = new schema.Entity(
  EntityType.WORKFLOW,
  {
    currentVersion: WorkflowVersionEntity,
    publishedVersion: WorkflowVersionEntity,
  },
  {
    idAttribute: ({ id }) => id,
    processStrategy: processCommonStrategy,
  },
);

export const SourceEntity = new schema.Entity(
  EntityType.SOURCE,
  {
    defaultWorkflow: WorkflowEntity,
  },
  {
    idAttribute: ({ id }) => id,
    processStrategy: processCommonStrategy,
  },
);
ThreadEntity.define({
  source: SourceEntity,
});

WorkflowVersionEntity.define({
  workflow: WorkflowEntity,
  parentVersion: WorkflowVersionEntity,
  createdBy: UserEntity,
});

export const WorkflowRunEntity = new schema.Entity(
  EntityType.WORKFLOW_RUN,
  {
    workflow: WorkflowEntity,
    workflowVersion: WorkflowVersionEntity,
    triggeredBy: UserEntity,
    thread: ThreadEntity,
  },
  {
    idAttribute: ({ id }) => id,
    processStrategy: (entity) => {
      const processed = processCommonStrategy(entity);
      // Convert date fields

      if (entity.suspendedAt) {
        processed.suspendedAt = new Date(entity.suspendedAt);
      }
      if (entity.finishedAt) {
        processed.finishedAt = new Date(entity.finishedAt);
      }
      if (entity.failedAt) {
        processed.failedAt = new Date(entity.failedAt);
      }

      return processed;
    },
  },
);

export const AuditLogEntity = new schema.Entity(
  EntityType.AUDIT_LOG,
  undefined,
  {
    idAttribute: ({ id }) => id,
    processStrategy: processCommonStrategy,
  },
);

export const ENTITY_MAP = {
  [EntityType.WORKFLOW]: WorkflowEntity,
  [EntityType.WORKFLOW_VERSION]: WorkflowVersionEntity,
  [EntityType.WORKFLOW_RUN]: WorkflowRunEntity,
  [EntityType.MCP_SERVER]: McpServerEntity,
  [EntityType.MEMORY_DEFINITION]: MemoryDefinitionEntity,
  [EntityType.AUDIT_LOG]: AuditLogEntity,
  [EntityType.THREAD]: ThreadEntity,
  [EntityType.SUBSCRIBER]: SubscriberEntity,
  [EntityType.LABEL]: LabelEntity,
  [EntityType.LABEL_GROUP]: LabelGroupEntity,
  [EntityType.ROLE]: RoleEntity,
  [EntityType.USER]: UserEntity,
  [EntityType.PERMISSION]: PermissionEntity,
  [EntityType.MODEL]: ModelEntity,
  [EntityType.CREDENTIAL]: CredentialEntity,
  [EntityType.MENU]: MenuItemEntity,
  [EntityType.MESSAGE]: MessageEntity,
  [EntityType.MENUTREE]: MenuNodeEntity,
  [EntityType.CONTENT]: ContentEntity,
  [EntityType.CONTENT_TYPE]: ContentTypeEntity,
  [EntityType.SETTING]: SettingEntity,
  [EntityType.LANGUAGE]: LanguageEntity,
  [EntityType.TRANSLATION]: TranslationEntity,
  [EntityType.ATTACHMENT]: AttachmentEntity,
  [EntityType.CHANNEL]: ChannelEntity,
  [EntityType.SOURCE]: SourceEntity,
  [EntityType.HELPER]: HelperEntity,
  [EntityType.STORAGE_HELPER]: StorageHelperEntity,
  [EntityType.RAG_HELPER]: RagHelperEntity,
} as const;
