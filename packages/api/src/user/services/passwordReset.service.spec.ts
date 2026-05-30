/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { User } from '@hexabot-ai/types';
import { NotFoundException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { TestingModule } from '@nestjs/testing';
import { compareSync } from 'bcryptjs';

import { MailerService } from '@/mailer/mailer.service';
import { installLanguageFixturesTypeOrm } from '@/utils/test/fixtures/language';
import { installPermissionFixturesTypeOrm } from '@/utils/test/fixtures/permission';
import { users } from '@/utils/test/fixtures/user';
import { I18nServiceProvider } from '@/utils/test/providers/i18n-service.provider';
import { MailerServiceProvider } from '@/utils/test/providers/mailer-service.provider';
import { buildTestingMocks } from '@/utils/test/utils';

import { UserRepository } from '../repositories/user.repository';

import { PasswordResetService } from './passwordReset.service';
import { UserService } from './user.service';

describe('PasswordResetService (TypeORM)', () => {
  let module: TestingModule;
  let passwordResetService: PasswordResetService;
  let mailerService: MailerService;
  let jwtService: JwtService;
  let userRepository: UserRepository;
  let userService: UserService;
  let adminUser: User | null;

  beforeAll(async () => {
    const testing = await buildTestingMocks({
      autoInjectFrom: ['providers'],
      imports: [JwtModule.register({})],
      providers: [
        PasswordResetService,
        MailerServiceProvider,
        I18nServiceProvider,
      ],
      typeorm: {
        fixtures: [
          installLanguageFixturesTypeOrm,
          installPermissionFixturesTypeOrm,
        ],
      },
    });

    module = testing.module;

    [
      passwordResetService,
      mailerService,
      jwtService,
      userService,
      userRepository,
    ] = await testing.getMocks([
      PasswordResetService,
      MailerService,
      JwtService,
      UserService,
      UserRepository,
    ]);

    adminUser = await userService.findOne({ where: { email: users[0].email } });
  });

  afterEach(jest.clearAllMocks);

  describe('requestReset', () => {
    it('should send an email with a token', async () => {
      const sendMailSpy = jest.spyOn(mailerService, 'sendMail');
      const signSpy = jest.spyOn(passwordResetService, 'sign');
      const promise = passwordResetService.requestReset({
        email: adminUser!.email,
      });
      await expect(promise).resolves.toBeUndefined();

      expect(sendMailSpy).toHaveBeenCalled();
      expect(signSpy).toHaveBeenCalled();
    });

    it('should throw a 404 error', async () => {
      const promise = passwordResetService.requestReset({
        email: 'a@b.ca',
      });
      await expect(promise).rejects.toThrow(NotFoundException);
    });

    it('should update the password and clear the reset token', async () => {
      const spy = jest.spyOn(passwordResetService, 'sign');
      const verifySpy = jest.spyOn(passwordResetService, 'verify');
      const token = jwtService.sign(
        { email: adminUser!.email },
        passwordResetService.jwtSignOptions,
      );
      spy.mockResolvedValue(token);
      await passwordResetService.requestReset({ email: adminUser!.email });

      await expect(
        passwordResetService.reset({ password: 'newPassword' }, token),
      ).resolves.toBeUndefined();
      expect(verifySpy).toHaveBeenCalled();

      const entity = await userRepository.findOneByEmailWithPassword(
        adminUser!.email,
      );
      expect(entity?.resetToken).toBeNull();
      expect(compareSync('newPassword', entity!.password)).toBeTruthy();
    });
  });
});
