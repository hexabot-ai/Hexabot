/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { HelperType } from '../types';

import BaseHelper from './base-helper';

class EnvironmentHelper extends BaseHelper {
  protected readonly type = HelperType.UTIL;

  constructor(private readonly available: boolean) {
    super('environment-helper');
  }

  override isAvailable(): boolean {
    return this.available;
  }
}

describe('BaseHelper environment availability', () => {
  it.each([
    { available: true, registrations: 1 },
    { available: false, registrations: 0 },
  ])(
    'registers only available helpers',
    async ({ available, registrations }) => {
      const helper = new EnvironmentHelper(available);
      const register = jest.fn();
      (
        helper as unknown as {
          helperService: { register: jest.Mock };
        }
      ).helperService = { register };

      await helper.onModuleInit();

      expect(register).toHaveBeenCalledTimes(registrations);
    },
  );
});
