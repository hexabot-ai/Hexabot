/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { join } from 'path';

import {
  parseAuditHeaders,
  parseCsv,
  parseIntWithFallback,
  parseOptionalInt,
} from '@/utils/helpers/parse';

import { Config } from './types';

const isProduction = (process.env.NODE_ENV || 'development')
  .toLowerCase()
  .includes('prod');
const autoMigrateToggle = process.env.DB_AUTO_MIGRATE;
const shouldAutoMigrate =
  (autoMigrateToggle === 'true' &&
    (process.env.API_IS_PRIMARY_NODE || 'true') === 'true') ||
  !isProduction;
const sessionMaxAge = parseIntWithFallback(
  process.env.SESSION_MAX_AGE,
  24 * 60 * 60 * 1000,
);
const sessionCleanupLimit = parseIntWithFallback(
  process.env.SESSION_CLEANUP_LIMIT,
  0,
);
const sessionLimitSubquery =
  process.env.SESSION_LIMIT_SUBQUERY === undefined
    ? true
    : process.env.SESSION_LIMIT_SUBQUERY === 'true';
const sessionTtlSeconds = parseOptionalInt(process.env.SESSION_TTL_SECONDS);
const apiBaseUrl = process.env.API_ORIGIN || 'http://localhost:3000/api';

