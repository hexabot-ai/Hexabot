/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { In, InsertEvent, RemoveEvent, Repository, UpdateEvent } from 'typeorm';

import { DummyOrmEntity } from '@/utils/test/dummy/entities/dummy.entity';
import { DummyRepository } from '@/utils/test/dummy/repositories/dummy.repository';
import {
  dummyFixtures,
  installDummyFixturesTypeOrm,
} from '@/utils/test/fixtures/dummy';
import { getLastTypeOrmDataSource } from '@/utils/test/test';
import { buildTestingMocks } from '@/utils/test/utils';

import { EHook } from './base-orm.repository';

describe('BaseOrmRepository', () => {
  let dummyRepository: DummyRepository;
  let ormRepository: Repository<DummyOrmEntity>;
  let baselineEntities: DummyOrmEntity[];

  beforeAll(async () => {
    const { getMocks } = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [DummyRepository],
      typeorm: {
        entities: [DummyOrmEntity],
        fixtures: installDummyFixturesTypeOrm,
      },
    });

    [dummyRepository] = await getMocks([DummyRepository]);

    const dataSource = getLastTypeOrmDataSource();
    ormRepository = dataSource.getRepository(DummyOrmEntity);
  });

  beforeEach(async () => {
    await ormRepository.clear();
    baselineEntities = await ormRepository.save(
      ormRepository.create(dummyFixtures),
    );
  });
  describe('utility methods', () => {
    it('should expose the configured populate relations', () => {
      expect(dummyRepository.getPopulateRelations()).toEqual([]);
    });

    it('should report inability to populate unsupported relations', () => {
      expect(dummyRepository.canPopulate(['unrelated'])).toBe(false);
    });

    it('should provide access to the event emitter instance', () => {
      const emitter = dummyRepository.getEventEmitter();
      expect(emitter).toBeInstanceOf(EventEmitter2);
    });
  });

  describe('find operations', () => {
    it('should return all dummy entities', async () => {
      const results = await dummyRepository.findAll();

      expect(results).toHaveLength(dummyFixtures.length);
      const names = results.map((entity) => entity.dummy).sort();
      expect(names).toEqual(
        dummyFixtures.map((fixture) => fixture.dummy).sort(),
      );
    });

    it('should return all dummy entities when populating', async () => {
      const results = await dummyRepository.findAllAndPopulate();

      expect(results).toHaveLength(dummyFixtures.length);
    });

    it('should find one entity by id', async () => {
      const target = baselineEntities[0];
      const result = await dummyRepository.findOne(target.id);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(target.id);
      expect(result!.dummy).toBe(target.dummy);
    });

    it('should find one entity by options', async () => {
      const target = baselineEntities[1];
      const options = { where: { id: target.id } };
      const result = await dummyRepository.findOne(options);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(target.id);
    });

    it('should find entities using options', async () => {
      const target = baselineEntities[2];
      const results = await dummyRepository.find({
        where: { id: target.id },
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe(target.id);
    });

    it('should find and populate entities', async () => {
      const results = await dummyRepository.findAndPopulate();

      expect(results).toHaveLength(dummyFixtures.length);
    });

    it('should count matching entities', async () => {
      const total = await dummyRepository.count();
      expect(total).toBe(dummyFixtures.length);

      const count = await dummyRepository.count({
        where: { dummy: baselineEntities[0].dummy },
      });
      expect(count).toBe(1);
    });
  });

  describe('create operations', () => {
    it('should create one entity', async () => {
      const payload = { dummy: 'dummy test 5' };
      const result = await dummyRepository.create(payload);

      expect(result.dummy).toBe(payload.dummy);
      const stored = await ormRepository.findOne({ where: { id: result.id } });
      expect(stored).not.toBeNull();
      expect(stored!.dummy).toBe(payload.dummy);
    });

    it('should create many entities', async () => {
      const payloads = [
        { dummy: 'bulk 1' },
        { dummy: 'bulk 2', dynamicField: { foo: 'bar' } },
      ];
      const results = await dummyRepository.createMany(payloads);

      expect(results).toHaveLength(payloads.length);
      const stored = await ormRepository.find({
        where: { dummy: In(payloads.map((payload) => payload.dummy)) },
      });
      expect(stored).toHaveLength(payloads.length);
    });
  });

  describe('update operations', () => {
    it('should update an entity by id', async () => {
      const target = baselineEntities[0];
      const payload = { dummy: 'updated dummy text' };
      const result = await dummyRepository.updateOne(target.id, payload);

      expect(result).not.toBeNull();
      expect(result!.dummy).toBe(payload.dummy);
      const stored = await ormRepository.findOne({ where: { id: target.id } });
      expect(stored!.dummy).toBe(payload.dummy);
    });

    it('should update one entity matching options', async () => {
      const target = baselineEntities[1];
      const payload = { dummy: 'updated from options' };
      const options = { where: { id: target.id } };
      const result = await dummyRepository.updateOne(options, payload);

      expect(result.dummy).toBe(payload.dummy);
      const stored = await ormRepository.findOne({ where: { id: target.id } });
      expect(stored!.dummy).toBe(payload.dummy);
    });

    it('should upsert when updateOne cannot find a match and upsert is enabled', async () => {
      const payload = { dummy: 'upserted dummy' };
      const options = { where: { id: randomUUID() } };
      const result = await dummyRepository.updateOne(options, payload, {
        upsert: true,
      });

      expect(result.dummy).toBe(payload.dummy);
      const stored = await ormRepository.findOne({ where: { id: result.id } });
      expect(stored!.dummy).toBe(payload.dummy);
    });

    it('should throw when updateOne cannot find a match and upsert is disabled', async () => {
      const payload = { dummy: 'no updates' };
      const options = { where: { id: randomUUID() } };

      await expect(
        dummyRepository.updateOne(options, payload),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should merge nested object fields when flattening updates', async () => {
      const target = baselineEntities[2];
      await dummyRepository.updateOne(target.id, {
        dynamicField: { foo: 'bar', nested: { initial: true } },
      });

      const result = await dummyRepository.updateOne(
        target.id,
        {
          dynamicField: {
            nested: { initial: false, extra: 'value' },
            newProp: 42,
          },
        },
        { shouldFlatten: true },
      );

      expect(result.dynamicField).toEqualPayload({
        foo: 'bar',
        nested: { initial: false, extra: 'value' },
        newProp: 42,
      });

      const stored = await ormRepository.findOne({ where: { id: target.id } });
      expect(stored?.dynamicField).toEqualPayload({
        foo: 'bar',
        nested: { initial: false, extra: 'value' },
        newProp: 42,
      });
    });

    it('should update many entities', async () => {
      const payload = { dummy: 'bulk updated' };
      const results = await dummyRepository.updateMany({}, payload);

      expect(results).toHaveLength(dummyFixtures.length);
      const stored = await ormRepository.find();
      stored.forEach((entity) => expect(entity.dummy).toBe(payload.dummy));
    });
  });

  describe('findOrCreate operations', () => {
    it('should return existing entity when found', async () => {
      const target = baselineEntities[0];
      const result = await dummyRepository.findOneOrCreate(target.id, {
        dummy: 'should not override',
      });

      expect(result.id).toBe(target.id);
      expect(result.dummy).toBe(target.dummy);
    });

    it('should create a new entity when none match', async () => {
      const payload = { dummy: 'new dummy' };
      const result = await dummyRepository.findOneOrCreate(
        { where: { dummy: 'non-existing' } },
        payload,
      );

      expect(result.dummy).toBe(payload.dummy);
      const stored = await ormRepository.findOne({ where: { id: result.id } });
      expect(stored!.dummy).toBe(payload.dummy);
    });
  });

  describe('delete operations', () => {
    it('should delete one entity by id', async () => {
      const target = baselineEntities[0];
      const result = await dummyRepository.deleteOne(target.id);

      expect(result).toEqualPayload({ acknowledged: true, deletedCount: 1 });
      const stored = await ormRepository.findOne({ where: { id: target.id } });
      expect(stored).toBeNull();
    });

    it('should delete one entity by options', async () => {
      const target = baselineEntities[1];
      const options = { where: { id: target.id } };
      const result = await dummyRepository.deleteOne(options);

      expect(result).toEqualPayload({ acknowledged: true, deletedCount: 1 });
      const stored = await ormRepository.findOne({ where: { id: target.id } });
      expect(stored).toBeNull();
    });

    it('should delete many entities', async () => {
      const targetIds = baselineEntities.slice(0, 2).map((entity) => entity.id);
      const result = await dummyRepository.deleteMany({
        where: { id: In(targetIds) },
      });

      expect(result).toEqualPayload({ acknowledged: true, deletedCount: 2 });
      const remaining = await ormRepository.find();
      expect(remaining).toHaveLength(dummyFixtures.length - 2);
    });
  });

  describe('event emission', () => {
    let eventEmitter: EventEmitter2;
    const hookEvent = (suffix: EHook) => `hook:dummy:${suffix}`;
    const resolveRemoveEventId = (
      event: RemoveEvent<DummyOrmEntity>,
    ): string | undefined => {
      const candidate =
        event.entity?.id ??
        event.databaseEntity?.id ??
        (typeof event.entityId === 'object'
          ? (event.entityId as Record<string, unknown>).id
          : (event.entityId as string | undefined));

      return typeof candidate === 'string' ? candidate : undefined;
    };

    beforeEach(() => {
      eventEmitter = dummyRepository.getEventEmitter()!;
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should emit hooks when creating an entity', async () => {
      const emitSpy = jest
        .spyOn(eventEmitter, 'emitAsync')
        .mockResolvedValue([]);
      const payload = { dummy: 'event create' };
      const result = await dummyRepository.create(payload);

      expect(emitSpy).toHaveBeenCalledTimes(2);
      const [preCall, postCall] = emitSpy.mock.calls as [
        [string, InsertEvent<DummyOrmEntity>],
        [string, InsertEvent<DummyOrmEntity>],
      ];
      const [preEventName, preEvent] = preCall;
      expect(preEventName).toBe(hookEvent(EHook.preCreate));
      expect(preEvent.entity?.dummy).toBe(payload.dummy);

      const [postEventName, postEvent] = postCall;
      expect(postEventName).toBe(hookEvent(EHook.postCreate));
      expect(postEvent.entity?.id).toBe(result.id);
      expect(postEvent.entity?.dummy).toBe(payload.dummy);
    });

    it('should emit hooks when creating many entities', async () => {
      const emitSpy = jest
        .spyOn(eventEmitter, 'emitAsync')
        .mockResolvedValue([]);
      const payloads = [
        { dummy: 'event bulk 1' },
        { dummy: 'event bulk 2', dynamicField: { key: 'value' } },
      ];

      await dummyRepository.createMany(payloads);

      const preCalls = emitSpy.mock.calls.filter(
        ([event]) => event === hookEvent(EHook.preCreate),
      ) as Array<[string, InsertEvent<DummyOrmEntity>]>;
      const postCalls = emitSpy.mock.calls.filter(
        ([event]) => event === hookEvent(EHook.postCreate),
      ) as Array<[string, InsertEvent<DummyOrmEntity>]>;

      expect(preCalls).toHaveLength(payloads.length);
      expect(postCalls).toHaveLength(payloads.length);
      expect(preCalls.map(([, event]) => event.entity?.dummy)).toEqual(
        payloads.map((payload) => payload.dummy),
      );
      postCalls.forEach(([, event]) => {
        expect(event.entity?.id).toBeDefined();
      });
      expect(postCalls.map(([, event]) => event.entity?.dummy)).toEqual(
        expect.arrayContaining(payloads.map((payload) => payload.dummy)),
      );
    });

    it('should emit hooks when updating an entity', async () => {
      const target = baselineEntities[0];
      const emitSpy = jest
        .spyOn(eventEmitter, 'emitAsync')
        .mockResolvedValue([]);
      const payload = { dummy: 'event update' };

      await dummyRepository.updateOne(target.id, payload);

      const preCall = emitSpy.mock.calls.find(
        ([event]) => event === hookEvent(EHook.preUpdate),
      ) as [string, UpdateEvent<DummyOrmEntity>] | undefined;
      const postCall = emitSpy.mock.calls.find(
        ([event]) => event === hookEvent(EHook.postUpdate),
      ) as [string, UpdateEvent<DummyOrmEntity>] | undefined;

      expect(preCall).toBeDefined();
      const [, preEvent] = preCall!;
      expect(preEvent.entity?.id).toBe(target.id);
      expect(preEvent.entity?.dummy).toBe(payload.dummy);
      expect(preEvent.databaseEntity?.dummy).toBe(target.dummy);

      expect(postCall).toBeDefined();
      const [, postEvent] = postCall!;
      expect(postEvent.entity?.dummy).toBe(payload.dummy);
      expect(postEvent.databaseEntity?.dummy).toBe(target.dummy);
    });

    it('should emit hooks when updating many entities', async () => {
      const emitSpy = jest
        .spyOn(eventEmitter, 'emitAsync')
        .mockResolvedValue([]);
      const payload = { dummy: 'event update many' };

      await dummyRepository.updateMany({}, payload);

      const preCalls = emitSpy.mock.calls.filter(
        ([event]) => event === hookEvent(EHook.preUpdate),
      ) as Array<[string, UpdateEvent<DummyOrmEntity>]>;
      const postCalls = emitSpy.mock.calls.filter(
        ([event]) => event === hookEvent(EHook.postUpdate),
      ) as Array<[string, UpdateEvent<DummyOrmEntity>]>;

      expect(preCalls).toHaveLength(dummyFixtures.length);
      expect(postCalls).toHaveLength(dummyFixtures.length);

      preCalls.forEach(([, event]) => {
        expect(event.entity?.dummy).toBe(payload.dummy);
        expect(event.databaseEntity?.dummy).toBeDefined();
      });

      postCalls.forEach(([, event]) => {
        expect(event.entity?.dummy).toBe(payload.dummy);
        expect(event.databaseEntity?.dummy).toBeDefined();
      });

      const bulkCalls = emitSpy.mock.calls.filter(
        ([event]) =>
          event === hookEvent(EHook.preUpdateMany) ||
          event === hookEvent(EHook.postUpdateMany),
      );
      expect(bulkCalls).toHaveLength(0);
    });

    it('should emit hooks when deleting one entity', async () => {
      const target = baselineEntities[0];
      const emitSpy = jest
        .spyOn(eventEmitter, 'emitAsync')
        .mockResolvedValue([]);

      await dummyRepository.deleteOne(target.id);

      const preCall = emitSpy.mock.calls.find(
        ([event]) => event === hookEvent(EHook.preDelete),
      ) as [string, RemoveEvent<DummyOrmEntity>] | undefined;
      const postCall = emitSpy.mock.calls.find(
        ([event]) => event === hookEvent(EHook.postDelete),
      ) as [string, RemoveEvent<DummyOrmEntity>] | undefined;

      expect(preCall).toBeDefined();
      const [, preEvent] = preCall!;
      expect(resolveRemoveEventId(preEvent)).toBe(target.id);

      expect(postCall).toBeDefined();
      const [, postEvent] = postCall!;
      expect(resolveRemoveEventId(postEvent)).toBe(target.id);
    });

    it('should emit hooks when deleting many entities', async () => {
      const emitSpy = jest
        .spyOn(eventEmitter, 'emitAsync')
        .mockResolvedValue([]);
      const targetIds = baselineEntities.slice(0, 2).map(({ id }) => id);

      await dummyRepository.deleteMany({ where: { id: In(targetIds) } });

      const preCalls = emitSpy.mock.calls.filter(
        ([event]) => event === hookEvent(EHook.preDelete),
      ) as Array<[string, RemoveEvent<DummyOrmEntity>]>;
      const postCalls = emitSpy.mock.calls.filter(
        ([event]) => event === hookEvent(EHook.postDelete),
      ) as Array<[string, RemoveEvent<DummyOrmEntity>]>;

      expect(preCalls).toHaveLength(targetIds.length);
      expect(postCalls).toHaveLength(targetIds.length);

      const extractIds = (
        calls: Array<[string, RemoveEvent<DummyOrmEntity>]>,
      ) =>
        calls
          .map(([, event]) => resolveRemoveEventId(event))
          .filter((id): id is string => typeof id === 'string')
          .sort();

      expect(extractIds(preCalls)).toEqual([...targetIds].sort());
      expect(extractIds(postCalls)).toEqual([...targetIds].sort());
    });

    it('should assign id on event.entity before emitting hooks', async () => {
      const target = baselineEntities[0];
      const emitSpy = jest
        .spyOn(eventEmitter, 'emitAsync')
        .mockResolvedValue([]);

      await dummyRepository.deleteOne(target.id);

      const postCall = emitSpy.mock.calls.find(
        ([event]) => event === hookEvent(EHook.postDelete),
      ) as [string, RemoveEvent<DummyOrmEntity>] | undefined;

      expect(postCall).toBeDefined();
      const [, postEvent] = postCall!;
      expect(postEvent.entity?.id).toBe(target.id);
    });

    it('should not emit hooks when findOneOrCreate reuses an existing entity', async () => {
      const target = baselineEntities[0];
      const emitSpy = jest
        .spyOn(eventEmitter, 'emitAsync')
        .mockResolvedValue([]);

      await dummyRepository.findOneOrCreate(target.id, {
        dummy: 'no-op',
      });

      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('should not emit hooks when updateMany does not match any entity', async () => {
      const emitSpy = jest
        .spyOn(eventEmitter, 'emitAsync')
        .mockResolvedValue([]);
      const result = await dummyRepository.updateMany(
        { where: { id: In([randomUUID()]) } },
        { dummy: 'no-op' },
      );

      expect(result).toEqual([]);
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('should not emit hooks when deleteMany finds no matching entities', async () => {
      const emitSpy = jest
        .spyOn(eventEmitter, 'emitAsync')
        .mockResolvedValue([]);
      const result = await dummyRepository.deleteMany({
        where: { id: In([randomUUID()]) },
      });

      expect(result).toEqualPayload({ acknowledged: true, deletedCount: 0 });
      expect(emitSpy).not.toHaveBeenCalled();
    });
  });
});
