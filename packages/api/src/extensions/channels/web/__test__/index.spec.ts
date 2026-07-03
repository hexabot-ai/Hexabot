/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { OutgoingMessageType, Source, StdEventType } from '@hexabot-ai/types';
import { JwtService } from '@nestjs/jwt';
import { TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { DataSource } from 'typeorm';

import { AttachmentService } from '@/attachment/services/attachment.service';
import { SourceOrmEntity } from '@/channel/entities/source.entity';
import { ChannelEventBus } from '@/channel/lib/channel-event-bus';
import { UnsupportedOutgoingFormatError } from '@/channel/lib/outbound';
import { ChannelAttachmentService } from '@/channel/services/channel-attachment.service';
import { ChannelRegistry } from '@/channel/services/channel-registry.service';
import { SourceService } from '@/channel/services/source.service';
import { MessageService } from '@/chat/services/message.service';
import { SubscriberService } from '@/chat/services/subscriber.service';
import { ThreadService } from '@/chat/services/thread.service';
import { MenuService } from '@/cms/services/menu.service';
import { installLabelGroupFixturesTypeOrm } from '@/utils/test/fixtures/label-group';
import { installMessageFixturesTypeOrm } from '@/utils/test/fixtures/message';
import { I18nServiceProvider } from '@/utils/test/providers/i18n-service.provider';
import { buildTestingMocks } from '@/utils/test/utils';
import { SocketRequest } from '@/websocket/utils/socket-request';
import { SocketResponse } from '@/websocket/utils/socket-response';
import { WebsocketGateway } from '@/websocket/websocket.gateway';

import WebChannelHandler from '../index.channel';

const createDeferred = () => {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

describe('WebChannelHandler', () => {
  let module: TestingModule;
  let subscriberService: SubscriberService;
  let threadService: ThreadService;
  let handler: WebChannelHandler;
  let webSource: Source;

  const menuServiceMock = {
    getTree: jest.fn().mockResolvedValue([]),
  } as jest.Mocked<Pick<MenuService, 'getTree'>>;
  const attachmentServiceMock = {
    findOne: jest.fn(),
    store: jest.fn(),
    create: jest.fn(),
  } as jest.Mocked<Pick<AttachmentService, 'findOne' | 'store' | 'create'>>;
  const websocketGatewayMock = {
    broadcast: jest.fn(),
  } as jest.Mocked<Pick<WebsocketGateway, 'broadcast'>>;
  const channelAttachmentServiceMock = {
    getPublicUrl: jest
      .fn()
      .mockResolvedValue('http://public.url/download/filename.extension?t=any'),
  } as jest.Mocked<Pick<ChannelAttachmentService, 'getPublicUrl'>>;
  const sourceServiceMock = {
    findActiveById: jest.fn(),
    ensureDefaultSources: jest.fn(),
  } as jest.Mocked<
    Pick<SourceService, 'findActiveById' | 'ensureDefaultSources'>
  >;

  beforeAll(async () => {
    webSource = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      createdAt: new Date(),
      updatedAt: new Date(),
      name: 'web-source',
      channel: 'web',
      settings: {
        allowed_domains:
          'https://example.com/,https://test.com,http://invalid-url',
      },
      state: true,
      defaultWorkflow: null,
    };
    sourceServiceMock.findActiveById.mockResolvedValue(webSource);

    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [
        ChannelEventBus,
        ChannelRegistry,
        MessageService,
        ThreadService,
        JwtService,
        WebChannelHandler,
        I18nServiceProvider,
        {
          provide: MenuService,
          useValue: menuServiceMock,
        },
        {
          provide: AttachmentService,
          useValue: attachmentServiceMock,
        },
        {
          provide: ChannelAttachmentService,
          useValue: channelAttachmentServiceMock,
        },
        {
          provide: WebsocketGateway,
          useValue: websocketGatewayMock,
        },
        {
          provide: SourceService,
          useValue: sourceServiceMock,
        },
      ],
      typeorm: {
        fixtures: [
          installLabelGroupFixturesTypeOrm,
          installMessageFixturesTypeOrm,
        ],
      },
    });

    module = testing.module;

    [subscriberService, threadService, handler] = await testing.getMocks([
      SubscriberService,
      ThreadService,
      WebChannelHandler,
    ]);

    const dataSource = module.get(DataSource);
    const sourceRepository = dataSource.getRepository(SourceOrmEntity);
    await sourceRepository.save(
      sourceRepository.create({
        id: webSource.id,
        name: webSource.name,
        channel: webSource.channel,
        settings: webSource.settings,
        state: webSource.state,
        defaultWorkflow: null,
      }),
    );

    const fixtureSubscriber =
      await subscriberService.findOneByForeignId('foreign-id-web-1');
    if (fixtureSubscriber) {
      await subscriberService.updateOne(fixtureSubscriber.id, {
        source: webSource.id,
      });
    }

    await handler.onModuleInit();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('should have correct name', () => {
    expect(handler).toBeDefined();
    expect(handler.getName()).toEqual('web');
  });

  it('should allow the request if the origin is in the allowed domains', async () => {
    const req = {
      headers: {
        origin: 'https://example.com',
      },
      method: 'GET',
    } as unknown as SocketRequest;
    const res = {
      set: jest.fn(),
    } as any;

    await expect(
      handler['ensureValidCors'](req, res, webSource),
    ).resolves.not.toThrow();

    expect(res.set).toHaveBeenCalledWith(
      'Access-Control-Allow-Origin',
      'https://example.com',
    );
    expect(res.set).toHaveBeenCalledWith(
      'Access-Control-Allow-Credentials',
      'true',
    );
  });

  it('should reject the request if the origin is not in the allowed domains', async () => {
    const req = {
      headers: {
        origin: 'https://notallowed.com',
      },
      method: 'GET',
    } as unknown as SocketRequest;
    const res = {
      set: jest.fn(),
    } as any;

    await expect(
      handler['ensureValidCors'](req, res, webSource),
    ).rejects.toThrow('CORS - Domain not allowed!');

    expect(res.set).toHaveBeenCalledWith('Access-Control-Allow-Origin', '');
  });

  it('rejects direct HTTP webhook requests for web channel', async () => {
    const req = {
      method: 'GET',
      query: { _get: 'polling' },
      headers: {
        origin: 'https://example.com',
      },
      session: {},
    } as unknown as Request;
    const res = {
      set: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;

    await handler.handle(req, res, {
      ...webSource,
      settings: {
        allowed_domains: 'https://example.com',
      },
    });

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      err: 'Web Channel Handler : Unauthorized!',
    });
  });

  it('sends messages through outbound formatter and broadcasts to sockets', async () => {
    websocketGatewayMock.broadcast.mockClear();
    const subscriber = {
      channel: {
        data: {
          isSocket: true,
        },
      },
    } as any;
    const event = {
      getInitiator: () => subscriber,
      getThreadId: () => 'thread-id',
      getSourceId: () => webSource.id,
    } as any;
    const response = await handler.sendMessage(
      event,
      {
        type: OutgoingMessageType.text,
        data: { text: 'hello world' },
      },
      {},
    );

    expect(response).toEqual({
      mid: expect.any(String),
    });
    expect(websocketGatewayMock.broadcast).toHaveBeenCalledWith(
      subscriber,
      StdEventType.message,
      expect.objectContaining({
        type: 'text',
        data: { text: 'hello world' },
        author: 'chatbot',
        thread_id: 'thread-id',
        handover: false,
      }),
      [],
    );
  });

  it('rejects system envelopes in sendMessage', async () => {
    const subscriber = {
      channel: {
        data: {
          isSocket: true,
        },
      },
    } as any;
    const event = {
      getInitiator: () => subscriber,
      getThreadId: () => 'thread-id',
      getSourceId: () => webSource.id,
    } as any;

    await expect(
      handler.sendMessage(
        event,
        {
          type: OutgoingMessageType.system,
          data: { outcome: 'noop' },
        },
        {},
      ),
    ).rejects.toBeInstanceOf(UnsupportedOutgoingFormatError);
  });

  it('creates a new subscriber if needed + set a new session', async () => {
    const req = {
      isSocket: true,
      query: { first_name: 'New', last_name: 'Subscriber' },
      session: {},
      headers: { 'user-agent': 'browser' },
      socket: {
        handshake: { address: '127.0.0.1' },
      },
      user: {},
    } as any as SocketRequest;
    const generatedId = 'web-test';
    const clearMock = jest
      .spyOn(handler, 'generateId')
      .mockImplementation(() => generatedId);
    const subscriber = await handler['getOrCreateSession'](req, webSource);
    const expectedAttrs = {
      assignedAt: null,
      assignedTo: null,
      channel: {
        name: 'web',
        data: {
          agent: req.headers['user-agent'],
          isSocket: true,
          ipAddress: '127.0.0.1',
        },
      },
      country: '',
      firstName: req.query.first_name,
      foreignId: generatedId,
      gender: 'male',
      labels: [],
      lastName: req.query.last_name,
      locale: '',
      timezone: 0,
    };
    const subscriberAttrs = Object.keys(expectedAttrs).reduce((acc, curr) => {
      acc[curr] = subscriber[curr];

      return acc;
    }, {});
    expect(subscriberAttrs).toEqual(expectedAttrs);
    expect(req.session).toEqual({
      web: {
        profile: subscriber,
        sourceId: webSource.id,
      },
    });
    clearMock.mockRestore();

    // Subsequent request
    const subscriber2nd = await handler['getOrCreateSession'](req, webSource);
    expect(subscriber2nd.id).toBe(subscriber.id);
    expect(req.session).toEqual({
      web: {
        profile: subscriber2nd,
        sourceId: webSource.id,
      },
    });
  });

  it('subscribes and returns the message history', async () => {
    const subscriber =
      await subscriberService.findOneByForeignIdAndPopulate('foreign-id-web-1');
    if (!subscriber) {
      throw new Error('Expected fixture subscriber "foreign-id-web-1"');
    }
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const req = {
      isSocket: true,
      query: { since: tomorrow },
      session: {
        cookie: { originalMaxAge: 0 },
        web: {
          profile: subscriber,
          sourceId: webSource.id,
        },
      },
      headers: { 'user-agent': 'browser' },
      socket: {
        join: (_foreignId: string) => {},
      },
    } as any as SocketRequest;
    const res = {
      status: (code: number) => {
        expect(code).toEqual(200);

        return res;
      },
      json: (payload: any) => {
        expect(payload.messages.length).toEqual(3);
      },
    } as any as SocketResponse;

    let joinedSocket = false;

    const clearMock = jest
      .spyOn(req.socket, 'join')
      .mockImplementation((foreignId: string) => {
        expect(foreignId).toBe(subscriber.foreignId);
        joinedSocket = true;
      });
    await handler['subscribe'](req, res, webSource);
    expect(joinedSocket).toBe(true);
    clearMock.mockRestore();
  });

  it('subscribes a fresh session with no thread and returns empty history', async () => {
    const req = {
      isSocket: true,
      query: { first_name: 'Fresh', last_name: 'User' },
      session: {},
      headers: { 'user-agent': 'browser' },
      socket: {
        handshake: { address: '127.0.0.1' },
        join: (_foreignId: string) => {},
      },
      user: {},
    } as any as SocketRequest;
    const generatedId = `web-empty-${Date.now()}`;
    const clearMock = jest
      .spyOn(handler, 'generateId')
      .mockImplementation(() => generatedId);
    const res = {
      status: (code: number) => {
        expect(code).toEqual(200);

        return res;
      },
      json: (payload: any) => {
        expect(payload.thread_id).toBeNull();
        expect(payload.messages).toEqual([]);
      },
    } as any as SocketResponse;

    await handler['subscribe'](req, res, webSource);

    expect(req.session.web?.threadId).toBeUndefined();
    clearMock.mockRestore();
  });

  it('returns thread id in first incoming message response and stores it in session', async () => {
    const req = {
      isSocket: true,
      query: { first_name: 'Realtime', last_name: 'User' },
      session: {},
      headers: { 'user-agent': 'browser' },
      socket: {
        handshake: { address: '127.0.0.1' },
      },
      user: {},
    } as any as SocketRequest;
    const generatedId = `web-realtime-${Date.now()}`;
    const clearMock = jest
      .spyOn(handler, 'generateId')
      .mockImplementation(() => generatedId);
    const profile = await handler['getOrCreateSession'](req as any, webSource);
    expect(req.session.web?.threadId).toBeUndefined();

    req.body = {
      type: 'text',
      data: {
        text: 'Hello there',
      },
    };
    req.query = {};
    req.session.web = {
      ...req.session.web,
      profile,
    };

    const emitMessageSpy = jest
      .spyOn(handler['channelEventBus'], 'emitMessage')
      .mockResolvedValue(undefined);
    let responseThreadId: string | undefined;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for message response'));
      }, 2000);
      const res = {
        status: (code: number) => {
          expect(code).toEqual(200);

          return res;
        },
        json: (payload: any) => {
          clearTimeout(timeout);
          expect(typeof payload.thread_id).toBe('string');
          responseThreadId = payload.thread_id;
          resolve();
        },
      } as any as SocketResponse;

      handler['handleEvent'](req as any, res, webSource);
    });

    await Promise.resolve();
    expect(emitMessageSpy).toHaveBeenCalledWith(expect.anything());
    expect(req.session.web?.threadId).toBe(responseThreadId);
    clearMock.mockRestore();
    emitMessageSpy.mockRestore();
  });

  it('creates a new thread when the web session points to a closed thread', async () => {
    const req = {
      isSocket: true,
      query: { first_name: 'Closed', last_name: 'Thread' },
      session: {},
      headers: { 'user-agent': 'browser' },
      socket: {
        handshake: { address: '127.0.0.1' },
      },
      user: {},
    } as any as SocketRequest;
    const generatedId = `web-closed-thread-${Date.now()}`;
    const clearMock = jest
      .spyOn(handler, 'generateId')
      .mockImplementation(() => generatedId);
    const profile = await handler['getOrCreateSession'](req as any, webSource);
    const closedAt = new Date('2026-03-01T06:00:00.000Z');
    const closedThread = await threadService.create({
      subscriber: profile.id,
      source: webSource.id,
      status: 'closed',
      closeReason: 'manual',
      closedAt,
      lastMessageAt: closedAt,
    });

    req.body = {
      type: 'text',
      data: {
        text: 'Start a new thread',
      },
    };
    req.query = {};
    req.session.web = {
      ...req.session.web,
      profile,
      threadId: closedThread.id,
    };

    let responseThreadId: string | undefined;
    let dispatchedEvent: { getThreadId: () => string | undefined } | undefined;
    const emitMessageSpy = jest
      .spyOn(handler['channelEventBus'], 'emitMessage')
      .mockImplementation((event: any) => {
        dispatchedEvent = event;

        return Promise.resolve();
      });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for closed-thread response'));
      }, 2000);
      const res = {
        status: (code: number) => {
          expect(code).toEqual(200);

          return res;
        },
        json: (payload: any) => {
          clearTimeout(timeout);
          expect(typeof payload.thread_id).toBe('string');
          responseThreadId = payload.thread_id;
          resolve();
        },
      } as any as SocketResponse;

      handler['handleEvent'](req as any, res, webSource);
    });

    await Promise.resolve();

    expect(responseThreadId).toBeDefined();
    expect(responseThreadId).not.toBe(closedThread.id);
    expect(req.session.web?.threadId).toBe(responseThreadId);
    expect(dispatchedEvent?.getThreadId()).toBe(responseThreadId);

    const storedClosedThread = await threadService.findOne(closedThread.id);
    const storedNewThread = await threadService.findOne(responseThreadId!);

    expect(storedClosedThread?.status).toBe('closed');
    expect(storedClosedThread?.closeReason).toBe('manual');
    expect(storedClosedThread?.closedAt).toEqual(closedAt);
    expect(storedNewThread?.status).toBe('open');
    expect(emitMessageSpy).toHaveBeenCalledWith(expect.anything());

    clearMock.mockRestore();
    emitMessageSpy.mockRestore();
  });

  it('rehydrates a missing web session from message author foreign id', async () => {
    const subscriber =
      await subscriberService.findOneByForeignIdAndPopulate('foreign-id-web-1');
    if (!subscriber) {
      throw new Error('Expected fixture subscriber "foreign-id-web-1"');
    }

    const req = {
      isSocket: true,
      query: {},
      session: {},
      headers: { 'user-agent': 'browser' },
      socket: {
        handshake: { address: '127.0.0.1' },
      },
      body: {
        type: 'text',
        author: subscriber.foreignId,
        data: {
          text: 'Recover my session',
        },
      },
      user: {},
    } as any as SocketRequest;
    const emitMessageSpy = jest
      .spyOn(handler['channelEventBus'], 'emitMessage')
      .mockResolvedValue(undefined);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for recovered-session response'));
      }, 2000);
      const res = {
        status: (code: number) => {
          expect(code).toEqual(200);

          return res;
        },
        json: (payload: any) => {
          clearTimeout(timeout);
          expect(payload).toEqual(
            expect.objectContaining({
              type: 'text',
            }),
          );
          resolve();
        },
      } as any as SocketResponse;

      handler['handleEvent'](req as any, res, webSource);
    });

    await Promise.resolve();
    expect(req.session.web?.profile?.id).toBe(subscriber.id);
    expect(emitMessageSpy).toHaveBeenCalledWith(expect.anything());
    emitMessageSpy.mockRestore();
  });

  it('acknowledges and broadcasts incoming user messages before async handlers finish', async () => {
    websocketGatewayMock.broadcast.mockClear();
    const req = {
      isSocket: true,
      query: { first_name: 'Order', last_name: 'Check' },
      session: {},
      headers: { 'user-agent': 'browser' },
      socket: {
        handshake: { address: '127.0.0.1' },
      },
      user: {},
    } as any as SocketRequest;
    const generatedId = `web-order-${Date.now()}`;
    const clearMock = jest
      .spyOn(handler, 'generateId')
      .mockImplementation(() => generatedId);
    const profile = await handler['getOrCreateSession'](req as any, webSource);

    req.body = {
      type: 'text',
      data: {
        text: 'Ordering check',
      },
    };
    req.query = {};
    req.session.web = {
      ...req.session.web,
      profile,
    };

    const pendingChatbotWork = Promise.race<void>([]);
    const emitMessageSpy = jest
      .spyOn(handler['channelEventBus'], 'emitMessage')
      .mockImplementation(() => pendingChatbotWork);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for immediate message response'));
      }, 2000);
      const res = {
        status: (code: number) => {
          expect(code).toEqual(200);

          return res;
        },
        json: (_payload: any) => {
          clearTimeout(timeout);
          resolve();
        },
      } as any as SocketResponse;

      handler['handleEvent'](req as any, res, webSource);
    });

    await Promise.resolve();
    expect(websocketGatewayMock.broadcast).toHaveBeenCalled();
    expect(emitMessageSpy).toHaveBeenCalledWith(expect.anything());
    const broadcastCallOrder =
      websocketGatewayMock.broadcast.mock.invocationCallOrder.at(-1);
    const emitMessageCallOrder = emitMessageSpy.mock.invocationCallOrder.at(-1);

    expect(broadcastCallOrder!).toBeLessThan(emitMessageCallOrder!);
    expect(req.session.web?.threadId).toEqual(expect.any(String));
    clearMock.mockRestore();
    emitMessageSpy.mockRestore();
  });

  it('queues async chatbot dispatches per socket after acknowledging messages', async () => {
    const socket = {
      handshake: { address: '127.0.0.1' },
      data: {},
    };
    const session: Record<string, any> = {};
    const reqBase = {
      isSocket: true,
      query: { first_name: 'Queue', last_name: 'User' },
      session,
      headers: { 'user-agent': 'browser' },
      socket,
      user: {},
    } as any as SocketRequest;
    const profile = await handler['getOrCreateSession'](
      reqBase as any,
      webSource,
    );
    const firstDispatch = createDeferred();
    const secondDispatch = createDeferred();
    const dispatches = [firstDispatch, secondDispatch];
    const dispatchedTexts: string[] = [];
    const emitMessageSpy = jest
      .spyOn(handler['channelEventBus'], 'emitMessage')
      .mockImplementation((event: any) => {
        dispatchedTexts.push(event.getText());

        return dispatches[dispatchedTexts.length - 1].promise;
      });
    const sendText = async (text: string) => {
      let responseBody: any;
      const req = {
        ...reqBase,
        query: {},
        body: {
          type: 'text',
          data: { text },
        },
        session: {
          ...session,
          web: {
            ...session.web,
            profile,
          },
        },
      } as any as SocketRequest;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Timed out waiting for ${text} response`));
        }, 2000);
        const res = {
          status: (code: number) => {
            expect(code).toEqual(200);

            return res;
          },
          json: (payload: any) => {
            clearTimeout(timeout);
            responseBody = payload;
            resolve();
          },
        } as any as SocketResponse;

        handler['handleEvent'](req as any, res, webSource);
      });

      Object.assign(session, req.session);

      return responseBody;
    };
    const firstResponse = await sendText('First queued message');
    const secondResponse = await sendText('Second queued message');

    expect(firstResponse.thread_id).toEqual(expect.any(String));
    expect(secondResponse.thread_id).toBe(firstResponse.thread_id);

    await Promise.resolve();
    expect(dispatchedTexts).toEqual(['First queued message']);
    expect(emitMessageSpy).toHaveBeenCalledTimes(1);

    firstDispatch.resolve();
    await firstDispatch.promise;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(dispatchedTexts).toEqual([
      'First queued message',
      'Second queued message',
    ]);
    expect(emitMessageSpy).toHaveBeenCalledTimes(2);

    secondDispatch.resolve();
    await secondDispatch.promise;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(socket.data).not.toHaveProperty('webMessageQueue');

    emitMessageSpy.mockRestore();
  });

  it('rejects chatbot sync before first user message when no thread exists', async () => {
    const req = {
      isSocket: true,
      query: { first_name: 'Sync', last_name: 'User' },
      session: {},
      headers: { 'user-agent': 'browser' },
      socket: {
        handshake: { address: '127.0.0.1' },
      },
      user: {},
    } as any as SocketRequest;
    const generatedId = `web-sync-${Date.now()}`;
    const clearMock = jest
      .spyOn(handler, 'generateId')
      .mockImplementation(() => generatedId);
    const profile = await handler['getOrCreateSession'](req as any, webSource);

    req.body = {
      type: 'text',
      mid: 'sync-mid-1',
      author: 'chatbot',
      sync: true,
      data: {
        text: 'Synthetic bot sync message',
      },
    };
    req.query = {};
    req.session.web = {
      ...req.session.web,
      profile,
    };

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for sync response'));
      }, 2000);
      const res = {
        status: (code: number) => {
          expect(code).toEqual(409);

          return res;
        },
        json: (payload: any) => {
          clearTimeout(timeout);
          expect(payload.err).toMatch(
            /No thread available before first user message/i,
          );
          resolve();
        },
      } as any as SocketResponse;

      handler['handleEvent'](req as any, res, webSource);
    });

    expect(req.session.web?.threadId).toBeUndefined();
    clearMock.mockRestore();
  });

  it('returns 400 for invalid incoming event payload', async () => {
    const req = {
      isSocket: true,
      query: { first_name: 'Invalid', last_name: 'Payload' },
      session: {},
      headers: { 'user-agent': 'browser' },
      socket: {
        handshake: { address: '127.0.0.1' },
      },
      user: {},
    } as any as SocketRequest;
    const generatedId = `web-invalid-${Date.now()}`;
    const clearMock = jest
      .spyOn(handler, 'generateId')
      .mockImplementation(() => generatedId);
    const profile = await handler['getOrCreateSession'](req as any, webSource);

    req.body = {
      type: 'text',
      data: {},
    };
    req.query = {};
    req.session.web = {
      ...req.session.web,
      profile,
    };

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for bad request response'));
      }, 2000);
      const res = {
        status: (code: number) => {
          expect(code).toEqual(400);

          return res;
        },
        json: (payload: any) => {
          clearTimeout(timeout);
          expect(payload).toEqual({
            err: 'Web Channel Handler : Bad Request!',
          });
          resolve();
        },
      } as any as SocketResponse;

      handler['handleEvent'](req as any, res, webSource);
    });

    clearMock.mockRestore();
  });

  it('processes decoder fanout sequentially and keeps a single raw HTTP response body', async () => {
    const req = {
      isSocket: true,
      query: { first_name: 'Fanout', last_name: 'User' },
      session: {},
      headers: { 'user-agent': 'browser' },
      socket: {
        handshake: { address: '127.0.0.1' },
      },
      user: {},
    } as any as SocketRequest;
    const generatedId = `web-fanout-${Date.now()}`;
    const clearMock = jest
      .spyOn(handler, 'generateId')
      .mockImplementation(() => generatedId);
    const profile = await handler['getOrCreateSession'](req as any, webSource);
    req.body = {
      type: 'text',
      data: {
        text: 'Fanout test',
      },
    };
    req.query = {};
    req.session.web = {
      ...req.session.web,
      profile,
    };

    const channelAttrs = handler.getChannelAttributes(req as any);
    const [messageEvent] = handler['inboundEventDecoder'].createEvents(
      req.body,
      channelAttrs,
    );
    const [typingEvent] = handler['inboundEventDecoder'].createEvents(
      { type: 'typing' },
      channelAttrs,
    );
    const createEventsSpy = jest
      .spyOn(handler['inboundEventDecoder'], 'createEvents')
      .mockReturnValueOnce([messageEvent, typingEvent]);
    const emitMessageSpy = jest
      .spyOn(handler['channelEventBus'], 'emitMessage')
      .mockResolvedValue(undefined);
    const emitStatusSpy = jest.spyOn(
      handler['channelEventBus'],
      'emitStatusEvent',
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for fanout response'));
      }, 2000);
      const res = {
        status: (code: number) => {
          expect(code).toEqual(200);

          return res;
        },
        json: (payload: any) => {
          clearTimeout(timeout);
          expect(Array.isArray(payload)).toBe(false);
          expect(payload).toEqual(
            expect.objectContaining({
              type: 'text',
            }),
          );
          resolve();
        },
      } as any as SocketResponse;

      handler['handleEvent'](req as any, res, webSource);
    });

    await Promise.resolve();
    expect(createEventsSpy).toHaveBeenCalledTimes(1);
    expect(emitMessageSpy).toHaveBeenCalledWith(expect.anything());
    expect(emitStatusSpy).toHaveBeenCalledWith(expect.anything());
    clearMock.mockRestore();
    createEventsSpy.mockRestore();
    emitMessageSpy.mockRestore();
    emitStatusSpy.mockRestore();
  });

  it('accepts websocket file events with binary data', async () => {
    const req = {
      isSocket: true,
      query: { first_name: 'Ws', last_name: 'Upload' },
      session: {},
      headers: { 'user-agent': 'browser' },
      socket: {
        handshake: { address: '127.0.0.1' },
      },
      user: {},
    } as any as SocketRequest;
    const generatedId = `web-ws-upload-${Date.now()}`;
    const clearMock = jest
      .spyOn(handler, 'generateId')
      .mockImplementation(() => generatedId);
    const profile = await handler['getOrCreateSession'](req as any, webSource);
    const fileBuffer = Buffer.from('ws-file');
    attachmentServiceMock.store.mockResolvedValueOnce({
      id: 'ws-attachment-id',
      type: 'image/png',
      name: 'ws-file.png',
      size: fileBuffer.byteLength,
    } as any);

    req.body = {
      type: 'file',
      data: {
        type: 'image/png',
        size: fileBuffer.byteLength,
        name: 'ws-file.png',
        file: fileBuffer,
      },
    };
    req.query = {};
    req.session.web = {
      ...req.session.web,
      profile,
    };

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for websocket upload response'));
      }, 2000);
      const res = {
        status: (code: number) => {
          expect(code).toEqual(200);

          return res;
        },
        json: (payload: any) => {
          clearTimeout(timeout);
          expect(payload.type).toEqual('file');
          expect(payload.data).toEqual(
            expect.objectContaining({
              type: 'image',
              url: expect.any(String),
            }),
          );
          expect(payload.data).not.toHaveProperty('file');
          resolve();
        },
      } as any as SocketResponse;

      handler['handleEvent'](req as any, res, webSource);
    });

    expect(attachmentServiceMock.store).toHaveBeenCalledWith(
      fileBuffer,
      expect.objectContaining({
        name: 'ws-file.png',
        type: 'image/png',
        size: fileBuffer.byteLength,
      }),
    );
    clearMock.mockRestore();
  });

  it('rejects file metadata events when binary payload is missing', async () => {
    attachmentServiceMock.store.mockClear();
    const req = {
      isSocket: true,
      query: { first_name: 'Ws', last_name: 'Upload' },
      session: {},
      headers: { 'user-agent': 'browser' },
      socket: {
        handshake: { address: '127.0.0.1' },
      },
      user: {},
    } as any as SocketRequest;
    const generatedId = `web-ws-upload-no-file-${Date.now()}`;
    const clearMock = jest
      .spyOn(handler, 'generateId')
      .mockImplementation(() => generatedId);
    const profile = await handler['getOrCreateSession'](req as any, webSource);

    req.body = {
      type: 'file',
      data: {
        type: 'image/png',
        size: 12,
        name: 'metadata-only.png',
      },
    };
    req.query = {};
    req.session.web = {
      ...req.session.web,
      profile,
    };

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error('Timed out waiting for metadata-only upload response'),
        );
      }, 2000);
      const res = {
        status: (code: number) => {
          expect(code).toEqual(403);

          return res;
        },
        json: (payload: any) => {
          clearTimeout(timeout);
          expect(payload.err).toEqual(
            'Web Channel Handler : File upload failed!',
          );
          resolve();
        },
      } as any as SocketResponse;

      handler['handleEvent'](req as any, res, webSource);
    });

    expect(attachmentServiceMock.store).not.toHaveBeenCalled();
    clearMock.mockRestore();
  });
});
