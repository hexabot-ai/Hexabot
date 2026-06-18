/*
 * Copyright © 2025 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import bodyParser from 'body-parser';
import moduleAlias = require('module-alias');
import { resolveDynamicProviders } from 'nestjs-dynamic-providers';
import passport from 'passport';

moduleAlias.addAliases({
  '@': __dirname,
});

import { AppInstance } from './app.instance';
import { HexabotModule } from './app.module';
import { config } from './config';
import { csrf } from './config/csrf';
import { seedDatabase } from './seeder';
import { SettingService } from './setting/services/setting.service';
import { swagger } from './swagger';
import { getSessionMiddleware } from './utils/constants/session-middleware';
import { ObjectIdPipe } from './utils/pipes/object-id.pipe';
import { RedisIoAdapter } from './websocket/adapters/redis-io.adapter';

async function bootstrap() {
  const isProduction = config.env.toLowerCase().includes('prod');

  await resolveDynamicProviders();
  const app = await NestFactory.create<NestExpressApplication>(HexabotModule, {
    bodyParser: false,
  });

  // Set the global app instance
  AppInstance.setApp(app);

  // Disable Express "X-Powered-By" header for all environments
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  const rawBodyBuffer = (req, res, buf, encoding) => {
    if (buf?.length) {
      req.rawBody = buf.toString(encoding || 'utf8');
    }
  };
  app.use(bodyParser.urlencoded({ verify: rawBodyBuffer, extended: true }));
  app.use(bodyParser.json({ verify: rawBodyBuffer }));

  const settingService = app.get<SettingService>(SettingService);
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
      } else {
        settingService
          .getAllowedOrigins()
          .then((allowedOrigins) => {
            if (allowedOrigins.includes(origin)) {
              callback(null, true);
            } else {
              callback(new Error(`Not allowed by CORS : ${origin}`));
            }
          })
          .catch(callback);
      }
    },
    methods: config.security.cors.methods,
    credentials: config.security.cors.allowCredentials,
    allowedHeaders: config.security.cors.headers.split(','),
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      // forbidNonWhitelisted: true,
    }),
    new ObjectIdPipe(),
  );
  app.use(getSessionMiddleware());
  app.use(passport.initialize());
  app.use(passport.session());

  // CSRF protection
  if (config.security.csrf) {
    app.use(csrf.csrfSynchronisedProtection);
  }

  if (config.cache.type === 'redis') {
    const redisIoAdapter = new RedisIoAdapter(app);
    await redisIoAdapter.connectToRedis();
    app.useWebSocketAdapter(redisIoAdapter);
  }

  if (!isProduction) {
    await seedDatabase(app);
    swagger(app);
  }

  await app.listen(3000);
}

bootstrap();
