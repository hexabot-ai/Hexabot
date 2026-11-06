/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { bootstrapHexabotApp } from './bootstrap';
import { describePublicSecrets } from './config/secrets';

jest.mock('./config/secrets', () => ({
  describePublicSecrets: jest.fn(),
}));

class TestModule {}

describe('bootstrapHexabotApp', () => {
  const describePublicSecretsMock = jest.mocked(describePublicSecrets);
  let createSpy: jest.SpyInstance;

  beforeEach(() => {
    createSpy = jest
      .spyOn(NestFactory, 'create')
      .mockRejectedValue(new Error('app created'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    describePublicSecretsMock.mockReset();
  });

  it('refuses to start in production with public signing secrets', async () => {
    describePublicSecretsMock.mockReturnValue('SIGNED_URL_SECRET is unset');

    await expect(
      bootstrapHexabotApp(TestModule, { production: true }),
    ).rejects.toThrow(
      'Refusing to start in production: SIGNED_URL_SECRET is unset',
    );
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('only warns about public signing secrets outside production', async () => {
    const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation();
    describePublicSecretsMock.mockReturnValue('SIGNED_URL_SECRET is unset');

    await expect(
      bootstrapHexabotApp(TestModule, { production: false }),
    ).rejects.toThrow('app created');
    expect(warnSpy).toHaveBeenCalledWith(
      'SIGNED_URL_SECRET is unset',
      'Hexabot',
    );
  });

  it('starts in production once the signing secrets are set', async () => {
    describePublicSecretsMock.mockReturnValue(undefined);

    await expect(
      bootstrapHexabotApp(TestModule, { production: true }),
    ).rejects.toThrow('app created');
    expect(createSpy).toHaveBeenCalled();
  });
});
