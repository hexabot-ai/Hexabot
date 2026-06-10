/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Setting } from '@hexabot-ai/types';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  IHookSettingsGroupLabelOperationMap,
  OnEvent,
} from '@nestjs/event-emitter';
import { Cache } from 'cache-manager';
import { FindOneOptions } from 'typeorm';

import { config } from '@/config';
import { Config } from '@/config/types';
import {
  ALLOWED_ORIGINS_CACHE_KEY,
  SETTING_CACHE_KEY,
} from '@/utils/constants/cache';
import { Cacheable } from '@/utils/decorators/cacheable.decorator';
import { UpdateOneOptions } from '@/utils/generics/base-orm.repository';
import { BaseOrmService } from '@/utils/generics/base-orm.service';
import { splitAllowedOrigins } from '@/utils/helpers/origin';
import { UpdateEntityEvent } from '@/utils/types/entity-event.types';

import { SettingCreateDto, SettingUpdateDto } from '../dto/setting.dto';
import { SettingOrmEntity } from '../entities/setting.entity';
import { SettingRepository } from '../repositories/setting.repository';
import { buildSettingSeedsFromRegistry } from '../runtime-settings.seed';
import { SettingSeeder } from '../seeds/setting.seed';

import { RuntimeSettingsService } from './runtime-settings.service';

@Injectable()
export class SettingService extends BaseOrmService<SettingOrmEntity> {
  constructor(
    repository: SettingRepository,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly seeder: SettingSeeder,
    private readonly runtimeSettingsService: RuntimeSettingsService,
  ) {
    super(repository);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.seedRegisteredSettings();
  }

  private async seedRegisteredSettings(): Promise<void> {
    const runtimeRegistry = this.runtimeSettingsService.getRegistry();

    if (Object.keys(runtimeRegistry).length === 0) {
      return;
    }

    const models = buildSettingSeedsFromRegistry(runtimeRegistry);
    if (models.length === 0) {
      return;
    }

    await this.seeder.seed(models);
  }

  /**
   * Seeds the settings if they don't already exist for the provided group.
   *
   * @param group - The group of settings to check.
   * @param data - The array of settings to seed if none exist.
   */
  async seedIfNotExist(group: string, data: SettingCreateDto[]): Promise<void> {
    const count = await this.count({ where: { group } });
    if (count === 0) {
      await this.seeder.seed(data);
    }
  }

  private getCoercionCandidates(value: unknown): unknown[] {
    if (typeof value !== 'string') {
      return [value];
    }

    const candidates: unknown[] = [value];
    const normalized = value.trim().toLowerCase();
    const asNumber = Number(value);

    if (normalized === 'true') {
      candidates.push(true);
    } else if (normalized === 'false') {
      candidates.push(false);
    }

    if (Number.isFinite(asNumber) && value.trim() !== '') {
      candidates.push(asNumber);
    }

    return candidates;
  }

  private isPersistedSettingValue(
    value: unknown,
  ): value is SettingUpdateDto['value'] {
    if (value === null) {
      return true;
    }

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return true;
    }

    if (Array.isArray(value)) {
      return value.every((entry) => typeof entry === 'string');
    }

