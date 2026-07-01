/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import { Dummy } from '@hexabot-ai/types';
import { In } from 'typeorm';

import { DummyOrmEntity } from '@/utils/test/dummy/entities/dummy.entity';
import { DummyRepository } from '@/utils/test/dummy/repositories/dummy.repository';
import { DummyService } from '@/utils/test/dummy/services/dummy.service';
import {
  dummyFixtures,
  installDummyFixturesTypeOrm,
} from '@/utils/test/fixtures/dummy';
import { buildTestingMocks } from '@/utils/test/utils';

describe('BaseOrmService', () => {
  let dummyRepository: DummyRepository;
  let dummyService: DummyService;
  let baseline: Dummy[];
  let firstEntity: Dummy;

  beforeAll(async () => {
    const { getMocks } = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [DummyService],
      typeorm: {
        entities: [DummyOrmEntity],
        fixtures: installDummyFixturesTypeOrm,
      },
    });

    [dummyRepository, dummyService] = await getMocks([
      DummyRepository,
      DummyService,
    ]);
  });

  beforeEach(async () => {
    await dummyRepository.deleteMany();
    baseline = await dummyRepository.createMany(dummyFixtures);
    firstEntity = baseline[0];
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
  describe('utilities', () => {
    it('exposes the configured repository', () => {
      expect(dummyService.getRepository()).toBe(dummyRepository);
    });

    it('shares the repository event emitter', () => {
      expect(dummyService.eventEmitter).toBe(dummyRepository.getEventEmitter());
    });

    it('delegates populate checks to the repository', () => {
      const populate = ['relation'];
      const canPopulateSpy = jest.spyOn(dummyRepository, 'canPopulate');
      const result = dummyService.canPopulate(populate);

      expect(canPopulateSpy).toHaveBeenCalledWith(populate);
      expect(result).toBe(false);
    });
  });

  describe('read operations', () => {
    it('finds all plain entities', async () => {
      const findAllSpy = jest.spyOn(dummyRepository, 'findAll');
      const results = await dummyService.findAll();

      expect(findAllSpy).toHaveBeenCalledWith(undefined);
      expect(results).toHaveLength(dummyFixtures.length);
      const names = results.map(({ dummy }) => dummy).sort();
      expect(names).toEqual(dummyFixtures.map(({ dummy }) => dummy).sort());
    });

    it('finds all entities with relations populated', async () => {
      const findAllAndPopulateSpy = jest.spyOn(
        dummyRepository,
        'findAllAndPopulate',
      );
      const results = await dummyService.findAllAndPopulate();

      expect(findAllAndPopulateSpy).toHaveBeenCalledWith(undefined);
      expect(results).toHaveLength(dummyFixtures.length);
    });

    it('finds entities matching options', async () => {
      const options = { where: { id: firstEntity.id } };
      const findSpy = jest.spyOn(dummyRepository, 'find');
      const results = await dummyService.find(options);

      expect(findSpy).toHaveBeenCalledWith(options);
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe(firstEntity.id);
    });

    it('finds populated entities matching options', async () => {
      const options = { where: { id: firstEntity.id } };
      const findAndPopulateSpy = jest.spyOn(dummyRepository, 'findAndPopulate');
      const results = await dummyService.findAndPopulate(options);

      expect(findAndPopulateSpy).toHaveBeenCalledWith(options);
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe(firstEntity.id);
    });

    it('counts stored entities', async () => {
      const countSpy = jest.spyOn(dummyRepository, 'count');
      const total = await dummyService.count();

      expect(countSpy).toHaveBeenCalledWith(undefined);
      expect(total).toBe(dummyFixtures.length);
    });

    it('finds one entity by id', async () => {
      const findOneSpy = jest.spyOn(dummyRepository, 'findOne');
      const result = await dummyService.findOne(firstEntity.id);

      expect(findOneSpy).toHaveBeenCalledWith(firstEntity.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(firstEntity.id);
    });

    it('finds one entity by options', async () => {
      const options = { where: { id: firstEntity.id } };
      const findOneSpy = jest.spyOn(dummyRepository, 'findOne');
      const result = await dummyService.findOne(options);

      expect(findOneSpy).toHaveBeenCalledWith(options);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(firstEntity.id);
    });

    it('finds one populated entity', async () => {
      const findOneAndPopulateSpy = jest.spyOn(
        dummyRepository,
        'findOneAndPopulate',
      );
      const result = await dummyService.findOneAndPopulate(firstEntity.id);

      expect(findOneAndPopulateSpy).toHaveBeenCalledWith(firstEntity.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(firstEntity.id);
    });
  });

  describe('write operations', () => {
    it('creates a new entity', async () => {
      const payload = { dummy: 'dummy created via service' };
      const createSpy = jest.spyOn(dummyRepository, 'create');
      const result = await dummyService.create(payload);

      expect(createSpy).toHaveBeenCalledWith(payload);
      expect(result.dummy).toBe(payload.dummy);
      const stored = await dummyRepository.findOne(result.id);
      expect(stored!.dummy).toBe(payload.dummy);
    });

    it('creates multiple entities', async () => {
      const payloads = [
        { dummy: 'bulk service 1' },
        { dummy: 'bulk service 2', dynamicField: { foo: 'bar' } },
      ];
      const createManySpy = jest.spyOn(dummyRepository, 'createMany');
      const results = await dummyService.createMany(payloads);

      expect(createManySpy).toHaveBeenCalledWith(payloads);
      expect(results).toHaveLength(payloads.length);
      const stored = await dummyRepository.find({
        where: { id: In(results.map(({ id }) => id)) },
      });
      expect(stored).toHaveLength(payloads.length);
    });

    it('updates one entity by id and forwards options', async () => {
      const payload = { dummy: 'updated via service' };
      const updateOneSpy = jest.spyOn(dummyRepository, 'updateOne');
      const result = await dummyService.updateOne(firstEntity.id, payload, {
        upsert: false,
      });

      expect(updateOneSpy).toHaveBeenCalledWith(firstEntity.id, payload, {
        upsert: false,
      });
      expect(result.dummy).toBe(payload.dummy);
      const stored = await dummyRepository.findOne(firstEntity.id);
      expect(stored!.dummy).toBe(payload.dummy);
    });

    it('updates one entity by options', async () => {
      const payload = { dummy: 'updated via criteria' };
      const options = { where: { id: firstEntity.id } };
      const updateOneSpy = jest.spyOn(dummyRepository, 'updateOne');
      const result = await dummyService.updateOne(options, payload);

      expect(updateOneSpy).toHaveBeenCalledWith(options, payload, undefined);
      expect(result.dummy).toBe(payload.dummy);
    });

    it('updates many entities', async () => {
      const payload = { dummy: 'bulk update via service' };
      const updateManySpy = jest.spyOn(dummyRepository, 'updateMany');
      const results = await dummyService.updateMany({}, payload);

      expect(updateManySpy).toHaveBeenCalledWith({}, payload);
      expect(results).toHaveLength(dummyFixtures.length);
      results.forEach((entity) => expect(entity.dummy).toBe(payload.dummy));
    });

    it('returns an existing entity when findOneOrCreate locates a match', async () => {
      const payload = { dummy: 'ignored payload' };
      const findOneOrCreateSpy = jest.spyOn(dummyRepository, 'findOneOrCreate');
      const result = await dummyService.findOneOrCreate(
        firstEntity.id,
        payload,
      );

      expect(findOneOrCreateSpy).toHaveBeenCalledWith(firstEntity.id, payload);
      expect(result.id).toBe(firstEntity.id);
      expect(await dummyRepository.count()).toBe(dummyFixtures.length);
    });

    it('creates a new entity when findOneOrCreate matches none', async () => {
      const payload = { dummy: `created via findOneOrCreate ${randomUUID()}` };
      const options = { where: { id: randomUUID() } };
      const findOneOrCreateSpy = jest.spyOn(dummyRepository, 'findOneOrCreate');
      const result = await dummyService.findOneOrCreate(options, payload);

      expect(findOneOrCreateSpy).toHaveBeenCalledWith(options, payload);
      expect(result.dummy).toBe(payload.dummy);
      const stored = await dummyRepository.findOne(result.id);
      expect(stored!.dummy).toBe(payload.dummy);
    });
  });

  describe('delete operations', () => {
    it('deletes one entity by id', async () => {
      const deleteOneSpy = jest.spyOn(dummyRepository, 'deleteOne');
      const result = await dummyService.deleteOne(firstEntity.id);

      expect(deleteOneSpy).toHaveBeenCalledWith(firstEntity.id);
      expect(result).toEqualPayload({ acknowledged: true, deletedCount: 1 });
      expect(await dummyRepository.count()).toBe(dummyFixtures.length - 1);
    });

    it('deletes one entity by options', async () => {
      const options = { where: { id: firstEntity.id } };
      const deleteOneSpy = jest.spyOn(dummyRepository, 'deleteOne');
      const result = await dummyService.deleteOne(options);

      expect(deleteOneSpy).toHaveBeenCalledWith(options);
      expect(result).toEqualPayload({ acknowledged: true, deletedCount: 1 });
      expect(await dummyRepository.count()).toBe(dummyFixtures.length - 1);
    });

    it('deletes many entities matching options', async () => {
      const targetIds = baseline.slice(0, 2).map(({ id }) => id);
      const options = { where: { id: In(targetIds) } };
      const deleteManySpy = jest.spyOn(dummyRepository, 'deleteMany');
      const result = await dummyService.deleteMany(options);

      expect(deleteManySpy).toHaveBeenCalledWith(options);
      expect(result).toEqualPayload({ acknowledged: true, deletedCount: 2 });
      expect(await dummyRepository.count()).toBe(
        dummyFixtures.length - targetIds.length,
      );
    });

    it('supports deleting without filters', async () => {
      const deleteManySpy = jest.spyOn(dummyRepository, 'deleteMany');
      const result = await dummyService.deleteMany();

      expect(deleteManySpy).toHaveBeenCalledWith(undefined);
      expect(result).toEqualPayload({
        acknowledged: true,
        deletedCount: dummyFixtures.length,
      });
      expect(await dummyRepository.count()).toBe(0);
    });

    it('returns zero deletions when nothing matches', async () => {
      const options = { where: { id: In([randomUUID()]) } };
      const deleteManySpy = jest.spyOn(dummyRepository, 'deleteMany');
      const result = await dummyService.deleteMany(options);

      expect(deleteManySpy).toHaveBeenCalledWith(options);
      expect(result).toEqualPayload({ acknowledged: true, deletedCount: 0 });
    });
  });
});
