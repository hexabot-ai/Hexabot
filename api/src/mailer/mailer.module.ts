/*
 * Copyright © 2025 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import path from 'path';

import { Global, Module } from '@nestjs/common';
import {
  ISendMailOptions,
  MAILER_OPTIONS,
  MailerModule as NestjsMailerModule,
} from '@nestjs-modules/mailer';
import { MjmlAdapter } from '@nestjs-modules/mailer/adapters/mjml.adapter';
import SMTPTransport from 'nodemailer/lib/smtp-transport';

import { config } from '@/config';

import { MailerService } from './mailer.service';

const mailerOptions = {
  transport: new SMTPTransport({
    ...config.emails.smtp,
    logger: true,
    debug: false,
  }),
  template: {
    adapter: new MjmlAdapter(
      'handlebars',
      {
        inlineCssEnabled: false,
      },
      {
        handlebar: {},
      },
    ),
    dir: path.join(process.cwd(), 'dist', 'templates'),
    options: {
      context: {
        appName: config.parameters.appName,
        appUrl: config.uiBaseUrl,
      },
    },
  },
  defaults: { from: config.emails.from },
};

@Global()
@Module({
  imports: [
    ...(config.emails.isEnabled
      ? [NestjsMailerModule.forRoot(mailerOptions)]
      : []),
  ],
  providers: [
    {
      provide: MAILER_OPTIONS,
      useValue: mailerOptions,
    },
    ...(config.emails.isEnabled
      ? [MailerService]
      : [
          {
            provide: MailerService,
            useValue: {
              sendMail(_options: ISendMailOptions) {
                throw new Error('Email Service is not enabled');
              },
            },
          },
        ]),
  ],
  exports: [MailerService],
})
export class MailerModule {}