    return typeof value === 'object';
  }

  private validateAndNormalizeSettingValue(
    group: string,
    label: string,
    value: unknown,
  ): SettingUpdateDto['value'] {
    let schema: ReturnType<RuntimeSettingsService['getSchemaFor']>;

    try {
      schema = this.runtimeSettingsService.getSchemaFor(group, label);
    } catch (_error) {
      throw new BadRequestException(
        `Setting "${group}.${label}" is not registered in runtime settings schemas.`,
      );
    }

    for (const candidate of this.getCoercionCandidates(value)) {
      const result = schema.safeParse(candidate);
      if (result.success) {
        if (this.isPersistedSettingValue(result.data)) {
          return result.data;
        }

        throw new BadRequestException(
          `Setting "${group}.${label}" resolved to an unsupported value type.`,
        );
      }
    }

    throw new BadRequestException(
      `Invalid value provided for setting "${group}.${label}".`,
    );
  }

  override async updateOne(
    idOrOptions: string | FindOneOptions<SettingOrmEntity>,
    payload: SettingUpdateDto,
    options?: UpdateOneOptions,
  ): Promise<Setting> {
    const current = await this.findOne(idOrOptions);

    if (!current) {
      throw new NotFoundException('Unable to execute updateOne() - No updates');
    }

    const value = this.validateAndNormalizeSettingValue(
      current.group,
      current.label,
      payload.value,
    );

    return await super.updateOne(idOrOptions, { ...payload, value }, options);
  }

  /**
   * Loads all settings and returns them grouped by group key.
   *
   * @returns A grouped object of settings.
   */
  async load(): Promise<Record<string, Setting[]>> {
    const settings = await this.findAll();

    return this.group(settings);
  }

  /**
   * Builds a tree structure from the settings array.
   *
   * Each setting is grouped by its `group` and returned as a structured object.
   *
   * @param settings - An array of settings to build into a tree structure.
   *
   * @returns A `Settings` object organized by group.
   */
  public buildTree(settings: Setting[]): Settings {
    return settings.reduce((acc: Settings, setting: Setting) => {
      const groupKey = setting.group || 'undefinedGroup';

      acc[groupKey] = acc[groupKey] || {};
      acc[groupKey][setting.label] = setting.value;

      return acc;
    }, {} as Settings);
  }

  /**
   * Groups the settings into a record where the key is the setting group and
   * the value is an array of settings in that group.
   *
   * @param settings - An array of settings to group.
   *
   * @returns A record where each key is a group and each value is an array of settings.
   */
  public group(settings: Setting[]): Record<string, Setting[]> {
    return settings.reduce(
      (acc, curr) => {
        const group = acc[curr.group] || [];
        group.push(curr);
        acc[curr.group] = group;

        return acc;
      },
      {} as Record<string, Setting[]>,
    );
  }

  /**
   * Retrieves the application configuration object.
   *
   * @returns The global configuration object.
   */
  getConfig(): Config {
    return config;
  }

  /**
   * Clears the settings cache
   */
  async clearCache(): Promise<void> {
    await this.cacheManager.del(SETTING_CACHE_KEY);
    await this.cacheManager.del(ALLOWED_ORIGINS_CACHE_KEY);
  }

  /**
   * Event handler for setting updates. Listens to 'hook:setting:*' events
   * and invalidates the cache for settings when triggered.
   */
  @OnEvent('hook:setting:*')
  async handleSettingUpdateEvent(): Promise<void> {
    await this.clearCache();
  }

  /**
   * Retrieves a set of unique allowed origins for CORS configuration.
   *
   * This method combines all `allowed_domains` settings,
   * splits their values (comma-separated), and removes duplicates to produce a
   * whitelist of origins. The result is cached for better performance using the
   * `Cacheable` decorator with the key `ALLOWED_ORIGINS_CACHE_KEY`.
   *
   * @returns A promise that resolves to a set of allowed origins
   */
  @Cacheable(ALLOWED_ORIGINS_CACHE_KEY)
  async getAllowedOrigins(): Promise<string[]> {
    const settings = (await this.find({
      where: { label: 'allowed_domains' },
    })) as Setting[];
    const allowedDomains = settings.flatMap((setting) =>
      typeof setting.value === 'string'
        ? splitAllowedOrigins(setting.value)
        : [],
    );
    const uniqueOrigins = new Set([
      ...config.security.cors.allowOrigins,
      ...config.sockets.onlyAllowOrigins,
      ...allowedDomains,
    ]);

    return Array.from(uniqueOrigins);
  }

  /**
   * Retrieves settings from the cache if available, or loads them from the
   * repository and caches the result.
   *
   * @returns A promise that resolves to a `Settings` object.
   */
  @Cacheable(SETTING_CACHE_KEY)
  async getSettings(): Promise<Settings> {
    const settings = await this.findAll();

    return this.buildTree(settings);
  }

  getAllSchemaDefinitions() {
    return this.runtimeSettingsService.getAllSchemaDefinitions();
  }

  /**
   * Emits an event after a `Setting` has been updated.
   *
   * This method is used to synchronize global settings by emitting an event
   * based on the `group` and `label` of the `Setting`.
   */
  @OnEvent('hook:setting:postUpdate')
  async emitSettingEvents(
    event: UpdateEntityEvent<SettingOrmEntity>,
  ): Promise<void> {
    if (event.entity) {
      const setting = event.entity.toPlainCls();
      const group = setting.group as keyof IHookSettingsGroupLabelOperationMap;
      const label = setting.label as '*';
      this.eventEmitter?.emit(`hook:${group}:${label}`, setting);
    }
  }
}
