/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Url } from 'url';

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

import { AuthenticationGuard } from './authentication.guard';

const buildContext = (request: Record<string, unknown>): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
    }),
  }) as unknown as ExecutionContext;
const buildRequest = (overrides: Record<string, unknown> = {}) => ({
  _parsedUrl: { pathname: '/api/workflow' } as Url,
  headers: {} as Record<string, string>,
  ...overrides,
});

describe('AuthenticationGuard', () => {
  // super.canActivate delegates to the passport 'api-bearer' strategy; stub it
  // so we can assert the guard's routing decisions without a live strategy.
  const parentProto = Object.getPrototypeOf(AuthenticationGuard.prototype);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('falls through to the session when no Authorization header is present', async () => {
    const superCanActivate = jest.spyOn(parentProto, 'canActivate');
    const guard = new AuthenticationGuard();

    await expect(guard.canActivate(buildContext(buildRequest()))).resolves.toBe(
      true,
    );
    expect(superCanActivate).not.toHaveBeenCalled();
  });

  it('rejects a non-bearer Authorization header instead of using the session', async () => {
    const guard = new AuthenticationGuard();

    await expect(
      guard.canActivate(
        buildContext(buildRequest({ headers: { authorization: 'Basic abc' } })),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects API tokens on token-management endpoints', async () => {
    const guard = new AuthenticationGuard();

    await expect(
      guard.canActivate(
        buildContext(
          buildRequest({
            _parsedUrl: { pathname: '/api/api-token' } as Url,
            headers: { authorization: 'Bearer hbt_api_secret' },
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('delegates a valid bearer token to the api-bearer strategy', async () => {
    const superCanActivate = jest
      .spyOn(parentProto, 'canActivate')
      .mockResolvedValue(true);
    const guard = new AuthenticationGuard();
    const context = buildContext(
      buildRequest({ headers: { authorization: 'Bearer hbt_api_secret' } }),
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(superCanActivate).toHaveBeenCalledWith(context);
  });
});