export const config: Config = {
  i18n: {
    translationFilename: process.env.I18N_TRANSLATION_FILENAME || 'messages',
  },
  appPath: process.cwd(),
  apiBaseUrl,
  uiBaseUrl: process.env.FRONTEND_BASE_URL
    ? process.env.FRONTEND_BASE_URL
    : 'http://localhost:3000', // default to local dev
  ssoEnabled: process.env.SSO_ENABLED === 'true',
  mcp: {
    enabled: process.env.MCP_ENABLED === 'true',
    serverName: process.env.MCP_SERVER_NAME || 'hexabot-api',
    serverTitle: process.env.MCP_SERVER_TITLE || 'Hexabot API MCP Server',
    serverVersion: process.env.MCP_SERVER_VERSION || '1.0.0',
    serverDescription:
      process.env.MCP_SERVER_DESCRIPTION ||
      'Manage Hexabot workflows, runs, memory, credentials, actions, and CMS content.',
    serverInstructions:
      process.env.MCP_SERVER_INSTRUCTIONS ||
      'Use these tools to inspect and manage Hexabot API resources. Credential values are never exposed.',
  },
  security: {
    httpsEnabled: process.env.HTTPS_ENABLED === 'true',
    trustProxy: process.env.HTTPS_ENABLED === 'true', // Nginx in use ?
    cors: {
      allRoutes: true,
      headers:
        'content-type,x-xsrf-token,x-csrf-token,authorization,mcp-session-id,last-event-id',
      methods: ['GET', 'PATCH', 'POST', 'DELETE', 'OPTIONS', 'HEAD'],
      allowOrigins: parseCsv(process.env.FRONTEND_ORIGIN, ['*']),
      allowCredentials: true,
    },
    csrf: true,
    csrfExclude: [
      /^\/auth\/local$/, // login
      /^\/auth\/logout$/, // logout
      /^\/mcp$/, // MCP Streamable HTTP endpoint
      /^\/webhook\//, // Any webhook channel
      /^\/user\/reset(\/[^\/]+)?$/, // Reset request / Change password
    ],
  },
  sockets: {
    path: '/socket.io',
    // transports to allow connections to (e.g. ['polling', 'websocket'])
    transports: ['websocket', 'polling'],
    beforeConnect(_handshake: any): boolean {
      // `true` allows the socket to connect.
      // (`false` would reject the connection)
      return true;
    },
    async afterDisconnect(_socket): Promise<void> {
      // By default: do nothing.
      // (but always trigger the callback)
      return;
    },
    serveClient: false,
    pingTimeout: 3000,
    pingInterval: 10_000,
    maxHttpBufferSize: 10e7,
    allowUpgrades: true,
    cookie: {
      name: process.env.SESSION_NAME || 's.sid',
      httpOnly: true,
      secure: process.env.HTTPS_ENABLED === 'true',
      path: '/',
      maxAge: isProduction
        ? 1000 * 60 * 60 * 24 //prod 24h
        : 1000 * 60 * 60, //dev 1h
    },
    // Whether to include response headers in the JWR originated for
    // each socket request (e.g. `io.socket.get()` in the browser)
    // This doesn't affect direct socket.io usage-- only if you're
    // communicating with Sails via the request interpreter
    // (e.g. the sails.io.js browser SDK)
    sendResponseHeaders: true,

    // Whether to include the status code in the JWR originated for
    // each socket request (e.g. `io.socket.get()` in the browser)
    // This doesn't affect direct socket.io usage-- only if you're
    // communicating with Sails via the request interpreter
    // (e.g. the sails.io.js browser SDK)
    sendStatusCode: true,

    // Whether to expose a 'get /__getcookie' route with CORS support
    // that sets a cookie (this is used by the sails.io.js socket client
    // to get access to a 3rd party cookie and to enable sessions).
    grant3rdPartyCookie: true,
    // Admin/frontend origins for Socket.IO connections without a web source.
    // Web widget origins are controlled by each web source's allowed_domains.
    onlyAllowOrigins: parseCsv(process.env.FRONTEND_ORIGIN, []), // ['http://example.com', 'https://example.com'],
  },
  session: {
    secret: process.env.SESSION_SECRET || 'changeme',
    name: process.env.SESSION_NAME || 's.sid',
    cleanupLimit: sessionCleanupLimit,
    limitSubquery: sessionLimitSubquery,
    ttlSeconds: sessionTtlSeconds,
    cookie: {
      maxAge: sessionMaxAge,
    },
  },
  emails: {
    isEnabled: process.env.EMAIL_SMTP_ENABLED === 'true' || false,
    smtp: {
      port: process.env.EMAIL_SMTP_PORT
        ? parseInt(process.env.EMAIL_SMTP_PORT)
        : 25,
      host: process.env.EMAIL_SMTP_HOST || 'localhost',
      ignoreTLS: false,
      secure: process.env.EMAIL_SMTP_SECURE === 'true' || false,
      auth: {
        user: process.env.EMAIL_SMTP_USER || '',
        pass: process.env.EMAIL_SMTP_PASS || '',
      },
    },
    from: process.env.EMAIL_SMTP_FROM || 'noreply@example.com',
  },
  parameters: {
    uploadDir: join(process.cwd(), process.env.UPLOAD_DIR || '/uploads'),
    avatarDir: join(
      process.cwd(),
      process.env.UPLOAD_DIR || '/uploads',
      '/avatars',
    ),
    storageMode: (process.env.STORAGE_MODE as 'disk' | 'memory') || 'disk',
    maxUploadSize: process.env.UPLOAD_MAX_SIZE_IN_BYTES
      ? Number(process.env.UPLOAD_MAX_SIZE_IN_BYTES)
      : 50 * 1024 * 1024, // 50 MB in bytes
    appName: 'Hexabot.ai',
    signedUrl: {
      salt: parseInt(process.env.SALT_LENGTH || '12'),
      secret: process.env.SIGNED_URL_SECRET || 'DEFAULT_SIGNED_URL_SECRET',
      expiresIn: (process.env.SIGNED_URL_EXPIRES_IN || '24H') as any,
    },
  },
  pagination: {
    limit: 10,
  },
  chatbot: {
    messages: {
      track_delivery: false,
      track_read: false,
    },
    logEvents: false,
  },
  log: {
    level: 'verbose',
  },
  cache: {
    type: process.env.REDIS_ENABLED === 'true' ? 'redis' : 'memory',
    ttl: parseInt(process.env.CACHE_TTL || '300000'), // Defaulted to 5 minutes
    max: 100, // Maximum number of items in cache (defaults to 100)
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    protocol: process.env.REDIS_SECURE === 'true' ? 'rediss:' : 'redis:',
    user: process.env.REDIS_USER || '',
    password: process.env.REDIS_PASSWORD || '',
  },
  database: {
    type: (process.env.DB_TYPE as Config['database']['type']) || 'sqlite',
    url: process.env.DB_URL,
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : undefined,
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'hexabot',
    sqlitePath: process.env.DB_SQLITE_PATH
      ? join(process.cwd(), process.env.DB_SQLITE_PATH)
      : join(process.cwd(), 'hexabot.sqlite'),
    synchronize:
      process.env.DB_SYNCHRONIZE !== undefined
        ? process.env.DB_SYNCHRONIZE === 'true'
        : !isProduction,
    logging: process.env.DB_LOGGING === 'true',
    schema: process.env.DB_SCHEMA,
    autoMigrate: shouldAutoMigrate,
  },
  env: process.env.NODE_ENV || 'development',
  authentication: {
    jwtOptions: {
      salt: parseInt(process.env.SALT_LENGTH || '12'),
      secret: process.env.JWT_SECRET || 'DEFAULT_AUTH_SECRET',
      expiresIn: (process.env.JWT_EXPIRES_IN || '24h') as any,
    },
  },
  password_reset: {
    jwtOptions: {
      salt: parseInt(process.env.SALT_LENGTH || '12'),
      secret:
        process.env.PASSWORD_RESET_SECRET || 'DEFAULT_PASSWORD_RESET_SECRET',
      expiresIn: (process.env.PASSWORD_RESET_EXPIRES_IN || '1H') as any,
    },
  },
  confirm_account: {
    jwtOptions: {
      salt: parseInt(process.env.SALT_LENGTH || '12'),
      secret:
        process.env.CONFIRM_ACCOUNT_SECRET || 'DEFAULT_CONFIRM_ACCOUNT_SECRET',
      expiresIn: (process.env.CONFIRM_ACCOUNT_EXPIRES_IN || '1H') as any,
    },
  },
  analytics: {
    thresholds: {
      loyalty: 5 * 24 * 60 * 60 * 1000, // 5 days
      returning: 20 * 60 * 60 * 1000, // 20 hours
      retention: 3 * 24 * 60 * 60 * 1000, // 3 days
      retentionReset: 24 * 60 * 60 * 1000, // 1 day
    },
  },
  audit: {
    enabled:
      process.env.AUDIT_LOG_ENABLED === undefined
        ? true
        : process.env.AUDIT_LOG_ENABLED === 'true',
    backend:
      (process.env.AUDIT_LOG_BACKEND as Config['audit']['backend']) ||
      'database',
    failClosed: process.env.AUDIT_LOG_FAIL_CLOSED === 'true',
    serviceName: process.env.AUDIT_LOG_SERVICE_NAME || 'hexabot-api',
    serviceNamespace:
      process.env.AUDIT_LOG_SERVICE_NAMESPACE || '@hexabot-ai/api',
    serviceEnvironmentName:
      process.env.AUDIT_LOG_SERVICE_ENVIRONMENT ||
      process.env.NODE_ENV ||
      'development',
    maskFields: parseCsv(process.env.AUDIT_LOG_MASK_FIELDS, [
      'password',
      'resetToken',
      'reset_token',
      'token',
      'secret',
      'authorization',
      'apiKey',
      'privateKey',
      'value',
    ]),
    opentelemetry: {
      url: process.env.AUDIT_LOG_OTEL_URL,
      hostname: process.env.AUDIT_LOG_OTEL_HOSTNAME,
      headers: parseAuditHeaders(process.env.AUDIT_LOG_OTEL_HEADERS),
      timeoutMillis: parseOptionalInt(
        process.env.AUDIT_LOG_OTEL_TIMEOUT_MILLIS,
      ),
      concurrencyLimit: parseOptionalInt(
        process.env.AUDIT_LOG_OTEL_CONCURRENCY_LIMIT,
      ),
    },
    clickhouse: {
      url: process.env.AUDIT_LOG_CLICKHOUSE_URL,
      databaseName:
        process.env.AUDIT_LOG_CLICKHOUSE_DATABASE || 'hexabot_auditlog',
      logExpired: parseOptionalInt(
        process.env.AUDIT_LOG_CLICKHOUSE_LOG_EXPIRED_DAYS,
      ),
    },
  },
};
