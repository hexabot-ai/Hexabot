/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Source,
  StdEventType,
  StdOutgoingMessageEnvelope,
  Subscriber,
} from '@hexabot-ai/types';
import { Request, Response } from 'express';

import { SubscriberCreateDto } from '@/chat/dto/subscriber.dto';

import { InboundEventMiddlewareRegistry } from '../../services/inbound-event-middleware.registry';
import { SubscriberResolver } from '../../services/subscriber-resolver.service';
import { ChannelEventBus } from '../channel-event-bus';
import type ChannelInboundEvent from '../inbound-events/channel-inbound-event';
import type MessageInboundEvent from '../inbound-events/message-inbound-event';

import { HttpChannelHandler } from './http-channel-handler';

class TestHttpChannelHandler extends HttpChannelHandler<any> {
  events: ChannelInboundEvent[] = [];

  constructor() {
    super('test');
  }

  protected async decode(): Promise<ChannelInboundEvent[]> {
    return this.events;
  }

  async getSubscriberData(): Promise<SubscriberCreateDto> {
    return {} as SubscriberCreateDto;
  }

  protected async doSendMessage(
    _event: MessageInboundEvent<any>,
    _envelope: StdOutgoingMessageEnvelope,
  ): Promise<{ mid: string }> {
    return { mid: 'sent-message' };
  }
}

const source = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  settings: {},
} as Source;
const createEvent = (type: StdEventType = StdEventType.message) => ({
  getEventType: jest.fn().mockReturnValue(type),
  preprocess: jest.fn().mockResolvedValue(undefined),
  setHandler: jest.fn(),
  setSourceContext: jest.fn(),
  setWorkflowId: jest.fn(),
  setInitiator: jest.fn(),
});

describe('HttpChannelHandler inbound event middleware', () => {
  let handler: TestHttpChannelHandler;
  let middlewareRegistry: jest.Mocked<
    Pick<InboundEventMiddlewareRegistry, 'dispatch'>
  >;
  let subscriberResolver: jest.Mocked<Pick<SubscriberResolver, 'resolve'>>;
  let channelEventBus: jest.Mocked<
    Pick<ChannelEventBus, 'emitMessage' | 'emitStatusEvent'>
  >;
  let logger: { warn: jest.Mock; error: jest.Mock };
  let req: Request;
  let res: jest.Mocked<Pick<Response, 'status' | 'json'>>;

  beforeEach(() => {
    handler = new TestHttpChannelHandler();
    middlewareRegistry = {
      dispatch: jest.fn(async (_event, next) => next()),
    };
    subscriberResolver = {
      resolve: jest
        .fn()
        .mockResolvedValue({ id: 'subscriber-1' } as Subscriber),
    };
    channelEventBus = {
      emitMessage: jest.fn().mockResolvedValue(undefined),
      emitStatusEvent: jest.fn(),
    };
    logger = {
      warn: jest.fn(),
      error: jest.fn(),
    };
    req = { method: 'POST' } as Request;
    res = {
      status: jest.fn(),
      json: jest.fn(),
    };
    res.status.mockReturnValue(res as unknown as Response);
    res.json.mockReturnValue(res as unknown as Response);

    Object.assign(handler, {
      channelEventBus,
      inboundEventMiddlewareRegistry: middlewareRegistry,
      logger,
      subscriberResolver,
    });
  });

  it('acknowledges before middleware and runs middleware before message processing', async () => {
    const event = createEvent();
    const calls: string[] = [];
    handler.events = [event as unknown as ChannelInboundEvent];
    res.json.mockImplementation(() => {
      calls.push('ack');

      return res as unknown as Response;
    });
    middlewareRegistry.dispatch.mockImplementation(async (_event, next) => {
      calls.push('middleware');
      await next();
    });
    subscriberResolver.resolve.mockImplementation(async () => {
      calls.push('subscriber');

      return { id: 'subscriber-1' } as Subscriber;
    });
    event.preprocess.mockImplementation(async () => {
      calls.push('preprocess');
    });
    channelEventBus.emitMessage.mockImplementation(async () => {
      calls.push('message');
    });

    await handler.handle(req, res as unknown as Response, source);

    expect(calls).toEqual([
      'ack',
      'middleware',
      'subscriber',
      'preprocess',
      'message',
    ]);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(event.setHandler).toHaveBeenCalledWith(handler);
    expect(event.setSourceContext).toHaveBeenCalledWith(source.id, {});
  });

  it('short-circuits before subscriber resolution and event dispatch', async () => {
    const event = createEvent();
    handler.events = [event as unknown as ChannelInboundEvent];
    middlewareRegistry.dispatch.mockResolvedValue(undefined);

    await handler.handle(req, res as unknown as Response, source);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(subscriberResolver.resolve).not.toHaveBeenCalled();
    expect(event.preprocess).not.toHaveBeenCalled();
    expect(channelEventBus.emitMessage).not.toHaveBeenCalled();
  });

  it('runs status events through middleware', async () => {
    const event = createEvent(StdEventType.read);
    handler.events = [event as unknown as ChannelInboundEvent];

    await handler.handle(req, res as unknown as Response, source);

    expect(middlewareRegistry.dispatch).toHaveBeenCalledWith(
      event,
      expect.any(Function),
    );
    expect(channelEventBus.emitStatusEvent).toHaveBeenCalledWith(event);
    expect(channelEventBus.emitMessage).not.toHaveBeenCalled();
  });

  it('logs middleware errors after the webhook has been acknowledged', async () => {
    const event = createEvent();
    const error = new Error('middleware failed');
    handler.events = [event as unknown as ChannelInboundEvent];
    middlewareRegistry.dispatch.mockRejectedValue(error);

    await handler.handle(req, res as unknown as Response, source);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to process webhook event',
      error,
    );
  });
});
