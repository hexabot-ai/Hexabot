/*
 * Copyright © 2025 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService, JwtSignOptions, JwtVerifyOptions } from '@nestjs/jwt';

import { config } from '@/config';
import { I18nService } from '@/i18n/services/i18n.service';
import { LanguageService } from '@/i18n/services/language.service';
import { MailerService } from '@/mailer/mailer.service';
import { BaseService } from '@/utils/generics/base-service';
import { jwtExpiresIn, jwtVerifyOptions } from '@/utils/helpers/jwt-options';

import { InvitationCreateDto } from '../dto/invitation.dto';
import { InvitationRepository } from '../repositories/invitation.repository';
import {
  Invitation,
  InvitationFull,
  InvitationPopulate,
} from '../schemas/invitation.schema';

@Injectable()
export class InvitationService extends BaseService<
  Invitation,
  InvitationPopulate,
  InvitationFull
> {
  constructor(
    @Inject(InvitationRepository)
    readonly repository: InvitationRepository,
    @Inject(JwtService) private readonly jwtService: JwtService,
    protected readonly i18n: I18nService,
    public readonly languageService: LanguageService,
    private readonly mailerService: MailerService,
  ) {
    super(repository);
  }

  public readonly jwtSignOptions: JwtSignOptions = {
    secret: config.invitation.jwtOptions.secret,
    expiresIn: jwtExpiresIn(config.invitation.jwtOptions.expiresIn),
    encoding: 'utf-8',
  };

  public readonly jwtVerifyOptions: JwtVerifyOptions = jwtVerifyOptions(
    this.jwtSignOptions,
  );

  /**
   * Creates a new invitation, generates a JWT token, and sends an invitation email to the recipient.
   *
   * @param dto - The data transfer object containing invitation information.
   *
   * @returns The newly created invitation with the generated token.
   */
  async create(dto: InvitationCreateDto): Promise<Invitation> {
    const jwt = await this.sign({ ...dto });
    try {
      const defaultLanguage = await this.languageService.getDefaultLanguage();
      await this.mailerService.sendMail({
        to: dto.email,
        template: 'invitation.mjml',
        context: {
          appName: config.parameters.appName,
          appUrl: config.uiBaseUrl,
          token: jwt,
          // TODO: Which language should we use?
          t: (key: string) => this.i18n.t(key, { lang: defaultLanguage.code }),
        },
        subject: this.i18n.t('invitation_subject'),
      });
    } catch (e) {
      this.logger.error(
        'Could not send email',
        e.message,
        e.stack,
        'InvitationService',
      );
      throw new InternalServerErrorException('Could not send email');
    }
    const newInvitation = await super.create({ ...dto, token: jwt });
    return { ...newInvitation, token: jwt };
  }

  /**
   * Signs the invitation data using the provided JWT options.
   *
   * @param dto - The invitation data to sign.
   *
   * @returns The signed JWT token.
   */
  async sign(dto: InvitationCreateDto) {
    return this.jwtService.signAsync(dto, this.jwtSignOptions);
  }

  /**
   * Verifies the JWT token and returns the decoded invitation data.
   *
   * @param token - The JWT token to verify.
   *
   * @returns The decoded invitation data.
   */
  async verify(token: string): Promise<InvitationCreateDto> {
    return this.jwtService.verifyAsync(token, this.jwtVerifyOptions);
  }

  /**
   * Throws an error when attempting to update an invitation.
   *
   * @throws Always throws an "Illegal Update" error.
   */
  async updateOne(..._: any): Promise<Invitation> {
    throw new Error('Illegal Update');
  }
}
