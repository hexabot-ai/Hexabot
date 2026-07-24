/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Inject, OnModuleInit } from '@nestjs/common';

import { SettingService } from '@/setting/services/setting.service';
import { Extension } from '@/utils/generics/extension';

import { HelperService } from '../helper.service';
import { HelperName, HelperType } from '../types';

export default abstract class BaseHelper<N extends HelperName = HelperName>
  extends Extension
  implements OnModuleInit
{
  protected abstract type: HelperType;

  @Inject(SettingService)
  protected readonly settingService: SettingService;

  @Inject(HelperService)
  protected readonly helperService: HelperService;

  constructor(name: N) {
    super(name);
  }

  async onModuleInit() {
    await super.onModuleInit();
    if (this.isAvailable()) {
      this.helperService.register(this);
    }
  }

  /**
   * Indicates whether this helper can run in the current environment.
   *
   * Environment-specific helpers can override this method to stay out of the
   * registry (and therefore out of helper selectors) when their prerequisites
   * are not available.
   */
  public isAvailable(): boolean {
    return true;
  }

  /**
   * Get the helper's type
   *
   * @returns Helper's type
   */
  public getType() {
    return this.type;
  }

  /**
   * Get the helper's settings
   *
   * @returns Helper's settings
   */
  async getSettings<S extends string = N>() {
    const settings = await this.settingService.getSettings();

    // @ts-expect-error workaround typing
    return settings[this.getName() as keyof Settings] as Settings[S];
  }
}
