/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { existsSync } from 'fs';
import { createRequire } from 'node:module';
import path, { join } from 'path';

import KeyvRedis from '@keyv/redis';
import { CacheModule } from '@nestjs/cache-manager';
import { Module, ModuleMetadata } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheableMemory } from 'cacheable';
import { Keyv } from 'keyv';
import {
  AcceptLanguageResolver,
  I18nOptions,
  QueryResolver,
} from 'nestjs-i18n';

import { ActionsModule } from './actions/actions.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AttachmentModule } from './attachment/attachment.module';
import { AuditModule } from './audit/audit.module';
import { BindingsModule } from './bindings/bindings.module';
import { ChannelModule } from './channel/channel.module';
import { ChatModule } from './chat/chat.module';
import { CmsModule } from './cms/cms.module';
import { config } from './config';
import { TypeormConfigService } from './database/typeorm-config.service';
import { ExtensionModule } from './extension/extension.module';
import extraModules from './extra';
import { HealthService } from './health/health.service';
import { HelperModule } from './helper/helper.module';
import { I18nModule } from './i18n/i18n.module';
import { ExtensionJsonLoader } from './i18n/loaders/extension-json.loader';
import { LicenseModule } from './license/license.module';
import { LoggerModule } from './logger/logger.module';
import { MailerModule } from './mailer/mailer.module';
import { MigrationModule } from './migration/migration.module';
import { SettingModule } from './setting/setting.module';
import { WorkflowTransferModule } from './transfer/workflow-transfer.module';
import { Ability } from './user/guards/ability.guard';
import { AuthenticationGuard } from './user/guards/authentication.guard';
import { UserModule } from './user/user.module';
import { WebsocketModule } from './websocket/websocket.module';
import { WorkflowModule } from './workflow/workflow.module';

// Production "monolith" mode
const compiledFrontendPath = join(__dirname, 'static');
// Development monorepo mode
const workspaceFrontendPath = join(__dirname, '..', '..', 'frontend', 'dist');
const frontendStaticPath = existsSync(compiledFrontendPath)
  ? compiledFrontendPath
  : workspaceFrontendPath;
const requireModule = createRequire(__filename);
const getMcpModuleImports = (): ModuleImports => {
  if (!config.mcp.enabled) {
    return [];
  }

  const { McpApiModule } = requireModule(
    './mcp/mcp-api.module',
  ) as typeof import('./mcp/mcp-api.module');

  return [McpApiModule];
};
// I18N options
const i18nOptions: I18nOptions = {
  fallbackLanguage: 'en',
  loader: ExtensionJsonLoader,
  loaderOptions: {
    path: path.join(__dirname, '/config/i18n/'),
    extensionPaths: [
      path.join(__dirname, '/extensions/actions/'),
      path.join(__dirname, '/extensions/helpers/'),
      path.join(__dirname, '/extensions/channels/'),
    ],
    watch: config.env.toLowerCase() !== 'test',
  },
  resolvers: [
    { use: QueryResolver, options: ['lang'] },
    AcceptLanguageResolver,
  ],
};

type ModuleImports = NonNullable<ModuleMetadata['imports']>;
type ModuleControllers = NonNullable<ModuleMetadata['controllers']>;
type ModuleProviders = NonNullable<ModuleMetadata['providers']>;

export const HEXABOT_MODULE_IMPORTS: ModuleImports = [
  ...(existsSync(frontendStaticPath)
    ? [
        ServeStaticModule.forRoot({
          rootPath: frontendStaticPath,
        }),
      ]
    : []),
  MailerModule,

  CmsModule,
  UserModule,
  SettingModule,
  LicenseModule,
  AttachmentModule,
  AuditModule,
  AnalyticsModule,
  ChatModule,
  ChannelModule,
  ActionsModule,
  BindingsModule,
  WorkflowModule,
  WorkflowTransferModule,
  HelperModule,
  LoggerModule,
  WebsocketModule,
  EventEmitterModule.forRoot({
    global: true,
    // set this to `true` to use wildcards
    wildcard: true,
    // the delimiter used to segment namespaces
    delimiter: ':',
    // set this to `true` if you want to emit the newListener event
    newListener: false,
    // set this to `true` if you want to emit the removeListener event
    removeListener: false,
    // the maximum amount of listeners that can be assigned to an event
    maxListeners: 10,
    // show event name in memory leak message when more than maximum amount of listeners is assigned
    verboseMemoryLeak: false,
    // disable throwing uncaughtException if an error event is emitted and it has no listeners
    ignoreErrors: false,
  }),
  I18nModule.forRoot(i18nOptions),
  ...getMcpModuleImports(),
  CacheModule.registerAsync({
    isGlobal: true,
    useFactory: async () => ({
      // first store is primary, subsequent stores are secondary/fallback
      stores: [
        config.cache.type === 'redis'
          ? new KeyvRedis(
              `${config.cache.protocol}//${config.cache.user}:${config.cache.password}@${config.cache.host}:${config.cache.port}`,
            )
          : new Keyv({
              store: new CacheableMemory({
                ttl: config.cache.ttl,
                lruSize: config.cache.max,
              }),
            }),
      ],
    }),
  }),
  TypeOrmModule.forRootAsync({
    useClass: TypeormConfigService,
  }),
  MigrationModule,
  ExtensionModule,
  ...extraModules,
];

export const HEXABOT_MODULE_CONTROLLERS: ModuleControllers = [AppController];

export const HEXABOT_MODULE_PROVIDERS: ModuleProviders = [
  // AuthenticationGuard must run before Ability: it establishes the identity
  // (API bearer token or session), then Ability authorizes it.
  { provide: APP_GUARD, useClass: AuthenticationGuard },
  { provide: APP_GUARD, useClass: Ability },
  TypeormConfigService,
  HealthService,
  AppService,
];

export const HexabotModule = (
  metadata: ModuleMetadata = {},
): ClassDecorator => {
  const { imports = [], controllers = [], providers = [], ...rest } = metadata;

  return Module({
    ...rest,
    imports: [...HEXABOT_MODULE_IMPORTS, ...imports],
    controllers: [...HEXABOT_MODULE_CONTROLLERS, ...controllers],
    providers: [...HEXABOT_MODULE_PROVIDERS, ...providers],
  });
};

@HexabotModule()
export class HexabotApplicationModule {}
