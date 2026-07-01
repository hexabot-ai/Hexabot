/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { installPermissionFixturesTypeOrm } from '@/utils/test/fixtures/permission';
import { userFixtureIds } from '@/utils/test/fixtures/user';
import { buildTestingMocks } from '@/utils/test/utils';

import { CredentialOrmEntity } from '../entities/credential.entity';
import { UserOrmEntity } from '../entities/user.entity';

import { CredentialRepository } from './credential.repository';

describe('CredentialRepository (TypeORM)', () => {
  let module: TestingModule;
  let credentialRepository: CredentialRepository;
  let ormRepository: Repository<CredentialOrmEntity>;
  let owner: UserOrmEntity;

  const createdCredentialIds: string[] = [];

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      providers: [CredentialRepository],
      typeorm: {
        fixtures: installPermissionFixturesTypeOrm,
      },
    });

    module = testing.module;
    [credentialRepository] = await testing.getMocks([CredentialRepository]);
    ormRepository = module.get<Repository<CredentialOrmEntity>>(
      getRepositoryToken(CredentialOrmEntity),
    );
    const userRepository = module.get<Repository<UserOrmEntity>>(
      getRepositoryToken(UserOrmEntity),
    );
    const adminUser = await userRepository.findOne({
      where: { id: userFixtureIds.admin },
    });
    if (!adminUser) {
      throw new Error('Expected admin user fixture to be available');
    }

    owner = adminUser;
  });

  afterEach(async () => {
    jest.clearAllMocks();
    if (createdCredentialIds.length > 0) {
      await ormRepository.delete(createdCredentialIds);
      createdCredentialIds.length = 0;
    }
  });
  const createPersistedCredential = async (
    overrides: Partial<CredentialOrmEntity> = {},
  ) => {
    const entity = ormRepository.create({
      name: `credential-${randomUUID().slice(0, 8)}`,
      value: `secret-${randomUUID()}`,
      owner,
      ...overrides,
    });
    const saved = await ormRepository.save(entity);
    createdCredentialIds.push(saved.id);

    return saved;
  };

  describe('findOneValue', () => {
    it('returns the credential value when id exists', async () => {
      const saved = await createPersistedCredential({ value: 'secret-value' });
      const result = await credentialRepository.findOneValue(saved.id);

      expect(result).toBe('secret-value');
    });

    it('returns an empty string when id does not exist', async () => {
      const result = await credentialRepository.findOneValue(randomUUID());

      expect(result).toBe('');
    });
  });
});
