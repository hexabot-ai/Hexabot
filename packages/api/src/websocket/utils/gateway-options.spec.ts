/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { IncomingMessage } from 'http';

import { config } from '@/config';
import { CONSOLE_CHANNEL_NAME } from '@/extensions/channels/console/settings.schema';
import { WEB_CHANNEL_NAME } from '@/extensions/channels/web/settings.schema';

import { buildWebSocketGatewayOptions } from './gateway-options';
import type { SocketOriginDependencies } from './gateway-options';

type SocketCorsSource = NonNullable<
  Awaited<ReturnType<SocketOriginDependencies['findActiveSourceById']>>
>;

describe('buildWebSocketGatewayOptions', () => {
  const originalEnv = config.env;
  const originalBeforeConnect = config.sockets.beforeConnect;
  const webSourceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const consoleSourceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const sources: Record<string, SocketCorsSource> = {
    [webSourceId]: {
      channel: WEB_CHANNEL_NAME,
      settings: { allowed_domains: 'https://embed.example.com' },
    },
    [consoleSourceId]: {
      channel: CONSOLE_CHANNEL_NAME,
      settings: { allowed_domains: 'https://embed.example.com' },
    },
  };
  const makeHandshake = (origin?: string, sourceId?: string): IncomingMessage =>
    ({
      headers: origin ? { origin } : {},
      url: `/socket.io/?EIO=4&transport=websocket${
        sourceId ? `&source_id=${sourceId}` : ''
      }`,
    }) as unknown as IncomingMessage;
  const makeDependencies = (): jest.Mocked<SocketOriginDependencies> => ({
    getAllowedOrigins: jest
      .fn()
      .mockResolvedValue(['https://admin.example.com']),
    findActiveSourceById: jest.fn(
      async (sourceId) => sources[sourceId] ?? null,
    ),
  });
  const runAllowRequest = async (
    dependencies: SocketOriginDependencies,
    origin?: string,
    sourceId?: string,
  ): Promise<{ err: string | null | undefined; success: boolean }> => {
    const options = buildWebSocketGatewayOptions(dependencies);

    return await new Promise((resolve) => {
      options.allowRequest?.(
        makeHandshake(origin, sourceId),
        (err, success) => {
          resolve({
            err,
            success,
          });
        },
      );
    });
  };

  beforeEach(() => {
    config.env = 'production';
    config.sockets.beforeConnect = () => true;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    config.env = originalEnv;
    config.sockets.beforeConnect = originalBeforeConnect;
    jest.restoreAllMocks();
  });

  it('enables CORS credentials for socket transports', () => {
    const options = buildWebSocketGatewayOptions();

    expect(options.cors).toMatchObject({ credentials: true });
  });

  it('allows a web source socket when the origin matches source allowed domains', async () => {
    const dependencies = makeDependencies();

    await expect(
      runAllowRequest(dependencies, 'https://embed.example.com', webSourceId),
    ).resolves.toEqual({ err: null, success: true });

    expect(dependencies.findActiveSourceById).toHaveBeenCalledWith(webSourceId);
    expect(dependencies.getAllowedOrigins).not.toHaveBeenCalled();
  });

  it('rejects a web source socket when the origin is not in source allowed domains', async () => {
    const dependencies = makeDependencies();

    await expect(
      runAllowRequest(
        dependencies,
        'https://not-allowed.example.com',
        webSourceId,
      ),
    ).resolves.toMatchObject({
      err: 'Origin not allowed',
      success: false,
    });
  });

  it('allows a web source socket when source allowed domains is wildcard', async () => {
    const dependencies = makeDependencies();
    dependencies.findActiveSourceById.mockResolvedValue({
      channel: WEB_CHANNEL_NAME,
      settings: {
        allowed_domains: '*',
      },
    });

    await expect(
      runAllowRequest(
        dependencies,
        'https://anywhere.example.com',
        webSourceId,
      ),
    ).resolves.toEqual({ err: null, success: true });
  });

  it('does not let console source allowed domains bypass global origins', async () => {
    const dependencies = makeDependencies();

    await expect(
      runAllowRequest(
        dependencies,
        'https://embed.example.com',
        consoleSourceId,
      ),
    ).resolves.toMatchObject({
      err: 'Origin not allowed',
      success: false,
    });

    expect(dependencies.getAllowedOrigins).toHaveBeenCalled();
  });

  it('uses global origins for sockets without source_id', async () => {
    const dependencies = makeDependencies();

    await expect(
      runAllowRequest(dependencies, 'https://admin.example.com'),
    ).resolves.toEqual({ err: null, success: true });

    expect(dependencies.getAllowedOrigins).toHaveBeenCalled();
    expect(dependencies.findActiveSourceById).not.toHaveBeenCalled();
  });

  it('honors beforeConnect before evaluating socket origin policy', async () => {
    const dependencies = makeDependencies();
    config.sockets.beforeConnect = () => false;

    await expect(
      runAllowRequest(dependencies, 'https://embed.example.com', webSourceId),
    ).resolves.toEqual({ err: null, success: false });

    expect(dependencies.findActiveSourceById).not.toHaveBeenCalled();
    expect(dependencies.getAllowedOrigins).not.toHaveBeenCalled();
  });
});
