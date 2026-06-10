/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { IncomingMessage } from 'http';
import util from 'util';

import type { Source } from '@hexabot-ai/types';
import { NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { ServerOptions } from 'socket.io';

import { AppInstance } from '@/app.instance';
import { SourceService } from '@/channel/services/source.service';
import { config } from '@/config';
import { CONSOLE_CHANNEL_NAME } from '@/extensions/channels/console/settings.schema';
import { WEB_CHANNEL_NAME } from '@/extensions/channels/web/settings.schema';
import { SettingService } from '@/setting/services/setting.service';
import { getAllowedDomains, isAllowedOrigin } from '@/utils/helpers/origin';

type SocketCorsSource = Pick<Source, 'channel' | 'settings'>;
type AllowRequestCallback = (
  err: string | null | undefined,
  success: boolean,
) => void;

export type SocketOriginDependencies = {
  getAllowedOrigins: () => Promise<string[]>;
  findActiveSourceById: (sourceId: string) => Promise<SocketCorsSource | null>;
};

const getDefaultSocketOriginDependencies = (): SocketOriginDependencies => {
  const app = AppInstance.getApp();
  const settingService = app.get<SettingService>(SettingService);
  const sourceService = app.get<SourceService>(SourceService);

  return {
    getAllowedOrigins: () => settingService.getAllowedOrigins(),
    findActiveSourceById: (sourceId) => sourceService.findActiveById(sourceId),
  };
};

export const isSocketRequestOriginAllowed = async (
  handshake: IncomingMessage,
  dependencies: SocketOriginDependencies = getDefaultSocketOriginDependencies(),
): Promise<boolean> => {
  const { origin: rawOrigin } = handshake.headers;
  const origin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
  const rawSourceId = handshake.url
    ? new URL(handshake.url, 'ws://localhost').searchParams.get('source_id')
    : null;

  if (!rawSourceId) {
    return isAllowedOrigin(origin, await dependencies.getAllowedOrigins());
  }

  if (!isUUID(rawSourceId)) {
    return false;
  }

  let source: SocketCorsSource | null;
  try {
    source = await dependencies.findActiveSourceById(rawSourceId);
  } catch (error) {
    if (error instanceof NotFoundException) {
      return false;
    }
    throw error;
  }
  if (!source) {
    return false;
  }

  if (source.channel === WEB_CHANNEL_NAME) {
    return isAllowedOrigin(origin, getAllowedDomains(source.settings));
  }

  if (source.channel === CONSOLE_CHANNEL_NAME) {
    return isAllowedOrigin(origin, await dependencies.getAllowedOrigins());
  }

  return false;
};

const runBeforeConnect = (
  handshake: IncomingMessage,
  cb: AllowRequestCallback,
): boolean => {
  try {
    const result = config.sockets.beforeConnect(handshake);

    if (!result) {
      cb(null, false);

      return false;
    }

    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log(
      `A socket was rejected via the config.sockets.beforeConnect function.\n` +
        `It attempted to connect with headers:\n` +
        `${util.inspect(handshake.headers, { depth: null })}\n` +
        `Details: ${e}`,
    );

    cb(e instanceof Error ? e.message : `${e}`, false);

    return false;
  }
};

export const buildWebSocketGatewayOptions = (
  dependencies?: SocketOriginDependencies,
): Partial<ServerOptions> => {
  const opts: Partial<ServerOptions> = {
    allowEIO3: true, // Allows support for Engine.io v3 clients.
    path: config.sockets.path,
    ...(typeof config.sockets.serveClient !== 'undefined' && {
      serveClient: config.sockets.serveClient,
    }),
    allowRequest: (handshake, cb) => {
      if (!runBeforeConnect(handshake, cb)) {
        return;
      }

      if (config.env === 'test') {
        cb(null, true);

        return;
      }

      isSocketRequestOriginAllowed(handshake, dependencies)
        .then((allowed) => {
          if (allowed) {
            cb(null, true);

            return;
          }

          // eslint-disable-next-line no-console
          console.log(
            `A socket was rejected by the Socket.IO origin policy.\n` +
              `It attempted to connect with origin: ${handshake.headers.origin}`,
          );
          cb('Origin not allowed', false);
        })
        .catch((error) => {
          cb(error instanceof Error ? error.message : `${error}`, false);
        });
    },
    ...(config.sockets.pingTimeout && {
      pingTimeout: config.sockets.pingTimeout,
    }),
    ...(config.sockets.pingInterval && {
      pingInterval: config.sockets.pingInterval,
    }),
    ...(config.sockets.maxHttpBufferSize && {
      maxHttpBufferSize: config.sockets.maxHttpBufferSize,
    }),
    ...(config.sockets.transports && { transports: config.sockets.transports }),
    ...(config.sockets.allowUpgrades && {
      allowUpgrades: config.sockets.allowUpgrades,
    }),
    ...(config.sockets.cookie && { cookie: config.sockets.cookie }),
    cors: {
      credentials: true,
      origin: true,
    },
  };

  return opts;
};
