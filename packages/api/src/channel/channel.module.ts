/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { HttpModule } from '@nestjs/axios';
import { forwardRef, Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InjectDynamicProviders } from 'nestjs-dynamic-providers';

import { AttachmentModule } from '@/attachment/attachment.module';
import { ChatModule } from '@/chat/chat.module';
import { CmsModule } from '@/cms/cms.module';
import { UserModule } from '@/user/user.module';
import { extensionNodeModulesGlobs } from '@/utils/helpers/extension-globs';
import { WorkflowOrmEntity } from '@/workflow/entities/workflow.entity';
import { WorkflowModule } from '@/workflow/workflow.module';

import { ChannelController } from './channel.controller';
import { ChannelService } from './channel.service';
import { SourceOrmEntity } from './entities/source.entity';
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
  // Community extensions installed via npm, wherever the package manager
  // placed them (flat install, hoisted workspace root, …)
  ...extensionNodeModulesGlobs('hexabot-channel-*/**/*.channel.js'),
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
  ],
  exports: [ChannelService, SourceService, ChannelRegistry],
})
export class ChannelModule {}
