/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { IncomingMessageType, WorkflowRunFull } from '@hexabot-ai/types';

import { SyntheticMessageInboundEvent } from '@/channel/lib/inbound-events';
import { ChannelRegistry } from '@/channel/services/channel-registry.service';
import { MessageService } from '@/chat/services/message.service';
import { SubscriberService } from '@/chat/services/subscriber.service';
import { ThreadService } from '@/chat/services/thread.service';
import { UserService } from '@/user/services/user.service';

import {
  ManualEventWrapper,
  ScheduledEventWrapper,
} from '../lib/trigger-event-wrapper';
import { WorkflowType } from '../types';

import {
  WorkflowEventRestorer,
  WorkflowTriggerUnavailableError,
} from './workflow-event-restorer.service';
import { WorkflowRunService } from './workflow-run.service';

const rootMessage = { type: IncomingMessageType.text, data: { text: 'Hi' } };

describe('WorkflowEventRestorer', () => {
  const threadService = { findOneAndPopulate: jest.fn() };
  const subscriberService = { findOne: jest.fn() };
  const messageService = { findLastMessages: jest.fn() };
  const userService = { findOne: jest.fn() };
  const channelRegistry = { findChannel: jest.fn() };
  const workflowRunService = { findOne: jest.fn() };
  const handler = { getName: () => 'web' };
  const restorer = new WorkflowEventRestorer(
    threadService as unknown as ThreadService,
    subscriberService as unknown as SubscriberService,
    messageService as unknown as MessageService,
    userService as unknown as UserService,
    channelRegistry as unknown as ChannelRegistry,
    workflowRunService as unknown as WorkflowRunService,
  );
  const thread = {
    id: 'thread-1',
    status: 'open',
    subscriber: { id: 'sub-1' },
    source: { id: 'source-1', state: true, settings: { token: 'secret' } },
  };
  const subscriber = {
    id: 'sub-1',
    foreignId: 'foreign-1',
    language: 'fr',
    channel: { name: 'web', data: { fromSubscriber: true } },
  };
  const user = { id: 'user-1', language: 'en' };
  const buildRun = (
    type: WorkflowType,
    overrides: Partial<Record<string, unknown>> = {},
  ): WorkflowRunFull =>
    ({
      id: 'run-1',
      workflow: { id: 'workflow-1', type },
      triggeredBy: {
        id: type === WorkflowType.conversational ? 'sub-1' : 'user-1',
      },
      thread: type === WorkflowType.conversational ? { id: 'thread-1' } : null,
      parentRun: null,
      input: {},
      context: {},
      metadata: {},
      ...overrides,
    }) as unknown as WorkflowRunFull;
  const expectUnavailable = async (
    run: WorkflowRunFull,
    code: WorkflowTriggerUnavailableError['code'],
  ) => {
    const error = await restorer.restore(run).catch((caught) => caught);
    expect(error).toBeInstanceOf(WorkflowTriggerUnavailableError);
    expect(error.code).toBe(code);
  };

  beforeEach(() => {
    jest.resetAllMocks();
    threadService.findOneAndPopulate.mockResolvedValue(thread);
    subscriberService.findOne.mockResolvedValue(subscriber);
    messageService.findLastMessages.mockResolvedValue([{ mid: 'mid-9' }]);
    userService.findOne.mockResolvedValue(user);
    channelRegistry.findChannel.mockReturnValue(handler);
  });

  describe('conversational runs', () => {
    it('rebuilds a message event on the thread of the run', async () => {
      const run = buildRun(WorkflowType.conversational, {
        context: { channel: { name: 'web', isSocket: true } },
        input: {
          message: rootMessage,
          text: 'Hi',
          thread_id: 'thread-1',
          mid: 'mid-1',
        },
      });
      const event = (await restorer.restore(
        run,
      )) as SyntheticMessageInboundEvent;

      expect(event).toBeInstanceOf(SyntheticMessageInboundEvent);
      expect(event.getInitiator()).toBe(subscriber);
      expect(event.getHandler()).toBe(handler);
      expect(event.getThreadId()).toBe('thread-1');
      expect(event.getWorkflowId()).toBe('workflow-1');
      expect(event.getSourceId()).toBe('source-1');
      expect(event.getSourceSettings()).toEqual({ token: 'secret' });
      expect(event.getSenderForeignId()).toBe('foreign-1');
      expect(event.getId()).toBe('mid-9');
      // The channel attributes the run was started with.
      expect(event.getChannelData()).toEqual({ name: 'web', isSocket: true });
      expect(event.buildInput()).toEqual(
        expect.objectContaining({ message: rootMessage, text: 'Hi' }),
      );
      expect(threadService.findOneAndPopulate).toHaveBeenCalledWith('thread-1');
    });

    it('takes the input of the run its call stack started from', async () => {
      workflowRunService.findOne.mockResolvedValueOnce({
        id: 'root-run',
        parentRun: null,
        input: {
          message: rootMessage,
          text: 'Hi',
          thread_id: 'thread-1',
        },
      });
      const run = buildRun(WorkflowType.conversational, {
        parentRun: { id: 'root-run' },
        input: { explicit: 'child input' },
      });
      const event = await restorer.restore(run);

      expect(workflowRunService.findOne).toHaveBeenCalledWith('root-run');
      expect(event.buildInput()).toEqual(
        expect.objectContaining({ message: rootMessage }),
      );
    });

    it('falls back to an empty text message and the subscriber channel data', async () => {
      messageService.findLastMessages.mockResolvedValue([]);
      const run = buildRun(WorkflowType.conversational, {
        input: { not: 'a message' },
      });
      const event = (await restorer.restore(
        run,
      )) as SyntheticMessageInboundEvent;

      expect(event.toStdIncomingMessage()).toEqual({
        type: IncomingMessageType.text,
        data: { text: '' },
      });
      expect(event.getChannelData()).toEqual({
        name: 'web',
        fromSubscriber: true,
      });
      expect(typeof event.getId()).toBe('string');
    });

    it.each([
      [
        'thread_unavailable',
        () => threadService.findOneAndPopulate.mockResolvedValue(null),
      ],
      [
        'thread_closed',
        () =>
          threadService.findOneAndPopulate.mockResolvedValue({
            ...thread,
            status: 'closed',
          }),
      ],
      [
        'initiator_unavailable',
        () => subscriberService.findOne.mockResolvedValue(null),
      ],
      [
        'initiator_unavailable',
        () =>
          subscriberService.findOne.mockResolvedValue({
            ...subscriber,
            id: 'someone-else',
          }),
      ],
      [
        'channel_unavailable',
        () => channelRegistry.findChannel.mockReturnValue(undefined),
      ],
      [
        'source_disabled',
        () =>
          threadService.findOneAndPopulate.mockResolvedValue({
            ...thread,
            source: { ...thread.source, state: false },
          }),
      ],
    ] as const)('refuses with %s', async (code, arrange) => {
      arrange();

      await expectUnavailable(buildRun(WorkflowType.conversational), code);
    });

    it('refuses a run without thread before looking it up', async () => {
      await expectUnavailable(
        buildRun(WorkflowType.conversational, { thread: null }),
        'thread_unavailable',
      );
      expect(threadService.findOneAndPopulate).not.toHaveBeenCalled();
    });

    it('refuses a subscriber without channel before looking it up', async () => {
      subscriberService.findOne.mockResolvedValue({
        ...subscriber,
        channel: undefined,
      });

      await expectUnavailable(
        buildRun(WorkflowType.conversational),
        'channel_unavailable',
      );
      expect(channelRegistry.findChannel).not.toHaveBeenCalled();
    });

    it('follows parent links given as ids up to the last run found', async () => {
      workflowRunService.findOne.mockImplementation(async (id: string) =>
        id === 'run-0'
          ? {
              id: 'run-0',
              parentRun: 'run-gone',
              input: {
                message: rootMessage,
                text: 'Hi',
                thread_id: 'thread-1',
              },
            }
          : null,
      );
      const event = (await restorer.restore(
        buildRun(WorkflowType.conversational, { parentRun: 'run-0' }),
      )) as SyntheticMessageInboundEvent;

      expect(workflowRunService.findOne.mock.calls).toEqual([
        ['run-0'],
        ['run-gone'],
      ]);
      expect(event.toStdIncomingMessage()).toEqual(rootMessage);
    });
  });

  it('ignores run metadata that is not text', async () => {
    const manual = await restorer.restore(
      buildRun(WorkflowType.manual, {
        input: null,
        metadata: { initiated_by: 42 },
      }),
    );
    const scheduled = await restorer.restore(
      buildRun(WorkflowType.scheduled, {
        metadata: { schedule: { cron: '* * * * *' }, triggered_at: 0 },
      }),
    );

    expect(manual.buildInput()).toEqual({});
    expect(manual.getMetadata()).toEqual({
      trigger: WorkflowType.manual,
      initiated_by: null,
    });
    expect(scheduled.buildInput()).toEqual({
      schedule: null,
      triggered_at: null,
    });
  });

  it('refuses runs of an unsupported workflow type', async () => {
    await expectUnavailable(
      buildRun('mystery' as WorkflowType),
      'unsupported_trigger',
    );
  });

  it('rebuilds a manual event from the run input and initiator', async () => {
    const run = buildRun(WorkflowType.manual, {
      input: { order: 'A-1' },
      metadata: { trigger: 'manual', initiated_by: 'user-1' },
    });
    const event = await restorer.restore(run);

    expect(event).toBeInstanceOf(ManualEventWrapper);
    expect(event.getInitiator()).toBe(user);
    expect(event.buildInput()).toEqual({ order: 'A-1' });
    expect(event.getMetadata()).toEqual({
      trigger: 'manual',
      initiated_by: 'user-1',
    });
    expect(event.getWorkflowId()).toBe('workflow-1');
    expect(event.getThreadId()).toBeUndefined();
  });

  it('rebuilds a scheduled event from the run metadata', async () => {
    const run = buildRun(WorkflowType.scheduled, {
      metadata: {
        trigger: 'scheduled',
        schedule: '0 * * * *',
        triggered_at: '2026-01-01T10:00:00.000Z',
      },
    });
    const event = await restorer.restore(run);

    expect(event).toBeInstanceOf(ScheduledEventWrapper);
    expect(event.getInitiator()).toBe(user);
    expect(event.buildInput()).toEqual({
      schedule: '0 * * * *',
      triggered_at: '2026-01-01T10:00:00.000Z',
    });
  });

  it('refuses runs whose initiator is gone', async () => {
    userService.findOne.mockResolvedValue(null);

    await expectUnavailable(
      buildRun(WorkflowType.manual),
      'initiator_unavailable',
    );
    await expectUnavailable(
      buildRun(WorkflowType.manual, { triggeredBy: null }),
      'initiator_unavailable',
    );
  });
});
