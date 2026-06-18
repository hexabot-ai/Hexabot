/*
 * Copyright © 2025 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cache } from 'cache-manager';

import { NLP_MAP_CACHE_KEY } from '@/utils/constants/cache';
import { Cacheable } from '@/utils/decorators/cacheable.decorator';
import { BaseService } from '@/utils/generics/base-service';

import { NlpEntityDto } from '../dto/nlp-entity.dto';
import { NlpEntityRepository } from '../repositories/nlp-entity.repository';
import {
  NlpEntity,
  NlpEntityFull,
  NlpEntityPopulate,
} from '../schemas/nlp-entity.schema';
import { Lookup, NlpCacheMap, NlpSampleEntityValue } from '../schemas/types';

import { NlpValueService } from './nlp-value.service';

@Injectable()
export class NlpEntityService extends BaseService<
  NlpEntity,
  NlpEntityPopulate,
  NlpEntityFull,
  NlpEntityDto
> {
  constructor(
    readonly repository: NlpEntityRepository,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly nlpValueService: NlpValueService,
  ) {
    super(repository);
  }

  /**
   * Deletes an entity by its ID.
   *
   * @param id - The ID of the entity to delete.
   *
   * @returns A promise that resolves when the entity is deleted.
   */
  async deleteCascadeOne(id: string) {
    return await this.repository.deleteOne(id);
  }

  /**
   * Updates the `weight` field of a specific NLP entity by its ID.
   *
   * This method is part of the NLP-based blocks prioritization strategy.
   * The weight influences the scoring of blocks when multiple blocks match a user's input.
   * @param id - The unique identifier of the entity to update.
   * @param updatedWeight - The new weight to assign. Must be a positive number.
   * @throws Error if the weight is not a positive number.
   * @returns A promise that resolves to the updated entity.
   */
  async updateWeight(id: string, updatedWeight: number): Promise<NlpEntity> {
    if (updatedWeight <= 0) {
      throw new BadRequestException(
        'Weight must be a strictly positive number',
      );
    }

    return await this.repository.updateOne(id, { weight: updatedWeight });
  }

  /**
   * Stores new entities based on the sample text and sample entities.
   * Deletes all values relative to this entity before deleting the entity itself.
   * This is typically used during an import process.
   *
   * @param sampleText - The text sample containing NLP entities.
   * @param sampleEntities - The list of sample entity values to be processed.
   * @param lookups - Optional list of lookups used to classify the entities.
   *
   * @returns A promise that resolves when the entities and their values are stored.
   */
  async storeNewEntities(
    sampleText: string,
    sampleEntities: NlpSampleEntityValue[],
    lookups: Lookup[] = ['keywords'],
  ) {
    // Extract entity names from sampleEntities
    const entities = sampleEntities.map((e) => e.entity);

    // Retrieve stored entities
    let storedEntities = (await this.find({ name: { $in: entities } })) || [];
    // Find newly added entities
    const entitiesToAdd = entities
      .filter((e) => storedEntities.findIndex((se) => se.name === e) === -1)
      .filter((e, idx, self) => self.indexOf(e) === idx)
      .map((e) => ({ name: e, lookups }));
    // Create new entities
    const newEntities = await this.createMany(entitiesToAdd);
    // Add new entities to the storedEntities array
    storedEntities = storedEntities.concat(newEntities);
    return await this.nlpValueService.storeNewValues(
      sampleText,
      sampleEntities,
      storedEntities,
    );
  }

  /**
   * Stores only new entities based on the provided sample entities and returns them.
   * It creates new entities if they do not already exist.
   *
   * @param sampleEntities - The list of sample entity values to process.
   *
   * @returns A promise that resolves with the list of stored entities, including their IDs.
   */
  storeEntities(sampleEntities: NlpSampleEntityValue[]): Promise<NlpEntity[]> {
    const findOrCreate = sampleEntities.map((e: NlpSampleEntityValue) =>
      this.findOneOrCreate({ name: e.entity }, { name: e.entity }),
    );
    return Promise.all(findOrCreate);
  }

  /**
   * Clears the NLP map cache
   */
  async clearCache() {
    await this.cacheManager.del(NLP_MAP_CACHE_KEY);
  }

  /**
   * Event handler for Nlp Entity updates. Listens to 'hook:nlpEntity:*' events
   * and invalidates the cache for nlp entities when triggered.
   */
  @OnEvent('hook:nlpEntity:*')
  async handleNlpEntityUpdateEvent() {
    try {
      await this.clearCache();
    } catch (error) {
      this.logger.error('Failed to clear NLP entity cache', error);
    }
  }

  /**
   * Event handler for Nlp Value updates. Listens to 'hook:nlpValue:*' events
   * and invalidates the cache for nlp values when triggered.
   */
  @OnEvent('hook:nlpValue:*')
  async handleNlpValueUpdateEvent() {
    try {
      await this.clearCache();
    } catch (error) {
      this.logger.error('Failed to clear NLP value cache', error);
    }
  }

  /**
   * Retrieves NLP entity lookup information for the given list of entity names.
   *
   * This method queries the database for nlp entities,
   * transforms the result into a plain object where each key is
   * the entity name and each value contains metadata (id, weight, and list of values),
   * and caches the result using the configured cache key.
   *
   * @returns A Promise that resolves to an object of entity name to its corresponding lookup metadata.
   */
  @Cacheable(NLP_MAP_CACHE_KEY)
  async getNlpMap(): Promise<NlpCacheMap> {
    const entities = await this.findAllAndPopulate();
    return entities.reduce<NlpCacheMap>(
      (acc, curr) => {
        acc[curr.name] = curr;
        return acc;
      },
      Object.create(null) as NlpCacheMap,
    );
  }

  /**
   * Retrieves all NLP entities that declare at least one of the specified
   * lookup strategies.
   *
   * @async
   * @param lookups - One or more lookup strategies to match
   * against (e.g., {@link LookupStrategy.keywords}, {@link LookupStrategy.pattern}).
   * An entity is included in the result if **any** of these strategies is found
   * in its own `lookups` array.
   * @returns A promise that resolves to the
   * collection of matching entities.
   */
  async getNlpEntitiesByLookup(lookups: Lookup[]): Promise<NlpEntityFull[]> {
    const entities = Object.values(await this.getNlpMap());
    return entities.filter((e) => {
      return lookups.filter((l) => e.lookups.includes(l)).length > 0;
    });
  }
}
