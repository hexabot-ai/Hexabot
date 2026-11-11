/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import {
  IncomingMessageType,
  StdIncomingMessage,
  Subscriber,
  Thread,
  ThreadFull,
  WorkflowRun,
  WorkflowRunFull,
  WorkflowType,
} from '@hexabot-ai/types';
import { forwardRef, Inject, Injectable } from '@nestjs/common';

import {
  ChannelInboundEventContext,
  SyntheticMessageInboundEvent,
} from '@/channel/lib/inbound-events';
import { ChannelRegistry } from '@/channel/services/channel-registry.service';
import { ChannelName } from '@/channel/types';
import { MessageService } from '@/chat/services/message.service';
import { SubscriberService } from '@/chat/services/subscriber.service';
import { ThreadService } from '@/chat/services/thread.service';
import { UserService } from '@/user/services/user.service';

import {
  ManualEventWrapper,
  ScheduledEventWrapper,
  TriggerEventWrapper,
} from '../lib/trigger-event-wrapper';
import { conversationalWorkflowInputZodSchema } from '../schemas/workflow-input-schemas';

import { WorkflowRunService } from './workflow-run.service';

/** Longest parent chain followed to find the run a call stack started from. */
const MAX_STACK_DEPTH = 10;

export type WorkflowTriggerUnavailableCode =
  | 'initiator_unavailable'
  | 'thread_unavailable'
  | 'thread_closed'
  | 'channel_unavailable'
  | 'source_disabled'
  | 'unsupported_trigger';

/**
 * Thrown when the trigger of a persisted run can no longer be rebuilt, e.g.
 * its initiator was deleted or its conversation was closed.
 */
