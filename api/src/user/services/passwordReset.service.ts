/*
 * Copyright © 2025 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService, JwtSignOptions, JwtVerifyOptions } from '@nestjs/jwt';
import { compareSync } from 'bcryptjs';

import { config } from '@/config';
import { I18nService } from '@/i18n/services/i18n.service';
import { LanguageService } from '@/i18n/services/language.service';
import { LoggerService } from '@/logger/logger.service';
import { MailerService } from '@/mailer/mailer.service';
import { jwtExpiresIn, jwtVerifyOptions } from '@/utils/helpers/jwt-options';

import { UserRequestResetDto, UserResetPasswordDto } from '../dto/user.dto';

import { UserService } from './user.service';

@Injectable()
export class PasswordResetService {
  constructor(
    @Inject(JwtService) private readonly jwtService: JwtService,
    private logger: LoggerService,
    private readonly userService: UserService,
    public readonly i18n: I18nService,
    public readonly languageService: LanguageService,
    private readonly mailerService: MailerService,
  ) {}

  public readonly jwtSignOptions: JwtSignOptions = {
    secret: config.password_reset.jwtOptions.secret,
    expiresIn: jwtExpiresIn(config.password_reset.jwtOptions.expiresIn),
    encoding: 'utf-8',
  };

  public readonly jwtVerifyOptions: JwtVerifyOptions = jwtVerifyOptions(
    this.jwtSignOptions,
  );

  /**
   * Handles the request for password reset.
   * Verifies if the user exists, generates a JWT token, and sends a reset email.
   *
   * @param dto - Data transfer object containing the user's email.
   */
  async requestReset(dto: UserRequestResetDto): Promise<void> {
    // verify if the user exists
    const user = await this.userService.findOne({ email: dto.email });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const jwt = await this.sign({ ...dto });

    try {
      const defaultLanguage = await this.languageService.getDefaultLanguage();
      await this.mailerService.sendMail({
        to: dto.email,
        template: 'password_reset.mjml',
        context: {
          appName: config.parameters.appName,
          appUrl: config.uiBaseUrl,
          token: jwt,
          first_name: user.first_name,
          t: (key: string) => this.i18n.t(key, { lang: defaultLanguage.code }),
        },
        subject: this.i18n.t('password_reset_subject'),
      });
    } catch (e) {
      this.logger.error(
        'Could not send email',
        e.message,
        e.stack,
        'PasswordResetService',
      );
      throw new InternalServerErrorException('Could not send email');
    }

    // TODO: hash the token before saving it
    await this.userService.updateOne({ email: dto.email }, { resetToken: jwt });
  }

  /**
   * Resets the user's password if the provided token is valid.
   *
   * @param dto - Data transfer object containing the new password.
   * @param token - JWT token used to verify the reset request.
   */
  async reset(dto: UserResetPasswordDto, token: string): Promise<void> {
    // check validity of token fist
    const payload = await this.verify(token).catch((error) => {
      if (error.name === 'TokenExpiredError')
        throw new UnauthorizedException('Token expired');
      else throw new BadRequestException(error.name, error.message);
    });

    // first step is to check if the token has been used
    const user = await this.userService.findOne({ email: payload.email });

    if (!user?.resetToken || compareSync(user.resetToken, token)) {
      throw new UnauthorizedException('Invalid token');
    }

    // invalidate the token and update password
    await this.userService.updateOne(
      { _id: user.id },
      {
        password: dto.password,
        resetToken: null,
      },
    );
  }

  /**
   * Generates a JWT token for password reset.
   *
   * @param dto - Data transfer object containing the user's email.
   *
   * @returns The signed JWT token.
   */
  async sign(dto: UserRequestResetDto) {
    return await this.jwtService.signAsync(dto, this.jwtSignOptions);
  }

  /**
   * Verifies the validity of a given JWT token.
   *
   * @param token - JWT token to be verified.
   *
   * @returns The decoded payload of the token.
   */
  async verify(token: string): Promise<UserRequestResetDto> {
    return await this.jwtService.verifyAsync(token, this.jwtVerifyOptions);
  }
}
