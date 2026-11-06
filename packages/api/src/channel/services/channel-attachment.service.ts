/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Attachment } from '@hexabot-ai/types';
import { AttachmentRef } from '@hexabot-ai/types';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { JwtService, JwtSignOptions, JwtVerifyOptions } from '@nestjs/jwt';
import { Request } from 'express';

import { AttachmentOrmEntity } from '@/attachment/entities/attachment.entity';
import { AttachmentService } from '@/attachment/services/attachment.service';
import { config } from '@/config';
import { LoggerService } from '@/logger/logger.service';
import { buildURL } from '@/utils/helpers/URL';

export type HasDownloadAccess = (
  attachment: Attachment,
  req: Request,
) => Promise<boolean> | boolean;

@Injectable()
export class ChannelAttachmentService {
  protected readonly jwtSignOptions: JwtSignOptions = {
    secret: config.parameters.signedUrl.secret,
    expiresIn: config.parameters.signedUrl.expiresIn,
    algorithm: 'HS256',
    encoding: 'utf-8',
  };

  protected readonly jwtVerifyOptions: JwtVerifyOptions = {
    secret: config.parameters.signedUrl.secret,
    algorithms: ['HS256'],
  };

  constructor(
    private readonly attachmentService: AttachmentService,
    private readonly jwtService: JwtService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Generates a signed URL for downloading an attachment.
   *
   * @param sourceId - The source ID.
   * @param attachment - The attachment ID or object to generate a signed URL for.
   * @return A signed URL string for downloading the specified attachment.
   */
  public async getPublicUrl(
    sourceId: string,
    attachment?: AttachmentRef | AttachmentOrmEntity | null,
  ) {
    const fallbackUrl = this.buildNotFoundUrl(sourceId);
    if (!attachment || typeof attachment !== 'object') {
      this.logger.warn(
        'Unable to resolve the attachment public URL.',
        attachment as unknown,
      );

      return fallbackUrl;
    }

    const attachmentId = 'id' in attachment ? attachment.id : undefined;
    const attachmentUrl = 'url' in attachment ? attachment.url : undefined;
    if (typeof attachmentId === 'string' && attachmentId.length > 0) {
      const resource = await this.attachmentService.findOne(attachmentId);

      if (!resource) {
        this.logger.warn('Unable to find attachment sending fallback image');

        return fallbackUrl;
      }

      // The token only names the attachment: `download` reads everything else
      // (location, access, ...) from the database.
      const token = this.jwtService.sign(
        { id: resource.id },
        this.jwtSignOptions,
      );

      return buildURL(
        config.apiBaseUrl,
        `/webhook/${sourceId}/download/${resource.name}?t=${encodeURIComponent(token)}`,
      );
    }

    if (typeof attachmentUrl === 'string' && attachmentUrl.length > 0) {
      // In case the url is external
      return attachmentUrl;
    }

    if ('id' in attachment && !attachment.id) {
      this.logger.warn('Unable to build public URL: Empty attachment ID');

      return fallbackUrl;
    }

    this.logger.warn(
      'Unable to resolve the attachment public URL.',
      attachment as unknown,
    );

    return fallbackUrl;
  }

  /**
   * Downloads an attachment using a signed token.
   *
   * Only the attachment ID is taken from the token. The attachment itself
   * (storage location, access, ...) is read from the database, so a token
   * cannot point the download at another file or grant itself access.
   *
   * @param token The signed token used to verify and locate the attachment.
   * @param req - The HTTP express request object.
   * @param hasDownloadAccess - Callback used to verify the attachment access.
   * @return A streamable file of the attachment.
   */
  public async download(
    token: string,
    req: Request,
    hasDownloadAccess: HasDownloadAccess,
  ): Promise<StreamableFile> {
    try {
      const { id } = this.jwtService.verify<{ id?: unknown }>(
        token,
        this.jwtVerifyOptions,
      );
      if (typeof id !== 'string' || !id) {
        throw new NotFoundException('The token does not name an attachment');
      }

      const attachment: Attachment | null =
        await this.attachmentService.findOne(id);
      if (!attachment) {
        throw new NotFoundException('Attachment not found');
      }

      const canDownload = await hasDownloadAccess(attachment, req);

      if (!canDownload) {
        throw new ForbiddenException(
          'You are not authorized to download the attachment',
        );
      }

      return await this.attachmentService.download(attachment);
    } catch (err) {
      this.logger.error('Failed to download attachment', err);
      throw new NotFoundException('Unable to locate attachment');
    }
  }

  private buildNotFoundUrl(sourceId: string): string {
    return buildURL(config.apiBaseUrl, `/webhook/${sourceId}/not-found`);
  }
}
