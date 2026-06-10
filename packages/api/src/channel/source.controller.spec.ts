/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { INestApplication, MethodNotAllowedException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, Repository } from 'typeorm';

import { MessageOrmEntity } from '@/chat/entities/message.entity';
import { ThreadOrmEntity } from '@/chat/entities/thread.entity';
import { installMessageFixturesTypeOrm } from '@/utils/test/fixtures/message';
import { closeTypeOrmConnections } from '@/utils/test/test';
import { buildTestingMocks } from '@/utils/test/utils';
import { WEBSOCKET_GATEWAY } from '@/websocket/tokens';
import type { WebsocketGateway } from '@/websocket/websocket.gateway';

import { SourceOrmEntity } from './entities/source.entity';
import { SourceService } from './services/source.service';
import { SourceController } from './source.controller';

const createSourceServiceMock = () => {
  return {
    canPopulate: jest.fn().mockReturnValue(false),
    find: jest.fn(),
    findAndPopulate: jest.fn(),
    count: jest.fn(),
    findOne: jest.fn(),
    findOneAndPopulate: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
    getRepository: jest.fn().mockReturnValue({
      repository: {
        target: {
          name: 'SourceOrmEntity',
        },
      },
    }),
  };
};

describe('SourceController', () => {
  let controller: SourceController;
  let sourceService: ReturnType<typeof createSourceServiceMock>;

  beforeEach(() => {
    sourceService = createSourceServiceMock();
    controller = new SourceController(
      sourceService as unknown as SourceService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('delegates source creation to SourceService', async () => {
    const payload = {
      name: 'main-web',
      channel: 'web',
      settings: {},
      state: true,
      defaultWorkflow: null,
    };
    const created = { id: 'source-1', ...payload };
    sourceService.create.mockResolvedValue(created);

    const result = await controller.create(payload);

    expect(sourceService.create).toHaveBeenCalledWith(payload);
    expect(result).toEqual(created);
  });

  it('delegates source update to SourceService', async () => {
    const sourceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const payload = { name: 'updated' };
    const updated = { id: sourceId, ...payload };
    sourceService.updateOne.mockResolvedValue(updated);

    const result = await controller.updateOne(sourceId, payload);

    expect(sourceService.updateOne).toHaveBeenCalledWith(sourceId, payload);
    expect(result).toEqual(updated);
  });
});

describe('SourceController (HTTP pipes)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const sourceService = createSourceServiceMock();
    sourceService.findOne.mockResolvedValue(null);
    sourceService.find.mockResolvedValue([]);
    sourceService.count.mockResolvedValue(0);

    const { module } = await buildTestingMocks({
      controllers: [SourceController],
      providers: [{ provide: SourceService, useValue: sourceService }],
    });

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects malformed source id before reaching controller logic', async () => {
    await request(app.getHttpServer()).get('/source/not-a-uuid').expect(404);
  });
});

describe('SourceController (TypeORM cascade)', () => {
  let module: TestingModule;
  let controller: SourceController;
  let sourceRepository: Repository<SourceOrmEntity>;
  let threadRepository: Repository<ThreadOrmEntity>;
  let messageRepository: Repository<MessageOrmEntity>;
  const websocketGatewayMock = {
    joinSockets: jest.fn(),
    broadcastWorkflowEvent: jest.fn(),
  } as jest.Mocked<
    Pick<WebsocketGateway, 'joinSockets' | 'broadcastWorkflowEvent'>
  >;

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['controllers'],
      controllers: [SourceController],
      providers: [
        {
          provide: WEBSOCKET_GATEWAY,
          useValue: websocketGatewayMock,
        },
      ],
      typeorm: {
        fixtures: installMessageFixturesTypeOrm,
      },
    });

    module = testing.module;
    [controller] = await testing.getMocks([SourceController]);
    const dataSource = module.get<DataSource>(DataSource);
    sourceRepository = dataSource.getRepository(SourceOrmEntity);
    threadRepository = dataSource.getRepository(ThreadOrmEntity);
    messageRepository = dataSource.getRepository(MessageOrmEntity);
  });

  afterAll(async () => {
    if (module) {
      await module.close();
    }

    await closeTypeOrmConnections();
  });

  it('prevents deleting a source and preserves linked threads and messages', async () => {
    const source = await sourceRepository.findOne({
      where: { channel: 'web' },
    });

    if (!source) {
      throw new Error('Expected a source fixture for web channel');
    }

    const threadCountBefore = await threadRepository.count({
      where: { source: { id: source.id } },
    });
    const messageCountBefore = await messageRepository.count();

    expect(threadCountBefore).toBeGreaterThan(0);
    expect(messageCountBefore).toBeGreaterThan(0);

    await expect(controller.deleteSource(source.id)).rejects.toThrow(
      MethodNotAllowedException,
    );

    const storedSource = await sourceRepository.findOne({
      where: { id: source.id },
    });
    const threadCountAfter = await threadRepository.count({
      where: { source: { id: source.id } },
    });
    const messageCountAfter = await messageRepository.count();

    expect(storedSource).not.toBeNull();
    expect(threadCountAfter).toBe(threadCountBefore);
    expect(messageCountAfter).toBe(messageCountBefore);
  });
});
