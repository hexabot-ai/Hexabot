/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { OutgoingMessageType, StdOutgoingMessage } from '@hexabot-ai/types';

import { ActionService } from '@/actions/actions.service';
import { ALL_WORKFLOW_TYPES } from '@/actions/types';
import { StatsType } from '@/analytics/entities/stats.entity';
import {
  OutboundMessageRefusedError,
  OutboundMessageService,
} from '@/channel/services/outbound-message.service';
import { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';

import { SendMessageToThreadAction } from './send-message-to-thread.action';

const THREAD_ID = '11111111-1111-4111-8111-111111111111';
const SUBSCRIBER_ID = '22222222-2222-4222-8222-222222222222';
const message: StdOutgoingMessage = {
  type: OutgoingMessageType.text,
  data: { text: 'Your request was approved' },
};

describe('SendMessageToThreadAction', () => {
  let action: SendMessageToThreadAction;
  let outbound: { sendToThread: jest.Mock; sendToSubscriber: jest.Mock };
  let emit: jest.Mock;
  let context: WorkflowRuntimeContext;

  const execute = (input: Record<string, unknown>) =>
    action.execute({
      input: action.parseInput(input),
      context,
      settings: {},
      bindings: {},
    });

  beforeEach(() => {
    const sent = {
      mid: 'mid-sent',
      channel: 'web',
      thread: { id: THREAD_ID },
      recipient: { id: SUBSCRIBER_ID },
    };
    outbound = {
      sendToThread: jest.fn().mockResolvedValue(sent),
      sendToSubscriber: jest.fn().mockResolvedValue(sent),
    };
    emit = jest.fn();
    context = { eventEmitter: { emit } } as unknown as WorkflowRuntimeContext;
    action = new SendMessageToThreadAction(
      { register: jest.fn() } as unknown as ActionService,
      outbound as unknown as OutboundMessageService,
    );
  });

  it('runs in every type of workflow', () => {
    expect(action.getName()).toBe('send_message_to_thread');
    expect(action.workflowTypes).toEqual(ALL_WORKFLOW_TYPES);
  });

  it('sends the message on the thread it is given', async () => {
    const output = await execute({ thread_id: THREAD_ID, message });

    expect(outbound.sendToThread).toHaveBeenCalledWith(THREAD_ID, message, {
      origin: 'workflow',
    });
    expect(outbound.sendToSubscriber).not.toHaveBeenCalled();
    expect(output).toEqual({
      sent: {
        mid: 'mid-sent',
        channel: 'web',
        type: OutgoingMessageType.text,
        envelope: message,
      },
      thread_id: THREAD_ID,
      subscriber_id: SUBSCRIBER_ID,
    });
    expect(action.parseOutput(output)).toEqual(output);
  });

  it('sends the message to the subscriber it is given', async () => {
    const output = await execute({ subscriber_id: SUBSCRIBER_ID, message });

    expect(outbound.sendToSubscriber).toHaveBeenCalledWith(
      SUBSCRIBER_ID,
      message,
      { origin: 'workflow' },
    );
    expect(outbound.sendToThread).not.toHaveBeenCalled();
    expect(output).toMatchObject({
      thread_id: THREAD_ID,
      subscriber_id: SUBSCRIBER_ID,
    });
  });

  it('counts the message as an outgoing one', async () => {
    await execute({ thread_id: THREAD_ID, message });

    expect(emit.mock.calls).toEqual([
      ['hook:stats:entry', StatsType.outgoing, 'Outgoing'],
      ['hook:stats:entry', StatsType.all_messages, 'All Messages'],
    ]);
  });

  it('fails with the reason the message was refused, and counts nothing', async () => {
    outbound.sendToThread.mockRejectedValue(
      new OutboundMessageRefusedError(
        'thread_not_found',
        `Thread with ID ${THREAD_ID} not found`,
      ),
    );

    await expect(execute({ thread_id: THREAD_ID, message })).rejects.toThrow(
      `Thread with ID ${THREAD_ID} not found`,
    );
    expect(emit).not.toHaveBeenCalled();
  });

  describe('input', () => {
    it.each([
      ['neither a thread nor a subscriber', {}, 'thread_id'],
      [
        'both a thread and a subscriber',
        { thread_id: THREAD_ID, subscriber_id: SUBSCRIBER_ID },
        'subscriber_id',
      ],
    ])('refuses %s', (_case, ids, path) => {
      const parsed = action.inputSchema.safeParse({ ...ids, message });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues).toEqual([
        expect.objectContaining({
          message: 'Give either `thread_id` or `subscriber_id`',
          path: [path],
        }),
      ]);
    });

    it.each([
      [
        OutgoingMessageType.quickReply,
        {
          text: 'Pick one',
          quickReplies: [{ title: 'Yes', payload: 'yes' }],
        },
      ],
      [
        OutgoingMessageType.buttons,
        {
          text: 'Open it',
          buttons: [{ type: 'postback', title: 'Open', payload: 'open' }],
        },
      ],
      [
        OutgoingMessageType.attachment,
        {
          attachment: { type: 'file', payload: { url: 'https://x.io/a.pdf' } },
        },
      ],
    ])('accepts a %s envelope', (type, data) => {
      const envelope = { type, data };
      const parsed = action.inputSchema.safeParse({
        thread_id: THREAD_ID,
        message: envelope,
      });

      expect(parsed.error?.issues).toBeUndefined();
      expect(parsed.data?.message).toEqual(envelope);
    });

    it('refuses what is not a message envelope', () => {
      expect(
        action.inputSchema.safeParse({
          thread_id: THREAD_ID,
          message: { type: 'system', data: { outcome: 'x' } },
        }).success,
      ).toBe(false);
      expect(
        action.inputSchema.safeParse({ thread_id: THREAD_ID, message: 'Hi' })
          .success,
      ).toBe(false);
    });
  });
});
