/*
 * Copyright © 2025 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { NOT_FOUND_ID } from '@/utils/constants/mock';
import { nlpEntityFixtures } from '@/utils/test/fixtures/nlpentity';
import { installNlpValueFixtures } from '@/utils/test/fixtures/nlpvalue';
import { getPageQuery } from '@/utils/test/pagination';
import {
  closeInMongodConnection,
  rootMongooseTestModule,
} from '@/utils/test/test';
import { buildTestingMocks } from '@/utils/test/utils';

import { NlpEntityRepository } from '../repositories/nlp-entity.repository';
import { NlpValueRepository } from '../repositories/nlp-value.repository';
import { NlpEntity } from '../schemas/nlp-entity.schema';

import { NlpEntityService } from './nlp-entity.service';

describe('NlpEntityService', () => {
  let nlpEntityService: NlpEntityService;
  let nlpEntityRepository: NlpEntityRepository;
  let nlpValueRepository: NlpValueRepository;

  beforeAll(async () => {
    const { getMocks } = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      imports: [rootMongooseTestModule(installNlpValueFixtures)],
      providers: [NlpEntityService],
    });
    [nlpEntityService, nlpEntityRepository, nlpValueRepository] =
      await getMocks([
        NlpEntityService,
        NlpEntityRepository,
        NlpValueRepository,
      ]);
  });

  afterAll(closeInMongodConnection);

  afterEach(jest.clearAllMocks);

  describe('The deleteCascadeOne function', () => {
    it('should delete a nlp entity', async () => {
      const intentNlpEntity = await nlpEntityRepository.findOne({
        name: 'intent',
      });
      const result = await nlpEntityService.deleteCascadeOne(
        intentNlpEntity!.id,
      );
      expect(result.deletedCount).toEqual(1);
    });
  });

  describe('findOneAndPopulate', () => {
    it('should return a nlp entity with populate', async () => {
      const firstNameNlpEntity = await nlpEntityRepository.findOne({
        name: 'firstname',
      });
      const result = await nlpEntityService.findOneAndPopulate(
        firstNameNlpEntity!.id,
      );
      const firstNameValues = await nlpValueRepository.findOne({
        entity: firstNameNlpEntity!.id,
      });
      const entityWithValues = {
        id: firstNameNlpEntity!.id,
        ...nlpEntityFixtures[1],
        values: [firstNameValues],
      };
      expect(result).toEqualPayload(entityWithValues);
    });
  });

  describe('findAndPopulate', () => {
    it('should return all nlp entities with populate', async () => {
      const pageQuery = getPageQuery<NlpEntity>({ sort: ['name', 'desc'] });
      const firstNameNlpEntity = await nlpEntityRepository.findOne({
        name: 'firstname',
      });
      const result = await nlpEntityService.findAndPopulate(
        { _id: firstNameNlpEntity!.id },
        pageQuery,
      );
      const firstNameValues = await nlpValueRepository.findOne({
        entity: firstNameNlpEntity!.id,
      });
      const entitiesWithValues = [
        {
          id: firstNameNlpEntity!.id,
          ...nlpEntityFixtures[1],
          values: [firstNameValues],
        },
      ];
      expect(result).toEqualPayload(entitiesWithValues);
    });
  });
  describe('NlpEntityService - updateWeight', () => {
    let createdEntity: NlpEntity;
    beforeEach(async () => {
      createdEntity = await nlpEntityRepository.create({
        name: 'testentity',
        builtin: false,
        weight: 3,
      });
    });

    it('should update the weight of an NLP entity', async () => {
      const newWeight = 8;

      const updatedEntity = await nlpEntityService.updateWeight(
        createdEntity.id,
        newWeight,
      );

      expect(updatedEntity.weight).toBe(newWeight);
    });

    it('should handle updating weight of non-existent entity', async () => {
      const nonExistentId = NOT_FOUND_ID;

      try {
        await nlpEntityService.updateWeight(nonExistentId, 5);
        fail('Expected error was not thrown');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should use default weight of 1 when creating entity without weight', async () => {
      const createdEntity = await nlpEntityRepository.create({
        name: 'entityWithoutWeight',
        builtin: true,
        // weight not specified
      });

      expect(createdEntity.weight).toBe(1);
    });

    it('should throw an error if weight is negative', async () => {
      const invalidWeight = -3;

      await expect(
        nlpEntityService.updateWeight(createdEntity.id, invalidWeight),
      ).rejects.toThrow('Weight must be a strictly positive number');
    });

    afterEach(async () => {
      // Clean the collection after each test
      await nlpEntityRepository.deleteOne(createdEntity.id);
    });
  });

  describe('storeNewEntities', () => {
    it('should store new entities', async () => {
      const result = await nlpEntityService.storeNewEntities(
        'Mein Name ist Hexabot',
        [
          { entity: 'intent', value: 'Name' },
          { entity: 'language', value: 'de' },
        ],
        ['trait'],
      );
      const intentEntity = await nlpEntityRepository.findOne({
        name: 'intent',
      });
      const languageEntity = await nlpEntityRepository.findOne({
        name: 'language',
      });
      const nameValue = await nlpValueRepository.findOne({ value: 'Name' });
      const deValue = await nlpValueRepository.findOne({ value: 'de' });
      const storedEntites = [
        {
          entity: intentEntity!.id,
          value: nameValue!.id,
        },
        {
          entity: languageEntity!.id,
          value: deValue!.id,
        },
      ];

      expect(result).toEqualPayload(storedEntites);
    });
  });
  describe('getNlpMap', () => {
    it('should return a NlpCacheMap with the correct structure', async () => {
      // Act
      const result = await nlpEntityService.getNlpMap();

      expect(result).toEqual(
        expect.objectContaining({
          firstname: expect.any(Object),
          subject: expect.any(Object),
        }),
      );
      expect(result.firstname).toEqualPayload(
        {
          name: 'firstname',
          lookups: ['keywords'],
          doc: '',
          builtin: false,
          weight: 0.85,
          values: [
            {
              value: 'jhon',
              expressions: ['john', 'joohn', 'jhonny'],
              builtin: false,
              doc: '',
            },
          ],
        },
        ['id', 'createdAt', 'updatedAt', 'metadata', 'entity'],
      );
      expect(result.subject).toEqualPayload(
        {
          name: 'subject',
          lookups: ['trait'],
          doc: '',
          builtin: false,
          weight: 0.95,
          values: [
            {
              value: 'product',
              expressions: [],
              builtin: false,
              doc: '',
            },
            {
              value: 'claim',
              expressions: [],
              builtin: false,
              doc: '',
            },
          ],
        },
        ['id', 'createdAt', 'updatedAt', 'metadata', 'entity'],
      );
    });
  });
});
