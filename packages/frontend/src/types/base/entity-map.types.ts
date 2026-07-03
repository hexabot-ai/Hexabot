/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type {
  StepExecutionRecord,
  WorkflowRunStatus,
  WorkflowSnapshot,
} from "@hexabot-ai/agentic";
import type {
  Attachment,
  AttachmentCreatedByRef,
  AttachmentResourceRef,
  AuditLog,
  AuditLogFull,
  Content,
  ContentFull,
  ContentType,
  Credential,
  Label,
  LabelFull,
  LabelGroup,
  Language,
  McpServer,
  McpServerFull,
  MemoryDefinition,
  Menu,
  MenuFull,
  Message,
  MessageFull,
  Model,
  ModelFull,
  Permission,
  PermissionFull,
  Role,
  RoleFull,
  Setting,
  Source,
  SourceFull,
  StdIncomingMessage,
  StdOutgoingMessage,
  Subscriber,
  SubscriberFull,
  Thread,
  ThreadFull,
  Translation,
  User,
  UserFull,
  Workflow,
  WorkflowFull,
  WorkflowRun,
  WorkflowRunFull,
  WorkflowVersion,
  WorkflowVersionFull,
} from "@hexabot-ai/types";
import type { ResizeControlDirection } from "@xyflow/system";
import type { JSONSchema7 as JsonSchema } from "json-schema";

import type { SchemaNodeForm } from "@/app-components/inputs/JsonSchemaObjectBuilder";
import { EntityType } from "@/services/types";

import type { IChannel } from "../channel.types";
import type { IHelper } from "../helper.types";
import type { IMenuNode, IMenuNodeFull } from "../menu-tree.types";
import type { ILicense } from "../user.types";

type EntityPayload<
  TEntity,
  TRequiredKeys extends keyof TEntity,
  TOptionalKeys extends keyof TEntity = never,
  TExtra extends object = Record<never, never>,
> = Pick<TEntity, TRequiredKeys> &
  Partial<Pick<TEntity, TOptionalKeys>> &
  TExtra;

type NormalizeFilterOverrides<T> = [T] extends [never]
  ? Record<never, never>
  : T;

type MergeWithOverrides<TBase, TOverrides> = Omit<
  TBase,
  keyof NormalizeFilterOverrides<TOverrides>
> &
  NormalizeFilterOverrides<TOverrides>;

interface IEntityTypes<
  TStub = never,
  TAttr = never,
  TFilters = never,
  TFull = never,
> {
  basic: TStub;
  attributes: TAttr;
  filters: MergeWithOverrides<TStub, TFilters>;
  full: TFull;
}

