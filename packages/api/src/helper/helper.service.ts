/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Injectable, InternalServerErrorException } from '@nestjs/common';

import { LoggerService } from '@/logger/logger.service';
import { SettingService } from '@/setting/services/setting.service';

import BaseHelper from './lib/base-helper';
import { HelperName, HelperRegistry, HelperType, TypeOfHelper } from './types';

@Injectable()
export class HelperService {
  private registry: HelperRegistry = new Map();

  constructor(
    private readonly settingService: SettingService,
    private readonly logger: LoggerService,
  ) {
    // Init empty registry
    Object.values(HelperType).forEach((type: HelperType) => {
      this.registry.set(type, new Map());
    });
  }

  /**
   * Registers a helper.
   *
   * @param name - The helper to be registered.
   */
  public register<H extends BaseHelper>(helper: H) {
    const helpers = this.registry.get(helper.getType()) as Map<string, H>;
    if (helpers.has(helper.getName())) {
      throw new InternalServerErrorException(
        `Helper with Name ${helper.getName()} and Type ${helper.getType()} already exist`,
      );
    }
    helpers.set(helper.getName(), helper);
    this.logger.log(`Helper "${helper.getName()}" has been registered!`);
  }

  /**
   * Get a helper by name and type.
   *
   * @param type - The type of helper.
   * @param name - The helper's name.
   *
   * @returns - The helper
   */
  public get<T extends HelperType>(type: T, name: HelperName) {
    const helpers = this.registry.get(type) as Map<string, BaseHelper>;

    if (!helpers?.has(name)) {
      throw new Error(
        `Unable to find helper "${name}" of type "${type}". Available helpers: ${
          helpers ? Array.from(helpers.keys()).join(', ') || 'none' : 'none'
        }.`,
      );
    }

    return helpers.get(name) as TypeOfHelper<T>;
  }

  /**
   * Get all helpers by type.
   *
   * @returns - The helpers
   */
  public getAllByType<T extends HelperType>(type: T) {
    const helpers = this.registry.get(type);
    if (!helpers) {
      this.logger.warn(`Unknown helper type requested: ${String(type)}`);

      return [];
    }

    return Array.from((helpers as Map<string, TypeOfHelper<T>>).values());
  }

  /**
   * Retrieves all registered helpers as an array.
   *
   * @returns An array containing all the registered helpers.
   */
  public getAll(): BaseHelper[] {
    return Array.from(this.registry.values()) // Get all the inner maps
      .flatMap((innerMap) => Array.from(innerMap.values())); // Flatten and get the values from each inner map
  }

  /**
   * Get a helper by class.
   *
   * @param type - The type of helper.
   * @param name - The helper's name.
   *
   * @returns - The helper
   */
  public use<
    T extends HelperType,
    C extends new (...args: any[]) => TypeOfHelper<T>,
  >(type: T, cls: C) {
    const helpers = this.getAllByType(type);
    const helper = helpers.find((h) => h instanceof cls);

    if (!helper) {
      throw new Error(`Unable to find the requested helper`);
    }

    return helper as InstanceType<C>;
  }

  /**
   * Get default helper for a specific type.
   *
   * @param type - The type of the helper.
   * @returns - The helper
   */
  async getDefaultHelper<T extends HelperType>(type: T) {
    if (type === HelperType.UTIL) {
      throw new Error(
        `Default helpers are not available for type: ${HelperType.UTIL}`,
      );
    }

    const settings = await this.settingService.getSettings();
    const defaultHelperKey = `default_${type}_helper`;
    if (!(defaultHelperKey in settings.global_settings)) {
      throw new Error(`Default ${type.toUpperCase()} helper setting not found`);
    }

    const defaultHelperName = settings.global_settings[
      defaultHelperKey
    ] as HelperName;
    const defaultHelper = this.get<T>(type, defaultHelperName);

    if (!defaultHelper) {
      throw new Error(`Unable to find default ${type.toUpperCase()} helper`);
    }

    return defaultHelper;
  }
}
