/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { HttpModule } from '@nestjs/axios';
import {
  forwardRef,
  Global,
  MiddlewareConsumer,
  Module,
  RequestMethod,
} from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { InjectDynamicProviders } from 'nestjs-dynamic-providers';

import { AttachmentModule } from '@/attachment/attachment.module';
import { ChatModule } from '@/chat/chat.module';
import { CmsModule } from '@/cms/cms.module';

import { ChannelController } from './channel.controller';
import { ChannelMiddleware } from './channel.middleware';
import { ChannelService } from './channel.service';
import { WebhookController } from './webhook.controller';

export interface ChannelModuleOptions {
  folder: string;
}

@Global()
@InjectDynamicProviders(
  // Core & under dev channels
  'dist/extensions/**/*.channel.js',
  // Community extensions installed via npm
  'dist/.hexabot/contrib/extensions/channels/**/*.channel.js',
  // Custom extensions under dev
  'dist/.hexabot/custom/extensions/channels/**/*.channel.js',
)
@Module({
  imports: [
    forwardRef(() => ChatModule),
    AttachmentModule,
    CmsModule,
    HttpModule,
    JwtModule,
  ],
  controllers: [WebhookController, ChannelController],
  providers: [ChannelService],
  exports: [ChannelService],
})
export class ChannelModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(ChannelMiddleware)
      .forRoutes({ path: 'webhook/*path', method: RequestMethod.ALL });
  }
}
