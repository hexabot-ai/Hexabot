/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { BaseWorkflowContext } from '@hexabot-ai/agentic';
import { WorkflowRunFull } from '@hexabot-ai/types';
import { forwardRef, Inject, Injectable, Scope } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { ActionService } from '@/actions/actions.service';
import { AttachmentService } from '@/attachment/services/attachment.service';
import { MessageService } from '@/chat/services/message.service';
import { SubscriberService } from '@/chat/services/subscriber.service';
import { ContentTypeService } from '@/cms/services/content-type.service';
import { ContentService } from '@/cms/services/content.service';
import { I18nService } from '@/i18n/services/i18n.service';
import { LoggerService } from '@/logger/logger.service';
import { SettingService } from '@/setting/services/setting.service';
import { CredentialService } from '@/user/services/credential.service';
import { cloneObject } from '@/utils/helpers/clone';
import {
  WORKFLOW_CALL_SERVICE,
  WorkflowContextState,
  WorkflowType,
  type WorkflowCallService,
} from '@/workflow/types';

import { TriggerEventWrapper } from '../lib/trigger-event-wrapper';
import { McpClientPoolService } from '../services/mcp-client-pool.service';
import { MemoryStore } from '../utils/memory-store';

@Injectable({ scope: Scope.TRANSIENT })
export abstract class WorkflowRuntimeContext<
  E extends TriggerEventWrapper = TriggerEventWrapper,
> extends BaseWorkflowContext<WorkflowContextState, EventEmitter2> {
  abstract event: E;

  @Inject(I18nService)
  protected readonly i18n: I18nService;

  @Inject(SettingService)
  protected readonly settings: SettingService;

  @Inject(LoggerService)
  protected readonly logger: LoggerService;

  @Inject(ContentService)
  protected readonly content: ContentService;

  @Inject(ContentTypeService)
  protected readonly contentType: ContentTypeService;

  @Inject(EventEmitter2)
  readonly eventEmitter: EventEmitter2;

  @Inject(forwardRef(() => MessageService))
  protected readonly message: MessageService;

  @Inject(forwardRef(() => SubscriberService))
  protected readonly subscriber: SubscriberService;

  @Inject(ActionService)
  protected readonly actionService: ActionService;

  @Inject(AttachmentService)
  protected readonly attachment: AttachmentService;

  @Inject(CredentialService)
  protected readonly credentialService: CredentialService;

  @Inject(McpClientPoolService)
  protected readonly mcp: McpClientPoolService;

  @Inject(WORKFLOW_CALL_SERVICE)
  protected readonly workflowCallService: WorkflowCallService;

  public memoryStore: MemoryStore;

  constructor() {
    super({} as WorkflowContextState);
  }

  get services() {
    return {
      i18n: this.i18n,
      settings: this.settings,
      logger: this.logger,
      content: this.content,
      contentType: this.contentType,
      attachment: this.attachment,
      message: this.message,
      subscriber: this.subscriber,
      actions: this.actionService,
      credentials: this.credentialService,
      mcp: this.mcp,
      // Expose the workflow-call contract, not the concrete AgenticService, so
      // contexts do not create a JS import cycle with WorkflowContextFactory.
      agentic: this.workflowCallService,
    };
  }

  get workflowId(): string {
    return this.state.workflowId;
  }

  set workflowId(value: string) {
    this.state.workflowId = value;
  }

  get workflowRunId(): string {
    return this.state.runId;
  }

  set workflowRunId(value: string) {
    this.state.runId = value;
  }

  get runId(): string | undefined {
    return this.state.runId;
  }

  set runId(value: string) {
    this.state.runId = value;
  }

  get initiatorId(): string {
    return this.state.initiatorId;
  }

  set initiatorId(value: string) {
    this.state.initiatorId = value;
  }

  get threadId(): string | null | undefined {
    const value = this.state.threadId;

    return typeof value === 'string' ? value : (value ?? null);
  }

  set threadId(value: string | null | undefined) {
    this.state.threadId = value ?? null;
  }

  async buildFromRun(
    run: WorkflowRunFull,
    event: E,
    memory: MemoryStore,
  ): Promise<this> {
    this.resetState();
    this.event = event;
    // Hydrate persisted state first, then merge transient event context.
    await this.hydrate(run.context);
    await this.hydrate(event.getContextData());
    const triggeredById = run.triggeredBy?.id;
    if (!triggeredById) {
      throw new Error(`Workflow run ${run.id} is missing triggeredBy`);
    }
    this.initiatorId = triggeredById;
    this.workflowId = run.workflow.id;
    this.workflowRunId = run.id;
    this.threadId = run.thread?.id ?? event.getThreadId() ?? null;
    await this.syncInitiatorState();
    this.memoryStore = memory;
    this.memoryStore.syncToContext();

    return this;
  }

  async syncInitiatorState(): Promise<this> {
    if (!this.event?.getInitiator) {
      return this;
    }

    const initiator = this.event.getInitiator();
    if (!initiator || typeof initiator !== 'object') {
      return this;
    }

    const initiatorState = cloneObject(
      initiator as unknown as Record<string, unknown>,
    );

    if (this.event.triggerType === WorkflowType.conversational) {
      const labels = (initiator as unknown as { labels?: unknown }).labels;
      const labelIds = Array.isArray(labels)
        ? labels.filter((label): label is string => typeof label === 'string')
        : [];

      initiatorState.labels = await this.subscriber.resolveLabelNames(labelIds);
    }

    this.state.initiator = initiatorState;

    return this;
  }

  async hydrate(
    stored?: Record<string, unknown> | WorkflowContextState | null,
  ): Promise<this> {
    if (!stored) {
      return this;
    }

    this.state = {
      ...this.state,
      ...stored,
    };

    return this;
  }

  protected resetState() {
    this.state = {} as WorkflowContextState;
  }
}
