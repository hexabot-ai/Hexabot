/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import fs from 'fs';

import { HttpService } from '@nestjs/axios';
import { ModuleRef } from '@nestjs/core';
import { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { AttachmentService } from '@/attachment/services/attachment.service';
import { config } from '@/config';
import { LoggerService } from '@/logger/logger.service';
import { MetadataOrmEntity } from '@/setting/entities/metadata.entity';
import { MetadataService } from '@/setting/services/metadata.service';
import { buildTestingMocks } from '@/utils/test/utils';

import { MigrationOrmEntity } from './migration.entity';
import { MigrationService } from './migration.service';
import { MigrationAction, MigrationVersion } from './types';

describe('MigrationService', () => {
  let service: MigrationService;
  let loggerService: LoggerService;
  let metadataService: MetadataService;
  let dataSource: DataSource;
  let testingModule: TestingModule;
  let httpService: HttpService;
  let attachmentService: AttachmentService;

  const originalAutoMigrate = config.database.autoMigrate;
  const createQueryRunnerStub = () => {
    const stub: any = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockImplementation(() => {
        stub.isTransactionActive = true;

        return Promise.resolve();
      }),
      commitTransaction: jest.fn().mockImplementation(() => {
        stub.isTransactionActive = false;

        return Promise.resolve();
      }),
      rollbackTransaction: jest.fn().mockImplementation(() => {
        stub.isTransactionActive = false;

        return Promise.resolve();
      }),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: false,
    };

    return stub;
  };

  beforeAll(async () => {
    const mocks = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [
        MigrationService,
        {
          provide: HttpService,
          useValue: {},
        },
        {
          provide: AttachmentService,
          useValue: {},
        },
        {
          provide: ModuleRef,
          useValue: {
            get: jest.fn((token: string) => {
              if (token === 'TYPEORM_MIGRATION_DIR') {
                return '/migrations';
              }

              return undefined;
            }),
          },
        },
      ],
    });

    testingModule = mocks.module;
    [service, metadataService] = await mocks.getMocks([
      MigrationService,
      MetadataService,
    ]);
    const serviceInternals = service as unknown as {
      logger: LoggerService;
      dataSource: DataSource;
      httpService: HttpService;
      attachmentService: AttachmentService;
      metadataService: MetadataService;
    };
    loggerService = serviceInternals.logger;
    dataSource = serviceInternals.dataSource;
    httpService = serviceInternals.httpService;
    attachmentService = serviceInternals.attachmentService;
    metadataService = serviceInternals.metadataService;
  });

  afterAll(async () => {
    config.database.autoMigrate = originalAutoMigrate;
    if (testingModule) {
      await testingModule.close();
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.HEXABOT_CLI;
  });

  beforeEach(() => {
    jest.spyOn(loggerService, 'log').mockImplementation(() => undefined);
    jest.spyOn(loggerService, 'error').mockImplementation(() => undefined);
  });

  describe('create', () => {
    let exitSpy: jest.SpyInstance;

    beforeEach(() => {
      process.env.HEXABOT_CLI = 'true';
      exitSpy = jest
        .spyOn(service, 'exit')
        .mockImplementation(() => undefined as never);
    });

    it('should create a migration file and log success', () => {
      const mockFiles = ['12345-some-migration.migration.ts'];
      jest.spyOn(service, 'getMigrationFiles').mockReturnValue(mockFiles);
      jest
        .spyOn(service as any, 'getMigrationTemplate')
        .mockReturnValue('template');
      jest
        .spyOn(service as any, 'getMigrationName')
        .mockImplementation((file: string) => file);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'writeFileSync').mockImplementation();

      service.create('v2.2.0');

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/\/migrations\/\d+-v-2-2-0\.migration\.ts$/),
        'template',
      );
      expect(loggerService.log).toHaveBeenCalledWith(
        expect.stringContaining('Migration file for "v2.2.0" created'),
      );
      expect(exitSpy).toHaveBeenCalled();
    });

    it('should log an error and exit if a migration with the same name exists', () => {
      jest
        .spyOn(service, 'getMigrationFiles')
        .mockReturnValue(['12345-v-2-2-1.migration.ts']);

      service.create('v2.2.1');

      expect(loggerService.error).toHaveBeenCalledWith(
        'Migration file for "v2.2.1" already exists',
      );
      expect(exitSpy).toHaveBeenCalled();
    });
  });

  describe('onApplicationBootstrap', () => {
    it('should log a message and execute migrations when autoMigrate is true', async () => {
      process.env.HEXABOT_CLI = '';
      config.database.autoMigrate = true;
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(service, 'run').mockResolvedValue(undefined);
      jest.spyOn(metadataService, 'findOne').mockResolvedValue({
        name: 'db-version',
        value: 'v3.0.0',
      } as MetadataOrmEntity);

      await service.onApplicationBootstrap();

      expect(loggerService.log).toHaveBeenCalledWith(
        'Executing migrations ...',
      );
      expect(service.run).toHaveBeenCalledWith({
        action: MigrationAction.UP,
        isAutoMigrate: true,
      });
    });
  });

  describe('run', () => {
    it('should call runUpgrades when version is not provided and isAutoMigrate is true', async () => {
      process.env.HEXABOT_CLI = '';
      const runUpgradesSpy = jest
        .spyOn(service as any, 'runUpgrades')
        .mockResolvedValue('v3.0.2');
      jest.spyOn(metadataService, 'findOne').mockResolvedValue({
        name: 'db-version',
        value: 'v3.0.0',
      } as MetadataOrmEntity);

      await service.run({
        action: MigrationAction.UP,
        isAutoMigrate: true,
      });

      expect(runUpgradesSpy).toHaveBeenCalledWith('up', 'v3.0.0');
    });

    it('should call runAll and exit when version is not provided and CLI is enabled', async () => {
      process.env.HEXABOT_CLI = 'true';
      const exitSpy = jest
        .spyOn(service, 'exit')
        .mockImplementation(() => undefined as never);
      const runAllSpy = jest
        .spyOn(service as any, 'runAll')
        .mockResolvedValue('v3.0.2');

      await service.run({
        action: MigrationAction.UP,
        version: undefined,
        isAutoMigrate: false,
      });

      expect(runAllSpy).toHaveBeenCalledWith('up');
      expect(exitSpy).toHaveBeenCalled();
    });

    it('should call runOne and exit when a version is provided in CLI mode', async () => {
      process.env.HEXABOT_CLI = 'true';
      const exitSpy = jest
        .spyOn(service, 'exit')
        .mockImplementation(() => undefined as never);
      const runOneSpy = jest
        .spyOn(service as any, 'runOne')
        .mockResolvedValue(true);

      await service.run({
        action: MigrationAction.UP,
        version: 'v3.0.1',
        isAutoMigrate: false,
      });

      expect(runOneSpy).toHaveBeenCalledWith({
        action: 'up',
        version: 'v3.0.1',
      });
      expect(exitSpy).toHaveBeenCalled();
    });
  });

  describe('runOne', () => {
    it('should return "skipped" and not execute if migration already exists', async () => {
      const verifyStatusSpy = jest
        .spyOn(service as any, 'verifyStatus')
        .mockResolvedValue({ exist: true, migrationRecord: {} });
      const queryRunnerSpy = jest.spyOn(dataSource, 'createQueryRunner');
      const result = await (service as any).runOne({
        version: 'v3.0.1',
        action: 'up',
      });

      expect(result).toBe('skipped');
      expect(verifyStatusSpy).toHaveBeenCalledWith({
        version: 'v3.0.1',
        action: 'up',
      });
      expect(queryRunnerSpy).not.toHaveBeenCalled();
    });

    it('should load the migration file and execute the migration action successfully', async () => {
      const queryRunner = createQueryRunnerStub();
      jest.spyOn(dataSource, 'createQueryRunner').mockReturnValue(queryRunner);
      jest
        .spyOn(service as any, 'verifyStatus')
        .mockResolvedValue({ exist: false, migrationRecord: {} });
      const migrationMock = {
        up: jest.fn().mockResolvedValue(undefined),
      };
      jest
        .spyOn(service as any, 'loadMigrationFile')
        .mockResolvedValue(migrationMock);
      const successCallbackSpy = jest
        .spyOn(service as any, 'successCallback')
        .mockResolvedValue(undefined);
      const result = await (service as any).runOne({
        version: 'v3.0.1',
        action: 'up',
      });

      expect(result).toBe('executed');
      expect(migrationMock.up).toHaveBeenCalledWith(
        queryRunner,
        expect.objectContaining({
          attachmentService,
          http: httpService,
          logger: loggerService,
        }),
      );
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(successCallbackSpy).toHaveBeenCalledWith({
        version: 'v3.0.1',
        action: 'up',
        migrationRecord: {},
      });
    });

    it('should call failureCallback and log the error if the migration action throws an error', async () => {
      const queryRunner = createQueryRunnerStub();
      jest.spyOn(dataSource, 'createQueryRunner').mockReturnValue(queryRunner);
      jest
        .spyOn(service as any, 'verifyStatus')
        .mockResolvedValue({ exist: false, migrationRecord: {} });
      const migrationMock = {
        up: jest.fn().mockRejectedValue(new Error('Test Error')),
      };
      jest
        .spyOn(service as any, 'loadMigrationFile')
        .mockResolvedValue(migrationMock);
      const failureCallbackSpy = jest
        .spyOn(service as any, 'failureCallback')
        .mockImplementation(() => undefined);
      const result = await (service as any).runOne({
        version: 'v3.0.1',
        action: 'up',
      });

      expect(result).toBe('failed');
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(failureCallbackSpy).toHaveBeenCalledWith({
        version: 'v3.0.1',
        action: 'up',
      });
      expect(loggerService.error).toHaveBeenCalledWith(
        expect.stringContaining('Test Error'),
      );
    });

    it('should rollback and return false when the migration action returns false', async () => {
      const queryRunner = createQueryRunnerStub();
      jest.spyOn(dataSource, 'createQueryRunner').mockReturnValue(queryRunner);
      jest
        .spyOn(service as any, 'verifyStatus')
        .mockResolvedValue({ exist: false, migrationRecord: {} });
      const migrationMock = {
        up: jest.fn().mockResolvedValue(false),
      };
      jest
        .spyOn(service as any, 'loadMigrationFile')
        .mockResolvedValue(migrationMock);
      const successCallbackSpy = jest.spyOn(service as any, 'successCallback');
      const failureCallbackSpy = jest
        .spyOn(service as any, 'failureCallback')
        .mockResolvedValue(undefined);
      const result = await (service as any).runOne({
        version: 'v3.0.1',
        action: 'up',
      });

      expect(result).toBe('failed');
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(successCallbackSpy).not.toHaveBeenCalled();
      expect(failureCallbackSpy).toHaveBeenCalledWith({
        version: 'v3.0.1',
        action: 'up',
      });
    });
  });

  describe('updateStatus', () => {
    it('should create a new record when none is provided', async () => {
      const repository = (service as any).migrationRepository;
      const createSpy = jest.spyOn(repository, 'create').mockReturnValue({
        version: 'v3.0.5',
      } as unknown as MigrationOrmEntity);
      const saveSpy = jest
        .spyOn(repository, 'save')
        .mockResolvedValue(undefined as never);

      await service.updateStatus({
        version: 'v3.0.5',
        action: MigrationAction.UP,
        migrationRecord: null,
      });

      expect(createSpy).toHaveBeenCalledWith({ version: 'v3.0.5' });
      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({ status: MigrationAction.UP }),
      );
    });

    it('should reuse the existing record when provided', async () => {
      const repository = (service as any).migrationRepository;
      const createSpy = jest.spyOn(repository, 'create');
      const saveSpy = jest
        .spyOn(repository, 'save')
        .mockResolvedValue(undefined as never);
      const record = {
        version: 'v3.0.6',
        status: MigrationAction.UP,
      } as unknown as MigrationOrmEntity;

      await service.updateStatus({
        version: 'v3.0.6',
        action: MigrationAction.DOWN,
        migrationRecord: record,
      });

      expect(createSpy).not.toHaveBeenCalled();
      expect(record.status).toBe(MigrationAction.DOWN);
      expect(saveSpy).toHaveBeenCalledWith(record);
    });
  });

  describe('successCallback', () => {
    it('should update metadata when migrating up', async () => {
      const updateStatusSpy = jest
        .spyOn(service, 'updateStatus')
        .mockResolvedValue(undefined);
      const updateOneSpy = jest
        .spyOn(metadataService, 'updateOne')
        .mockResolvedValue(undefined as never);

      await (service as any).successCallback({
        version: 'v3.1.0',
        action: MigrationAction.UP,
        migrationRecord: null,
      });

      expect(updateStatusSpy).toHaveBeenCalled();
      expect(updateOneSpy).toHaveBeenCalledWith(
        { where: { name: 'db-version' } },
        { name: 'db-version', value: 'v3.1.0' },
      );
    });

    it('should update metadata with the latest applied version when migrating down', async () => {
      const updateStatusSpy = jest
        .spyOn(service, 'updateStatus')
        .mockResolvedValue(undefined);
      const updateOneSpy = jest
        .spyOn(metadataService, 'updateOne')
        .mockResolvedValue(undefined as never);
      const repository = (service as any).migrationRepository;
      jest.spyOn(repository, 'find').mockResolvedValue([
        {
          version: 'v3.0.9',
          status: MigrationAction.UP,
        },
      ]);

      await (service as any).successCallback({
        version: 'v3.1.0',
        action: MigrationAction.DOWN,
        migrationRecord: null,
      });

      expect(updateStatusSpy).toHaveBeenCalled();
      expect(updateOneSpy).toHaveBeenCalledWith(
        { where: { name: 'db-version' } },
        { name: 'db-version', value: 'v3.0.9' },
      );
    });
  });

  describe('runUpgrades', () => {
    it('should execute newer migrations and return the latest version', async () => {
      const availableVersions: MigrationVersion[] = [
        'v3.0.0',
        'v3.0.1',
        'v3.0.2',
      ];
      jest
        .spyOn(service as any, 'getAvailableUpgradeVersions')
        .mockReturnValue(availableVersions);
      const runOneSpy = jest
        .spyOn(service as any, 'runOne')
        .mockResolvedValue('executed');
      const result = await (service as any).runUpgrades(
        MigrationAction.UP,
        'v3.0.0',
      );

      expect(runOneSpy).toHaveBeenCalledTimes(2);
      expect(runOneSpy).toHaveBeenNthCalledWith(1, {
        action: MigrationAction.UP,
        version: 'v3.0.1',
      });
      expect(runOneSpy).toHaveBeenNthCalledWith(2, {
        action: MigrationAction.UP,
        version: 'v3.0.2',
      });
      expect(result).toBe('v3.0.2');
    });

    it('should throw when a migration fails', async () => {
      const availableVersions: MigrationVersion[] = ['v3.0.1', 'v3.0.2'];
      jest
        .spyOn(service as any, 'getAvailableUpgradeVersions')
        .mockReturnValue(availableVersions);
      const runOneSpy = jest
        .spyOn(service as any, 'runOne')
        .mockResolvedValueOnce('executed')
        .mockResolvedValueOnce('failed');

      await expect(
        (service as any).runUpgrades(MigrationAction.UP, 'v3.0.0'),
      ).rejects.toThrow('Migration "v3.0.2" failed while executing "up".');
      expect(runOneSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('runAll', () => {
    it('should execute all migrations sequentially', async () => {
      const availableVersions: MigrationVersion[] = [
        'v3.0.0',
        'v3.0.1',
        'v3.0.2',
      ];
      jest
        .spyOn(service as any, 'getAvailableUpgradeVersions')
        .mockReturnValue(availableVersions);
      const runOneSpy = jest
        .spyOn(service as any, 'runOne')
        .mockResolvedValue('executed');
      const result = await (service as any).runAll(MigrationAction.UP);

      expect(runOneSpy).toHaveBeenCalledTimes(3);
      expect(result).toBe('v3.0.2');
    });

    it('should throw when a migration fails', async () => {
      const availableVersions: MigrationVersion[] = ['v3.0.1', 'v3.0.2'];
      jest
        .spyOn(service as any, 'getAvailableUpgradeVersions')
        .mockReturnValue(availableVersions);
      const runOneSpy = jest
        .spyOn(service as any, 'runOne')
        .mockResolvedValueOnce('executed')
        .mockResolvedValueOnce('failed');

      await expect((service as any).runAll(MigrationAction.UP)).rejects.toThrow(
        'Migration "v3.0.2" failed while executing "up".',
      );
      expect(runOneSpy).toHaveBeenCalledTimes(2);
    });
  });

  it('should return the migration name without the timestamp and file extension', () => {
    const result = (service as any).getMigrationName(
      '1234567890-v-1-0-1.migration.ts',
    );

    expect(result).toBe('v-1-0-1');
  });
});
