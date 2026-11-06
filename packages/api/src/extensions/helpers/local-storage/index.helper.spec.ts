/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { join } from 'path';

import type { Attachment } from '@hexabot-ai/types';
import { NotFoundException, StreamableFile } from '@nestjs/common';

import { AttachmentAccess, AttachmentResourceRef } from '@/attachment/types';
import { getStreamableFile } from '@/attachment/utilities';
import { config } from '@/config';

import LocalStorageHelper from './index.helper';

jest.mock('@/attachment/utilities', () => {
  const actual = jest.requireActual('@/attachment/utilities');

  return {
    ...actual,
    getStreamableFile: jest.fn(actual.getStreamableFile),
  };
});

const buildAttachment = (
  location: string,
  resourceRef = AttachmentResourceRef.MessageAttachment,
): Attachment =>
  ({
    id: 'attachment-id',
    name: 'file.png',
    type: 'image/png',
    size: 1,
    location,
    resourceRef,
    access: AttachmentAccess.Public,
  }) as Attachment;

describe('LocalStorageHelper', () => {
  const getStreamableFileSpy = jest.mocked(getStreamableFile);
  let helper: LocalStorageHelper;

  beforeEach(() => {
    helper = new LocalStorageHelper();
    getStreamableFileSpy.mockClear();
  });

  it('downloads a file stored under the upload directory', async () => {
    const file = await helper.download(buildAttachment('/file-uuid.png'));

    expect(file).toBeInstanceOf(StreamableFile);
    expect(getStreamableFileSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: join(config.parameters.uploadDir, 'file-uuid.png'),
      }),
    );
  });

  it('downloads an avatar from the avatar directory', async () => {
    await helper.download(
      buildAttachment('/avatar.png', AttachmentResourceRef.UserAvatar),
    );

    expect(getStreamableFileSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: join(config.parameters.avatarDir, 'avatar.png'),
      }),
    );
  });

  it('accepts file names that start with two dots', async () => {
    await helper.download(buildAttachment('..file.png'));

    expect(getStreamableFileSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: join(config.parameters.uploadDir, '..file.png'),
      }),
    );
  });

  it.each([
    ['../../../../etc/passwd'],
    ['/../../../../etc/passwd'],
    ['nested/../../outside.txt'],
    ['..'],
    [''],
  ])('refuses to download the location %p', async (location) => {
    await expect(
      helper.download(buildAttachment(location)),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(getStreamableFileSpy).not.toHaveBeenCalled();
  });

  it('refuses an avatar location that leaves the avatar directory', async () => {
    await expect(
      helper.download(
        buildAttachment(
          '../message-file.png',
          AttachmentResourceRef.UserAvatar,
        ),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to read a location outside the upload directory', async () => {
    const attachment = buildAttachment('../../../../etc/passwd');

    await expect(helper.readAsBuffer(attachment)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(helper.readAsStream(attachment)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
