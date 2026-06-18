/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BotStatsController } from './controllers/bot-stats.controller';
import { BotStatsRepository } from './repositories/bot-stats.repository';
import { BotStatsModel } from './schemas/bot-stats.schema';
import { BotStatsService } from './services/bot-stats.service';

@Module({
  imports: [MongooseModule.forFeature([BotStatsModel])],
  controllers: [BotStatsController],
  providers: [BotStatsService, BotStatsRepository],
})
export class AnalyticsModule {}
