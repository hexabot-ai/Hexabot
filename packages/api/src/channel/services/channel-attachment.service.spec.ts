/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Readable } from 'stream';

import {
  ForbiddenException,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

import { AttachmentService } from '@/attachment/services/attachment.service';
import { AttachmentAccess } from '@/attachment/types';
import { config } from '@/config';
import { LoggerService } from '@/logger/logger.service';
import { buildURL } from '@/utils/helpers/URL';

import { ChannelAttachmentService } from './channel-attachment.service';

describe('ChannelAttachmentService', () => {
  let service: ChannelAttachmentService;
  let attachmentService: jest.Mocked<
    Pick<AttachmentService, 'findOne' | 'download'>
  >;
  let jwtService: jest.Mocked<Pick<JwtService, 'sign' | 'verify'>>;
  let logger: jest.Mocked<Pick<LoggerService, 'warn' | 'error'>>;

  beforeEach(() => {
    attachmentService = {
      findOne: jest.fn(),
      download: jest.fn(),
    };
    jwtService = {
      sign: jest.fn(),
      verify: jest.fn(),
    };
    logger = {
      warn: jest.fn(),
      error: jest.fn(),
    };
    service = new ChannelAttachmentService(
      attachmentService as unknown as AttachmentService,
      jwtService as unknown as JwtService,
      logger as unknown as LoggerService,
    );
  });

  it('builds a signed public URL for an internal attachment', async () => {
    const resource = {
      id: 'attachment-id',
      name: 'filename.extension',
      access: AttachmentAccess.Public,
    };
    jwtService.sign.mockReturnValue('signed-token');
    attachmentService.findOne.mockResolvedValue(resource as any);

    const url = await service.getPublicUrl('web', { id: resource.id });

    expect(attachmentService.findOne).toHaveBeenCalledWith(resource.id);
    expect(jwtService.sign).toHaveBeenCalledWith(
      { id: resource.id },
      expect.objectContaining({
        secret: config.parameters.signedUrl.secret,
        expiresIn: config.parameters.signedUrl.expiresIn,
      }),
    );
    expect(url).toBe(
      buildURL(
        config.apiBaseUrl,
        '/webhook/web/download/filename.extension?t=signed-token',
      ),
    );
  });

  it('returns external URLs as-is', async () => {
    const url = await service.getPublicUrl('web', {
      url: 'https://example.com/file.png',
    });

    expect(url).toBe('https://example.com/file.png');
    expect(attachmentService.findOne).not.toHaveBeenCalled();
  });

  it('returns the not-found URL for attachments without an ID', async () => {
    const url = await service.getPublicUrl('web', { id: null });

    expect(url).toBe(buildURL(config.apiBaseUrl, '/webhook/web/not-found'));
    expect(logger.warn).toHaveBeenCalledWith(
      'Unable to build public URL: Empty attachment ID',
    );
  });

  it('returns the not-found URL when an internal attachment cannot be resolved', async () => {
    attachmentService.findOne.mockResolvedValue(null);

    const url = await service.getPublicUrl('web', {
      id: 'missing-attachment',
    });

    expect(url).toBe(buildURL(config.apiBaseUrl, '/webhook/web/not-found'));
    expect(logger.warn).toHaveBeenCalledWith(
      'Unable to find attachment sending fallback image',
    );
  });

  it('returns the not-found URL when attachment payload is undefined', async () => {
    const url = await service.getPublicUrl('web');

    expect(url).toBe(buildURL(config.apiBaseUrl, '/webhook/web/not-found'));
    expect(logger.warn).toHaveBeenCalledWith(
      'Unable to resolve the attachment public URL.',
      undefined,
    );
  });

  it('downloads the stored attachment named by a valid token when access policy allows it', async () => {
    const req = {} as Request;
    const attachment = {
      id: 'attachment-id',
      name: 'filename.extension',
      location: '/filename-uuid.extension',
      access: AttachmentAccess.Public,
    };
    const file = new StreamableFile(Readable.from('content'));
    jwtService.verify.mockReturnValue({
      id: attachment.id,
      exp: 123,
      iat: 122,
    } as any);
    attachmentService.findOne.mockResolvedValue(attachment as any);
    attachmentService.download.mockResolvedValue(file);
    const hasDownloadAccess = jest.fn().mockResolvedValue(true);
    const result = await service.download('token', req, hasDownloadAccess);

    expect(jwtService.verify).toHaveBeenCalledWith(
      'token',
      expect.objectContaining({
        secret: config.parameters.signedUrl.secret,
        algorithms: ['HS256'],
      }),
    );
    expect(attachmentService.findOne).toHaveBeenCalledWith(attachment.id);
    expect(hasDownloadAccess).toHaveBeenCalledWith(attachment, req);
    expect(attachmentService.download).toHaveBeenCalledWith(attachment);
    expect(result).toBe(file);
  });

  it('ignores the attachment fields carried by the token', async () => {
    const req = {} as Request;
    const stored = {
      id: 'attachment-id',
      name: 'filename.extension',
      location: '/filename-uuid.extension',
      access: AttachmentAccess.Private,
    };
    jwtService.verify.mockReturnValue({
      id: stored.id,
      name: 'passwd',
      location: '../../../../etc/passwd',
      access: AttachmentAccess.Public,
      exp: 123,
      iat: 122,
    } as any);
    attachmentService.findOne.mockResolvedValue(stored as any);
    const hasDownloadAccess = jest.fn().mockResolvedValue(true);

    await service.download('token', req, hasDownloadAccess);

    expect(hasDownloadAccess).toHaveBeenCalledWith(stored, req);
    expect(attachmentService.download).toHaveBeenCalledWith(stored);
  });

  it('answers forbidden when the channel refuses access', async () => {
    const req = {} as Request;
    jwtService.verify.mockReturnValue({
      id: 'attachment-id',
      exp: 123,
      iat: 122,
    } as any);
    attachmentService.findOne.mockResolvedValue({
      id: 'attachment-id',
      name: 'filename.extension',
      access: AttachmentAccess.Private,
    } as any);
    const hasDownloadAccess = jest.fn().mockResolvedValue(false);

    await expect(
      service.download('token', req, hasDownloadAccess),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(attachmentService.download).not.toHaveBeenCalled();
  });

  it('answers not found when the attachment no longer exists', async () => {
    const req = {} as Request;
    jwtService.verify.mockReturnValue({ id: 'missing-attachment' } as any);
    attachmentService.findOne.mockResolvedValue(null);
    const hasDownloadAccess = jest.fn().mockResolvedValue(true);

    await expect(
      service.download('token', req, hasDownloadAccess),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(hasDownloadAccess).not.toHaveBeenCalled();
    expect(attachmentService.download).not.toHaveBeenCalled();
  });

  it('answers not found when the token does not name an attachment', async () => {
    const req = {} as Request;
    jwtService.verify.mockReturnValue({
      location: '../../../../etc/passwd',
      access: AttachmentAccess.Public,
    } as any);
    const hasDownloadAccess = jest.fn().mockResolvedValue(true);

    await expect(
      service.download('token', req, hasDownloadAccess),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(attachmentService.findOne).not.toHaveBeenCalled();
    expect(attachmentService.download).not.toHaveBeenCalled();
  });

  it('masks invalid tokens as not found', async () => {
    const req = {} as Request;
    jwtService.verify.mockImplementation(() => {
      throw new Error('invalid token');
    });
    const hasDownloadAccess = jest.fn().mockResolvedValue(true);

    await expect(
      service.download('token', req, hasDownloadAccess),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(attachmentService.download).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to download attachment',
      expect.any(Error),
    );
  });
});