export class WorkflowTriggerUnavailableError extends Error {
  constructor(
    readonly code: WorkflowTriggerUnavailableCode,
    message: string,
  ) {
    super(message);
    this.name = 'WorkflowTriggerUnavailableError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
/** Read a text entry of the metadata of a run; undefined when not text. */
const textMetadata = (
  run: WorkflowRun | WorkflowRunFull,
  key: string,
): string | undefined => {
  const value = run.metadata?.[key];

  return typeof value === 'string' ? value : undefined;
};

/**
 * Rebuilds the trigger event of a persisted run, for resumes that no inbound
 * event carries, such as an admin approving a wait.
 *
 * Resuming needs an event: it hydrates the runtime context, scopes JSONata
 * translations to the initiator's language, lets message actions reach the
 * channel, and starts the children of `call_workflow`. The event is rebuilt
 * from the run, its initiator and, for conversations, its thread, source and
 * channel as they are now.
 */
@Injectable()
export class WorkflowEventRestorer {
  constructor(
    @Inject(forwardRef(() => ThreadService))
    private readonly threadService: ThreadService,
    @Inject(forwardRef(() => SubscriberService))
    private readonly subscriberService: SubscriberService,
    @Inject(forwardRef(() => MessageService))
    private readonly messageService: MessageService,
    private readonly userService: UserService,
    private readonly channelRegistry: ChannelRegistry,
    private readonly workflowRunService: WorkflowRunService,
  ) {}

  /**
   * Rebuild the trigger event of a run.
   *
   * @param run - Run to resume, with its relations populated.
   * @returns The event to resume the run with.
   * @throws {WorkflowTriggerUnavailableError} When the initiator, thread,
   * channel or source the event needs is gone or disabled.
   */
  async restore(run: WorkflowRunFull): Promise<TriggerEventWrapper> {
    const initiatorId = run.triggeredBy?.id;
    if (!initiatorId) {
      throw new WorkflowTriggerUnavailableError(
        'initiator_unavailable',
        'The run has no initiator',
      );
    }

    // Children share the trigger of the run their call stack started from,
    // and default their own input to its input.
    const root = await this.findStackRoot(run);
    let event: TriggerEventWrapper;
    switch (run.workflow.type) {
      case WorkflowType.conversational:
        event = await this.restoreConversationalEvent(run, root, initiatorId);
        break;
      case WorkflowType.manual:
        event = new ManualEventWrapper(
          root.input ?? {},
          textMetadata(root, 'initiated_by') ?? null,
        );
        event.setInitiator(await this.findUser(initiatorId));
        break;
      case WorkflowType.scheduled:
        event = new ScheduledEventWrapper({
          schedule: textMetadata(root, 'schedule') ?? null,
          triggeredAt: textMetadata(root, 'triggered_at'),
        });
        event.setInitiator(await this.findUser(initiatorId));
        break;
      default:
        throw new WorkflowTriggerUnavailableError(
          'unsupported_trigger',
          `Unsupported workflow type "${run.workflow.type}"`,
        );
    }

    event.setThreadId(run.thread?.id ?? undefined);
    event.setWorkflowId(run.workflow.id);

    return event;
  }

  /**
   * Rebuild a channel message event on the run's thread, as the message
   * controller does when an admin writes to a conversation.
   */
  private async restoreConversationalEvent(
    run: WorkflowRunFull,
    root: WorkflowRun | WorkflowRunFull,
    initiatorId: string,
  ): Promise<TriggerEventWrapper> {
    const thread = await this.findOpenThread(run.thread?.id);
    const subscriber = await this.findThreadSubscriber(thread, initiatorId);
    const channelName = subscriber.channel?.name as ChannelName | null;
    const handler = channelName
      ? this.channelRegistry.findChannel(channelName)
      : undefined;
    if (!channelName || !handler) {
      throw new WorkflowTriggerUnavailableError(
        'channel_unavailable',
        `The channel "${channelName ?? ''}" of the run is unavailable`,
      );
    }
    if (!thread.source?.state) {
      throw new WorkflowTriggerUnavailableError(
        'source_disabled',
        'The source of the conversation is disabled',
      );
    }

    const input = conversationalWorkflowInputZodSchema.safeParse(root.input);
    const message: StdIncomingMessage = input.success
      ? input.data.message
      : { type: IncomingMessageType.text, data: { text: '' } };
    const latestMid = (
      await this.messageService.findLastMessages({ id: thread.id } as Thread, 1)
    ).at(0)?.mid;
    const context = new ChannelInboundEventContext<
      ChannelName,
      Record<string, unknown>,
      Record<string, unknown>
    >(
      channelName,
      { source: 'workflow-operator' },
      this.resolveChannelAttrs(run, channelName, subscriber.channel?.data),
      new Date(),
      latestMid ?? (input.success ? input.data.mid : undefined) ?? randomUUID(),
      subscriber.foreignId,
      null,
      thread.source.id,
      thread.source.settings ?? {},
    );
    const event = new SyntheticMessageInboundEvent<
      ChannelName,
      Record<string, unknown>
    >(
      context,
      message,
      input.success
        ? (input.data.message_type ?? message.type)
        : IncomingMessageType.text,
      handler,
    );
    event.setInitiator(subscriber);

    return event;
  }

  private async findOpenThread(threadId?: string): Promise<ThreadFull> {
    const thread = threadId
      ? await this.threadService.findOneAndPopulate(threadId)
      : null;
    if (!thread) {
      throw new WorkflowTriggerUnavailableError(
        'thread_unavailable',
        'The conversation of the run is unavailable',
      );
    }
    if (thread.status === 'closed') {
      throw new WorkflowTriggerUnavailableError(
        'thread_closed',
        'The conversation of the run is closed',
      );
    }

    return thread;
  }

  /** Find the subscriber of the thread, who must have started the run. */
  private async findThreadSubscriber(
    thread: ThreadFull,
    initiatorId: string,
  ): Promise<Subscriber & { foreignId: string }> {
    const subscriber = await this.subscriberService.findOne(initiatorId);
    if (!subscriber?.foreignId || thread.subscriber?.id !== subscriber.id) {
      throw new WorkflowTriggerUnavailableError(
        'initiator_unavailable',
        'The subscriber of the run is unavailable',
      );
    }

    return subscriber as Subscriber & { foreignId: string };
  }

  /**
   * Read the channel attributes the run was started with, which its context
   * keeps as `{ name, ...attrs }`, falling back to the subscriber's.
   */
  private resolveChannelAttrs(
    run: WorkflowRunFull,
    channelName: ChannelName,
    subscriberChannelData: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> {
    const stored = run.context?.channel;
    if (isRecord(stored) && stored.name === channelName) {
      const { name: _name, ...attrs } = stored;

      return attrs;
    }

    return { ...(subscriberChannelData ?? {}) };
  }

  /**
   * Find the user who initiated a manual or scheduled run.
   */
  private async findUser(userId: string) {
    const user = await this.userService.findOne(userId);
    if (!user) {
      throw new WorkflowTriggerUnavailableError(
        'initiator_unavailable',
        'The user who started the run is unavailable',
      );
    }

    return user;
  }

  /**
   * Follow the parent links of a run up to the run its call stack started
   * from.
   */
  private async findStackRoot(
    run: WorkflowRunFull,
  ): Promise<WorkflowRun | WorkflowRunFull> {
    let current: WorkflowRun | WorkflowRunFull = run;
    const visited = new Set<string>([run.id]);

    for (let depth = 0; depth < MAX_STACK_DEPTH; depth += 1) {
      const parentRunId =
        typeof current.parentRun === 'string'
          ? current.parentRun
          : (current.parentRun?.id ?? null);
      if (!parentRunId || visited.has(parentRunId)) {
        break;
      }

      const parent = await this.workflowRunService.findOne(parentRunId);
      if (!parent) {
        break;
      }

      visited.add(parent.id);
      current = parent;
    }

    return current;
  }
}
