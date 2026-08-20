/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Source, StdEventType } from '@hexabot-ai/types';
import { Request, Response } from 'express';

import { HelperService } from '@/helper/helper.service';
import { InboundMiddlewareService } from '@/helper/inbound-middleware.service';
import {
  BaseMiddlewareHelper,
  InboundMiddlewareNext,
} from '@/helper/lib/base-middleware-helper';
import { HelperType } from '@/helper/types';

import type ChannelInboundEvent from '../inbound-events/channel-inbound-event';

import { HttpChannelHandler } from './http-channel-handler';

class TestHttpChannelHandler extends HttpChannelHandler<any> {
  public decoded: ChannelInboundEvent<any>[] = [];

  protected async decode(): Promise<ChannelInboundEvent<any>[]> {
    return this.decoded;
  }

  protected async doSendMessage(): Promise<any> {
    return undefined;
  }

  async getSubscriberData(): Promise<any> {
    return {};
  }
}

/** Minimal middleware double driven by the provided `handle` callback. */
const makeMiddleware = (
  priority: number,
  handle: (
    event: ChannelInboundEvent,
    next: InboundMiddlewareNext,
  ) => Promise<void>,
): BaseMiddlewareHelper =>
  ({
    getName: () => `mw-${priority}`,
    getType: () => HelperType.MIDDLEWARE,
    getPriority: () => priority,
    handle,
  }) as unknown as BaseMiddlewareHelper;

describe('HttpChannelHandler inbound middleware ordering', () => {
  const source = { id: 'src-1', settings: {} } as unknown as Source;

  let handler: TestHttpChannelHandler;
  let helperService: jest.Mocked<Pick<HelperService, 'getAllByType'>>;
  let emitMessage: jest.Mock;
  let emitStatusEvent: jest.Mock;
  let resolveSubscriber: jest.SpyInstance;
  let order: string[];

  const buildEvent = (type: StdEventType) => {
    const preprocess = jest.fn(async () => {
      order.push('preprocess');
    });

    return {
      setHandler: jest.fn(),
      setSourceContext: jest.fn(),
      setWorkflowId: jest.fn(),
      setInitiator: jest.fn(() => order.push('setInitiator')),
      getEventType: () => type,
      preprocess,
    } as unknown as ChannelInboundEvent<any>;
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  const req = { method: 'POST', body: {} } as unknown as Request;

  beforeEach(() => {
    order = [];
    helperService = { getAllByType: jest.fn().mockReturnValue([]) };
    handler = new TestHttpChannelHandler('test' as any);
    (handler as any).logger = {
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    (handler as any).inboundMiddlewareService = new InboundMiddlewareService(
      helperService as unknown as HelperService,
    );
    emitMessage = jest.fn(async () => {
      order.push('emitMessage');
    });
    emitStatusEvent = jest.fn(() => {
      order.push('emitStatusEvent');
    });
    (handler as any).channelEventBus = { emitMessage, emitStatusEvent };
    resolveSubscriber = jest
      .spyOn(handler as any, 'resolveSubscriber')
      .mockImplementation(async () => {
        order.push('resolveSubscriber');

        return { id: 'sub-1' };
      });
  });

  it('short-circuits before subscriber resolution, preprocessing and dispatch when dropped', async () => {
    handler.decoded = [buildEvent(StdEventType.message)];
    helperService.getAllByType.mockReturnValue([
      makeMiddleware(0, async () => {
        // drop: never calls next()
        order.push('mw:drop');
      }),
    ] as any);

    await handler.handle(req, res, source);

    expect(order).toEqual(['mw:drop']);
    expect(resolveSubscriber).not.toHaveBeenCalled();
    expect(emitMessage).not.toHaveBeenCalled();
    expect(emitStatusEvent).not.toHaveBeenCalled();
  });

  it('runs the full message pipeline inside the onion when proceeding', async () => {
    handler.decoded = [buildEvent(StdEventType.message)];
    helperService.getAllByType.mockReturnValue([
      makeMiddleware(0, async (_e, next) => {
        order.push('mw:before');
        await next();
        order.push('mw:after');
      }),
    ] as any);

    await handler.handle(req, res, source);

    expect(order).toEqual([
      'mw:before',
      'resolveSubscriber',
      'setInitiator',
      'preprocess',
      'emitMessage',
      'mw:after',
    ]);
  });

  it('short-circuits status events too when dropped', async () => {
    handler.decoded = [buildEvent(StdEventType.delivery)];
    helperService.getAllByType.mockReturnValue([
      makeMiddleware(0, async () => {
        // drop
      }),
    ] as any);

    await handler.handle(req, res, source);

    expect(resolveSubscriber).not.toHaveBeenCalled();
    expect(emitStatusEvent).not.toHaveBeenCalled();
  });
});