export interface IEntityMapTypes {
  [EntityType.WORKFLOW]: IEntityTypes<
    Workflow,
    EntityPayload<
      Workflow,
      "name" | "description" | "schedule" | "type",
      "builtin" | "zoom" | "x" | "y" | "webhookTrigger",
      {
        direction?: ResizeControlDirection;
        inputSchema?: JsonSchema;
      }
    >,
    {
      version: string;
    },
    WorkflowFull
  >;
  [EntityType.WORKFLOW_VERSION]: IEntityTypes<
    WorkflowVersion,
    EntityPayload<
      WorkflowVersion,
      "definitionYml",
      "version" | "checksum" | "message" | "parentVersion" | "action"
    >,
    never,
    WorkflowVersionFull
  >;
  [EntityType.WORKFLOW_RUN]: IEntityTypes<
    WorkflowRun,
    EntityPayload<
      WorkflowRun,
      | "workflow"
      | "workflowVersion"
      | "triggeredBy"
      | "input"
      | "output"
      | "context"
      | "suspendedStep"
      | "suspensionReason"
      | "suspensionData"
      | "lastResumeData"
      | "error"
      | "suspendedAt"
      | "finishedAt"
      | "failedAt"
      | "duration"
      | "metadata",
      never,
      {
        thread?: string | null;
        status: WorkflowRunStatus;
        snapshot?: WorkflowSnapshot | null;
        stepLog?: Record<string, StepExecutionRecord> | null;
      }
    >,
    {
      workflow: Pick<Workflow, "id" | "name" | "type">;
      workflowVersion?: Pick<WorkflowVersion, "id" | "version">;
      error: string;
    },
    WorkflowRunFull
  >;
  [EntityType.MCP_SERVER]: IEntityTypes<
    McpServer,
    EntityPayload<
      McpServer,
      | "name"
      | "enabled"
      | "transport"
      | "url"
      | "command"
      | "args"
      | "cwd"
      | "credential"
    >,
    never,
    McpServerFull
  >;
  [EntityType.MEMORY_DEFINITION]: IEntityTypes<
    MemoryDefinition,
    EntityPayload<
      MemoryDefinition,
      "name" | "slug" | "scope" | "schema" | "ttlSeconds"
    >
  >;
  [EntityType.AUDIT_LOG]: IEntityTypes<AuditLog, never, never, AuditLogFull>;
  [EntityType.THREAD]: IEntityTypes<
    Thread,
    EntityPayload<
      Thread,
      | "subscriber"
      | "status"
      | "lastMessageAt"
      | "closedAt"
      | "closeReason"
      | "title"
    >,
    {
      subscriber: {
        id: string;
        firstName: string;
        lastName: string;
        channel: {
          name: string;
        };
        assignedTo: {
          id: string;
        };
      };
      source: {
        id: string;
      };
    },
    ThreadFull
  >;
  [EntityType.CONTENT]: IEntityTypes<
    Content,
    EntityPayload<Content, "contentType" | "title" | "status" | "properties">,
    {
      contentType: {
        id: string;
      };
    },
    ContentFull
  >;
  [EntityType.CONTENT_TYPE]: IEntityTypes<
    ContentType,
    EntityPayload<
      ContentType,
      "name",
      never,
      {
        schema: SchemaNodeForm;
      }
    >
  >;
  [EntityType.LABEL]: IEntityTypes<
    Label,
    EntityPayload<
      Label,
      "title" | "name" | "description" | "builtin" | "group"
    >,
    never,
    LabelFull
  >;
  [EntityType.LABEL_GROUP]: IEntityTypes<
    LabelGroup,
    EntityPayload<LabelGroup, "name">
  >;
  [EntityType.MENU]: IEntityTypes<
    Menu,
    EntityPayload<Menu, "type" | "title" | "url" | "payload" | "parent">,
    never,
    MenuFull
  >;
  [EntityType.MENUTREE]: IEntityTypes<
    IMenuNode,
    EntityPayload<IMenuNode, "type" | "title" | "url" | "payload" | "parent">,
    never,
    IMenuNodeFull
  >;
  [EntityType.MODEL]: IEntityTypes<
    Model,
    EntityPayload<Model, "name" | "identity" | "attributes" | "relation">,
    never,
    ModelFull
  >;
  [EntityType.CREDENTIAL]: IEntityTypes<
    Credential,
    EntityPayload<
      Credential,
      "name" | "owner",
      never,
      {
        value: string;
      }
    >
  >;
  [EntityType.PERMISSION]: IEntityTypes<
    Permission,
    EntityPayload<Permission, "action" | "model" | "role" | "relation">,
    never,
    PermissionFull
  >;
  [EntityType.ROLE]: IEntityTypes<
    Role,
    EntityPayload<Role, "name">,
    never,
    RoleFull
  >;
  [EntityType.SETTING]: IEntityTypes<
    Setting,
    EntityPayload<
      Setting,
      "group" | "label",
      "subgroup",
      {
        value:
          | string
          | number
          | boolean
          | string[]
          | Record<string, unknown>
          | null;
      }
    >
  >;
  [EntityType.SUBSCRIBER]: IEntityTypes<
    Subscriber,
    {
      firstName: Subscriber["firstName"];
      lastName: Subscriber["lastName"];
      locale: Subscriber["locale"];
      gender: Subscriber["gender"];
      labels: string[];
      assignedTo?: string | null;
      assignedAt?: Subscriber["assignedAt"];
      lastvisit?: Subscriber["lastvisit"];
      retainedFrom?: Subscriber["retainedFrom"];
      channel: Subscriber["channel"];
      timezone?: Subscriber["timezone"];
      language: Subscriber["language"];
      country?: Subscriber["country"];
      foreignId?: Subscriber["foreignId"];
    },
    {
      labels: { id: string }[];
      assignedTo?: { id: string } | null;
    },
    SubscriberFull
  >;
  [EntityType.SOURCE]: IEntityTypes<
    Source,
    EntityPayload<
      Source,
      "name" | "channel",
      "settings" | "state" | "defaultWorkflow"
    >,
    {
      defaultWorkflow: { id: string } | null;
    },
    SourceFull
  >;
  [EntityType.LANGUAGE]: IEntityTypes<
    Language,
    EntityPayload<Language, "title" | "code" | "isDefault" | "isRTL">
  >;
  [EntityType.TRANSLATION]: IEntityTypes<
    Translation,
    EntityPayload<Translation, "str" | "translations">
  >;
  [EntityType.USER]: IEntityTypes<
    User,
    EntityPayload<
      User,
      | "firstName"
      | "lastName"
      | "email"
      | "state"
      | "roles"
      | "avatar"
      | "language",
      never,
      {
        password?: string;
        license?: ILicense;
      }
    >,
    never,
    UserFull
  >;
  [EntityType.ATTACHMENT]: IEntityTypes<
    Attachment,
    EntityPayload<
      Attachment,
      | "name"
      | "type"
      | "size"
      | "location"
      | "url"
      | "channel"
      | "resourceRef"
      | "access"
      | "createdBy",
      never,
      {
        createdByRef?: AttachmentCreatedByRef;
      }
    >,
    {
      resourceRef: AttachmentResourceRef[];
    }
  >;
  [EntityType.MESSAGE]: IEntityTypes<
    Message,
    {
      mid?: string;
      inReplyTo?: string;
      thread: string;
      sender?: string;
      recipient?: string;
      sentBy?: string;
      message: StdOutgoingMessage | StdIncomingMessage;
      read?: boolean;
      delivery?: boolean;
      handover?: boolean;
    },
    never,
    MessageFull
  >;
  [EntityType.CHANNEL]: IEntityTypes<IChannel, EntityPayload<IChannel, "name">>;
  [EntityType.HELPER]: IEntityTypes<IHelper, EntityPayload<IHelper, "name">>;
  [EntityType.STORAGE_HELPER]: IEntityTypes<
    IHelper,
    EntityPayload<IHelper, "name">
  >;
}
