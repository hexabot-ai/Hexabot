/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { JwtSignOptions } from '@nestjs/jwt';
import SMTPConnection from 'nodemailer/lib/smtp-connection';
import type { ServerOptions, Socket } from 'socket.io';

export interface JwtConfigOptions extends JwtSignOptions {
  salt: number;
}
type TMethods = 'GET' | 'PATCH' | 'POST' | 'DELETE' | 'OPTIONS' | 'HEAD';
type TLogLevel = 'log' | 'fatal' | 'error' | 'warn' | 'debug' | 'verbose';
type TCacheConfig = {
  ttl: number;
  max: number;
  host: string;
  port: number;
  type: 'memory' | 'redis';
  protocol: string;
  user: string;
  password: string;
};
type TAuditBackend =
  | 'database'
  | 'opentelemetry-http'
  | 'opentelemetry-grpc'
  | 'clickhouse';
type TDatabaseType = 'sqlite' | 'postgres' | 'mongodb';
type TDatabaseConfig = {
  type: TDatabaseType;
  url?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  sqlitePath?: string;
  synchronize: boolean;
  logging: boolean;
  schema?: string;
  autoMigrate: boolean;
};
type TMcpConfig = {
  enabled: boolean;
  serverName: string;
  serverTitle: string;
  serverVersion: string;
  serverDescription: string;
  serverInstructions: string;
};
type SocketCookie =
  | {
      maxAge?: number | undefined;
      name: string;
      path?: string | undefined;
      httpOnly?: boolean | undefined;
      secure?: boolean | undefined;
    }
  | boolean;

export type Config = {
  i18n: { translationFilename: string };
  appPath: string;
  apiBaseUrl: string;
  uiBaseUrl: string;
  ssoEnabled: boolean;
  mcp: TMcpConfig;
  security: {
    httpsEnabled: boolean;
    trustProxy: boolean;
    cors: {
      allRoutes: boolean;
      headers: string;
      methods: TMethods[];
      allowOrigins: string[];
      allowCredentials: boolean;
    };
    csrf: boolean;
    csrfExclude: RegExp[];
    webhookThrottle: {
      ttlMs: number;
      limit: number;
    };
  };
  sockets: {
    path: string;
    transports: ServerOptions['transports'];
    beforeConnect(_handshake: any): boolean;
    afterDisconnect(_socket: Socket): Promise<void>;
    serveClient: boolean;
    pingTimeout: number;
    pingInterval: number;
    maxHttpBufferSize: number;
    allowUpgrades: boolean;
    cookie: SocketCookie;
    sendResponseHeaders: boolean;
    sendStatusCode: boolean;
    grant3rdPartyCookie: boolean;
    onlyAllowOrigins: string[];
  };
  session: {
    secret: string;
    name: string;
    cleanupLimit: number;
    limitSubquery: boolean;
    ttlSeconds?: number;
    cookie: {
      maxAge: number;
    };
  };
  emails: {
    isEnabled: boolean;
    smtp: Partial<SMTPConnection.Options>;
    from: string;
  };
  parameters: {
    uploadDir: string;
    avatarDir: string;
    storageMode: 'disk' | 'memory';
    maxUploadSize: number;
    appName: string;
    signedUrl: JwtConfigOptions;
  };
  pagination: {
    limit: number;
  };
  chatbot: {
    messages: {
      track_delivery: boolean;
      track_read: boolean;
    };
    logEvents: boolean;
  };
  log: {
    level: TLogLevel;
  };
  cache: TCacheConfig;
  database: TDatabaseConfig;
  env: string;
  authentication: {
    jwtOptions: JwtConfigOptions;
  };
  password_reset: {
    jwtOptions: JwtConfigOptions;
  };
  confirm_account: { jwtOptions: JwtConfigOptions };
  analytics: {
    thresholds: {
      loyalty: number;
      returning: number;
      retention: number;
      retentionReset: number;
    };
  };
  audit: {
    enabled: boolean;
    backend: TAuditBackend;
    failClosed: boolean;
    serviceName: string;
    serviceNamespace: string;
    serviceEnvironmentName: string;
    maskFields: string[];
    opentelemetry: {
      url?: string;
      hostname?: string;
      headers: Record<string, string>;
      timeoutMillis?: number;
      concurrencyLimit?: number;
    };
    clickhouse: {
      url?: string;
      databaseName: string;
      logExpired?: number;
    };
  };
};
