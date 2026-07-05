/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { HttpModule } from '@nestjs/axios';
import { forwardRef, Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InjectDynamicProviders } from 'nestjs-dynamic-providers';

import { AttachmentModule } from '@/attachment/attachment.module';
import { ChatModule } from '@/chat/chat.module';
import { CmsModule } from '@/cms/cms.module';
import { config } from '@/config';
import { UserModule } from '@/user/user.module';
import { WorkflowOrmEntity } from '@/workflow/entities/workflow.entity';
import { WorkflowModule } from '@/workflow/workflow.module';

import { ChannelController } from './channel.controller';
import { ChannelService } from './channel.service';
import { SourceOrmEntity } from './entities/source.entity';
import { WebhookTriggerThrottlerGuard } from './guards/webhook-trigger-throttler.guard';
import { ChannelEventBus } from './lib/channel-event-bus';
import { SourceRepository } from './repositories/source.repository';
import { ChannelAttachmentService } from './services/channel-attachment.service';
import { ChannelDownloadService } from './services/channel-download.service';
import { ChannelRegistry } from './services/channel-registry.service';
import { SourceService } from './services/source.service';
import { SubscriberResolver } from './services/subscriber-resolver.service';
import { SourceController } from './source.controller';
import { WebhookController } from './webhook.controller';

export interface ChannelModuleOptions {
  folder: string;
}

@Global()
@InjectDynamicProviders(
  // Built-in core channels
  'node_modules/@hexabot-ai/api/dist/extensions/channels/**/*.channel.js',
  // Community extensions installed via npm
  'node_modules/hexabot-channel-*/**/*.channel.js',
  // Custom & under dev channels
  'dist/extensions/channels/**/*.channel.js',
)
@Module({
  imports: [
    ChatModule,
    AttachmentModule,
    CmsModule,
    HttpModule,
    JwtModule,
    TypeOrmModule.forFeature([SourceOrmEntity, WorkflowOrmEntity]),
    forwardRef(() => WorkflowModule),
    // WebhookTriggerGuard is instantiated in this module's context (the
    // trigger route lives on WebhookController) and needs CredentialService.
    UserModule,
    // Scoped to this module on purpose: no APP_GUARD binding, so only routes
    // explicitly decorated with the throttler guard are rate-limited.
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: config.security.webhookThrottle.ttlMs,
          limit: config.security.webhookThrottle.limit,
        },
      ],
    }),
  ],
  controllers: [WebhookController, ChannelController, SourceController],
  providers: [
    ChannelEventBus,
    ChannelRegistry,
    ChannelService,
    SourceRepository,
    SourceService,
    ChannelAttachmentService,
    ChannelDownloadService,
    SubscriberResolver,
    WebhookTriggerThrottlerGuard,
  ],
  exports: [ChannelService, SourceService, ChannelRegistry],
})
export class ChannelModule {}
