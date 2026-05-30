/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { EventEmitter2 } from '@nestjs/event-emitter';
import { TestingModule } from '@nestjs/testing';

import {
  installStatsFixturesTypeOrm,
  statsFixtures,
} from '@/utils/test/fixtures/stats';
import { buildTestingMocks } from '@/utils/test/utils';

import { StatsType } from '../entities/stats.entity';

import { StatsRepository } from './stats.repository';

describe('StatsRepository (TypeORM)', () => {
  let statsRepository: StatsRepository;
  let module: TestingModule;

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [StatsRepository, EventEmitter2],
      typeorm: {
        fixtures: installStatsFixturesTypeOrm,
      },
    });

    module = testing.module;
    statsRepository = module.get(StatsRepository);
  });

  afterEach(jest.clearAllMocks);

  describe('findMessages', () => {
    it('should return messages', async () => {
      const from = new Date('2023-11-01T23:00:00.000Z');
      const to = new Date('2023-11-07T23:00:00.000Z');
      const types = [
        StatsType.all_messages,
        StatsType.incoming,
        StatsType.outgoing,
      ];
      const result = await statsRepository.findMessages(from, to, types);

      expect(result).toEqualPayload(
        statsFixtures.filter(({ type }) => types.includes(type)),
      );
    });

    it('should return messages of a specific period', async () => {
      const from = new Date('2023-11-01T23:00:00.000Z');
      const to = new Date('2023-11-03T23:00:00.000Z');
      const types = [
        StatsType.all_messages,
        StatsType.incoming,
        StatsType.outgoing,
      ];
      const result = await statsRepository.findMessages(from, to, types);

      expect(result).toEqualPayload([statsFixtures[0]]);
    });

    it('should return audiance statistics', async () => {
      const from = new Date('2023-11-01T23:00:00.000Z');
      const to = new Date('2023-11-07T23:00:00.000Z');
      const result = await statsRepository.findMessages(from, to, [
        StatsType.new_users,
        StatsType.returning_users,
        StatsType.retention,
      ]);

      expect(result).toEqualPayload(statsFixtures.slice(1, 4));
    });

    it('should return statistics of a given type', async () => {
      const from = new Date('2023-11-01T23:00:00.000Z');
      const to = new Date('2023-11-07T23:00:00.000Z');
      const result = await statsRepository.findMessages(from, to, [
        StatsType.incoming,
      ]);

      expect(result).toEqualPayload([statsFixtures[4]]);
    });
  });
});
