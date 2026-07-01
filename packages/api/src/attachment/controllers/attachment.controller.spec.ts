/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import fs from 'fs';
import os from 'os';

import type { Attachment } from '@hexabot-ai/types';
import {
  BadRequestException,
  MethodNotAllowedException,
} from '@nestjs/common/exceptions';
import { NotFoundException } from '@nestjs/common/exceptions/not-found.exception';
import { Request } from 'express';

import LocalStorageHelper from '@/extensions/helpers/local-storage/index.helper';
import { HelperService } from '@/helper/helper.service';
import { ModelService } from '@/user/services/model.service';
import { PermissionService } from '@/user/services/permission.service';
import { NOT_FOUND_ID } from '@/utils/constants/mock';
import { IGNORED_TEST_FIELDS } from '@/utils/test/constants';
import {
  attachmentFixtures,
  installAttachmentFixturesTypeOrm,
} from '@/utils/test/fixtures/attachment';
import { installSettingFixturesTypeOrm } from '@/utils/test/fixtures/setting';
import { installUserFixturesTypeOrm } from '@/utils/test/fixtures/user';
import { buildTestingMocks } from '@/utils/test/utils';

import { attachment, attachmentFile } from '../mocks/attachment.mock';
import { AttachmentService } from '../services/attachment.service';
import {
  AttachmentAccess,
  AttachmentCreatedByRef,
  AttachmentResourceRef,
} from '../types';

import { AttachmentController } from './attachment.controller';

describe('AttachmentController', () => {
  let attachmentController: AttachmentController;
  let attachmentService: AttachmentService;
  let attachmentToDelete: Attachment;
  let helperService: HelperService;
  const TEST_USER_ID = '66666666-6666-6666-6666-666666666666';

  beforeAll(async () => {
    const { getMocks } = await buildTestingMocks({
      autoInjectFrom: ['controllers'],
      controllers: [AttachmentController],
      providers: [
        {
          provide: PermissionService,
          useValue: { findOne: jest.fn() },
        },
        {
          provide: ModelService,
          useValue: { findOne: jest.fn() },
        },
      ],
      typeorm: {
        fixtures: [
          installSettingFixturesTypeOrm,
          installUserFixturesTypeOrm,
          installAttachmentFixturesTypeOrm,
        ],
      },
    });
    [attachmentController, attachmentService, helperService] = await getMocks([
      AttachmentController,
      AttachmentService,
      HelperService,
    ]);

    attachmentToDelete = (await attachmentService.findOne({
      where: {
        name: 'store1.jpg',
      },
    }))!;

    helperService.register(new LocalStorageHelper());
  });
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('findPage', () => {
    it('should forward TypeORM options to the service', async () => {
      const findSpy = jest.spyOn(attachmentService, 'find');
      const name = attachmentFixtures[0].name;
      const options = {
        where: { name },
        take: 5,
        skip: 0,
      };
      const result = await attachmentController.findAttachments([], options);

      expect(findSpy).toHaveBeenCalledWith(options);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name,
        type: attachmentFixtures[0].type,
        resourceRef: attachmentFixtures[0].resourceRef,
        access: attachmentFixtures[0].access,
      });
    });
  });

  describe('Upload', () => {
    it('should throw BadRequestException if no file is selected to be uploaded', async () => {
      const promiseResult = attachmentController.uploadFile(
        {
          file: [],
        },
        {} as Request,
        { resourceRef: AttachmentResourceRef.MessageAttachment },
      );
      await expect(promiseResult).rejects.toThrow(
        new BadRequestException('No file was selected'),
      );
    });

    it('should upload attachment', async () => {
      jest.spyOn(fs.promises, 'writeFile').mockResolvedValue();

      jest.spyOn(attachmentService, 'create');
      const result = await attachmentController.uploadFile(
        {
          file: [attachmentFile],
        },
        {
          session: { passport: { user: { id: TEST_USER_ID } } },
        } as unknown as Request,
        { resourceRef: AttachmentResourceRef.MessageAttachment },
      );
      const [name] = attachmentFile.filename.split('.');
      expect(attachmentService.create).toHaveBeenCalledWith({
        size: attachmentFile.size,
        type: attachmentFile.mimetype,
        name: attachmentFile.originalname,
        location: expect.stringMatching(new RegExp(`^/${name}`)),
        resourceRef: AttachmentResourceRef.MessageAttachment,
        access: AttachmentAccess.Public,
        createdByRef: AttachmentCreatedByRef.User,
        createdBy: TEST_USER_ID,
      });
      expect(result).toEqualPayload(
        [
          {
            ...attachment,
            resourceRef: AttachmentResourceRef.MessageAttachment,
            createdByRef: AttachmentCreatedByRef.User,
            createdBy: TEST_USER_ID,
          },
        ],
        [...IGNORED_TEST_FIELDS, 'location', 'url', 'channel'],
      );
    });

    it('should upload attachment when temp dir resolves through symlink aliases', async () => {
      jest.spyOn(os, 'tmpdir').mockReturnValue('/tmp');
      jest.spyOn(fs, 'realpathSync').mockImplementation(((
        filePath: fs.PathLike,
      ) => {
        const value = filePath.toString();

        if (value === '/tmp') {
          return '/private/tmp';
        }
        if (value === '/tmp/uploaded-file') {
          return '/private/tmp/uploaded-file';
        }

        return value;
      }) as typeof fs.realpathSync);
      const copyFileSpy = jest
        .spyOn(fs.promises, 'copyFile')
        .mockResolvedValue();
      const unlinkSpy = jest.spyOn(fs.promises, 'unlink').mockResolvedValue();
      const result = await attachmentController.uploadFile(
        {
          file: [{ ...attachmentFile, path: '/tmp/uploaded-file' }],
        },
        {
          session: { passport: { user: { id: TEST_USER_ID } } },
        } as unknown as Request,
        { resourceRef: AttachmentResourceRef.MessageAttachment },
      );

      expect(copyFileSpy).toHaveBeenCalledWith(
        '/private/tmp/uploaded-file',
        expect.any(String),
      );
      expect(unlinkSpy).toHaveBeenCalledWith('/private/tmp/uploaded-file');
      expect(result).toHaveLength(1);
    });
  });

  describe('Download', () => {
    it(`should throw NotFoundException the id or/and file don't exist`, async () => {
      jest.spyOn(attachmentService, 'findOne');
      const result = attachmentController.download(NOT_FOUND_ID, {});
      expect(attachmentService.findOne).toHaveBeenCalledWith(NOT_FOUND_ID);
      expect(result).rejects.toThrow(
        new NotFoundException('Attachment not found'),
      );
    });

    it('should download the attachment by id', async () => {
      jest.spyOn(attachmentService, 'findOne');
      const storedAttachment = (await attachmentService.findOne({
        where: {
          name: 'store1.jpg',
        },
      }))!;
      const result = await attachmentController.download(storedAttachment.id, {
        filename: storedAttachment.name,
      });

      expect(attachmentService.findOne).toHaveBeenCalledWith(
        storedAttachment.id,
      );
      expect(result?.options).toEqual({
        type: storedAttachment.type,
        disposition: `attachment; filename="${encodeURIComponent(
          storedAttachment.name,
        )}"`,
      });
    });
  });

  describe('deleteOne', () => {
    it('should throw a MethodNotAllowedException when attempting to delete an attachment by id', async () => {
      await expect(
        attachmentController.deleteAttachment(attachmentToDelete.id),
      ).rejects.toThrow(MethodNotAllowedException);
    });
  });
});
