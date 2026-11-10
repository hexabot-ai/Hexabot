/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { MailerService } from '@/mailer/mailer.service';

const mailerMock = {
  sendMail: jest.fn((_options) =>
    Promise.resolve({
      envelope: { from: false, to: [] },
      messageId: '<mock-message-id@hexabot.ai>',
    }),
  ) satisfies MailerService['sendMail'],
};

export const MailerServiceProvider = {
  provide: MailerService,
  useValue: mailerMock,
};
