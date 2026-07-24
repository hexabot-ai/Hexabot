/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { Cache } from 'cache-manager';

import { SETTING_CACHE_KEY } from '@/utils/constants/cache';
import { BaseOrmSeeder } from '@/utils/generics/base-orm.seeder';

import { SettingCreateDto } from '../dto/setting.dto';
import { SettingOrmEntity } from '../entities/setting.entity';
import { SettingRepository } from '../repositories/setting.repository';

@Injectable()
export class SettingSeeder extends BaseOrmSeeder<SettingOrmEntity> {
  constructor(
    settingRepository: SettingRepository,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    super(settingRepository);
  }

  async seed(models: SettingCreateDto[]): Promise<boolean> {
    const missing: SettingCreateDto[] = [];

    for (const model of models) {
      if (
        await this.isEmpty({
          where: {
            group: model.group,
            label: model.label,
          },
        })
      ) {
        missing.push(model);
      }
    }
    if (missing.length > 0) {
      await this.repository.createMany(missing);
    }

    await this.cacheManager.del(SETTING_CACHE_KEY);

    return true;
  }
}
