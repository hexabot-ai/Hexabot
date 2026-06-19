/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Inject,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService, JwtSignOptions, JwtVerifyOptions } from '@nestjs/jwt';

import { config } from '@/config';
import { I18nService } from '@/i18n/services/i18n.service';
import { LanguageService } from '@/i18n/services/language.service';
import { LoggerService } from '@/logger/logger.service';
import { MailerService } from '@/mailer/mailer.service';

import { UserCreateDto } from '../dto/user.dto';

import { UserService } from './user.service';

@Injectable()
export class ValidateAccountService {
  public readonly jwtSignOptions: JwtSignOptions = {
    secret: config.confirm_account.jwtOptions.secret,
    expiresIn: config.confirm_account.jwtOptions.expiresIn,
    encoding: 'utf-8',
  };

  constructor(
    @Inject(JwtService) private readonly jwtService: JwtService,
    private readonly userService: UserService,
    private logger: LoggerService,
    private readonly i18n: I18nService,
    private readonly languageService: LanguageService,
    private readonly mailerService: MailerService,
  ) {}

  /**
   * Signs a JWT token containing the user's email.
   *
   * @param dto - Object containing the user's email.
   *
   * @returns A promise that resolves to the signed JWT token.
   */
  async sign(dto: { email: string }) {
    return await this.jwtService.signAsync(dto, this.jwtSignOptions);
  }

  /**
   * Verifies a given JWT token.
   *
   * @param token - The JWT token to be verified.
   *
   * @returns A promise that resolves to an object containing the user's email.
   */
  async verify(token: string): Promise<{ email: string }> {
    return await this.jwtService.verifyAsync(
      token,
      this.jwtSignOptions as JwtVerifyOptions,
    );
  }

  /**
   * Sends an account confirmation email to the user.
   *
   * The email includes a confirmation token and user's first name.
   *
   * @param dto - An object containing the user's email and first name.
   */
  async sendConfirmationEmail(dto: Pick<UserCreateDto, 'email' | 'firstName'>) {
    const confirmationToken = await this.sign({ email: dto.email });

    try {
      const defaultLanguage = await this.languageService.getDefaultLanguage();
      await this.mailerService.sendMail({
        to: dto.email,
        template: 'account_confirmation.mjml',
        context: {
          appName: config.parameters.appName,
          appUrl: config.uiBaseUrl,
          token: confirmationToken,
          first_name: dto.firstName,
          t: (key: string) => this.i18n.t(key, { lang: defaultLanguage.code }),
        },
        subject: this.i18n.t('account_confirmation_subject'),
      });
    } catch (e) {
      this.logger.warn(
        `Could not send account confirmation email to "${dto.email}". User remains inactive until confirmed or enabled manually.`,
        e?.message,
        e?.stack,
        'ValidateAccount',
      );
    }
  }

  /**
   * Confirms a user's account by validating the provided confirmation token.
   *
   * If the token is valid, it updates the user's account state to confirmed.
   * Throws an error if the token is invalid or if any other error occurs.
   *
   * @param dto - An object containing the confirmation token.
   *
   * @returns An empty object if the account is successfully confirmed.
   */
  async confirmAccount(dto: { token: string }) {
    const decodedToken = await this.verify(dto.token).catch((e) => {
      throw new UnauthorizedException(e.message);
    });

    await this.userService.updateOne(
      { where: { email: decodedToken.email } },
      { state: true },
    );
    try {
    } catch (_e) {
      throw new InternalServerErrorException('Could confirm email');
    }

    return {};
  }
}
