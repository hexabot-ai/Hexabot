/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Attachment, Model, Permission } from '@hexabot-ai/types';
import {
  BadRequestException,
  ExecutionContext,
  NotFoundException,
} from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { Request } from 'express';

import { ModelService } from '@/user/services/model.service';
import { PermissionService } from '@/user/services/permission.service';
import { Action } from '@/user/types/action.type';
import { TModel } from '@/user/types/model.type';
import { buildTestingMocks } from '@/utils/test/utils';

import { attachment } from '../mocks/attachment.mock';
import { AttachmentService } from '../services/attachment.service';
import { AttachmentResourceRef } from '../types';

import { AttachmentGuard } from './attachment-ability.guard';

describe('AttachmentGuard', () => {
  let module: TestingModule;
  let guard: AttachmentGuard;
  let permissionService: PermissionService;
  let modelService: ModelService;
  let attachmentService: AttachmentService;

  const modelIdByIdentity: Partial<Record<TModel, string>> = {
    attachment: 'attachment-model-id',
    content: 'content-model-id',
    message: 'message-model-id',
    setting: 'setting-model-id',
    subscriber: 'subscriber-model-id',
    user: 'user-model-id',
  };
  const buildContext = (request: Partial<Request>) =>
    ({
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(request),
      }),
    }) as unknown as ExecutionContext;
  const mockModelFindOne = () =>
    jest.spyOn(modelService, 'findOne').mockImplementation((criteria) => {
      const identity = (criteria as { where?: { identity?: TModel } }).where
        ?.identity;
      const id =
        identity !== undefined ? modelIdByIdentity[identity] : undefined;
      if (!id) {
        return Promise.reject(
          new Error(`Unexpected model identity: ${identity}`),
        );
      }

      return Promise.resolve({
        id,
        identity,
      } as Model);
    });

  beforeEach(async () => {
    const testing = await buildTestingMocks({
      providers: [
        AttachmentGuard,
        {
          provide: PermissionService,
          useValue: { findOne: jest.fn() },
        },
        {
          provide: ModelService,
          useValue: { findOne: jest.fn() },
        },
        {
          provide: AttachmentService,
          useValue: { findOne: jest.fn() },
        },
      ],
    });

    module = testing.module;

    [guard, permissionService, modelService, attachmentService] =
      await testing.getMocks([
        AttachmentGuard,
        PermissionService,
        ModelService,
        AttachmentService,
      ]);
  });

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  describe('canActivate', () => {
    it('should allow GET requests with valid ref', async () => {
      const mockUser = { roles: ['admin-id'] } as any;
      const mockRef = [AttachmentResourceRef.UserAvatar];
      const modelFindOne = mockModelFindOne();
      const permissionFindOne = jest
        .spyOn(permissionService, 'findOne')
        .mockResolvedValue({} as Permission);
      const mockExecutionContext = buildContext({
        query: { where: { resourceRef: mockRef } },
        method: 'GET',
        user: mockUser,
      });
      const result = await guard.canActivate(mockExecutionContext);
      expect(result).toBe(true);

      expect(modelFindOne).toHaveBeenCalledTimes(1);
      expect(modelFindOne).toHaveBeenCalledWith({
        where: { identity: 'user' },
      });

      expect(permissionFindOne).toHaveBeenCalledTimes(1);
      const [{ where }] = permissionFindOne.mock.calls[0] as [
        { where: Record<string, any> },
      ];
      expect(where?.model?.id).toBe(modelIdByIdentity.user);
      expect(where?.action).toBe(Action.READ);
      const roleOperator = (where?.role as any)?.id;
      expect(roleOperator?._type).toBe('in');
      expect(roleOperator?._value).toEqual(mockUser.roles);
    });

    it('should throw BadRequestException for GET requests with invalid ref', async () => {
      const mockExecutionContext = buildContext({
        query: { where: { resourceRef: 'invalid_ref' } },
        method: 'GET',
      });

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should allow GET requests with valid id', async () => {
      const mockUser = { roles: ['admin-id'] } as any;
      const attachmentId = '06662f1d-f396-4ed1-875a-6a118bd7ade5';

      jest.spyOn(attachmentService, 'findOne').mockResolvedValue({
        id: attachmentId,
        resourceRef: AttachmentResourceRef.UserAvatar,
      } as Attachment);
      const modelFindOne = mockModelFindOne();
      const permissionFindOne = jest
        .spyOn(permissionService, 'findOne')
        .mockResolvedValue({} as Permission);
      const mockExecutionContext = buildContext({
        params: { id: attachmentId },
        method: 'GET',
        user: mockUser,
      });
      const result = await guard.canActivate(mockExecutionContext);
      expect(result).toBe(true);

      expect(modelFindOne).toHaveBeenCalledTimes(1);
      expect(modelFindOne).toHaveBeenCalledWith({
        where: { identity: 'user' },
      });

      expect(permissionFindOne).toHaveBeenCalledTimes(1);
      const [{ where }] = permissionFindOne.mock.calls[0] as [
        { where: Record<string, any> },
      ];
      expect(where?.model?.id).toBe(modelIdByIdentity.user);
      expect(where?.action).toBe(Action.READ);
      const roleOperator = (where?.role as any)?.id;
      expect(roleOperator?._type).toBe('in');
      expect(roleOperator?._value).toEqual(mockUser.roles);
    });

    it('should allow POST requests with a valid ref', async () => {
      const mockUser = { roles: ['editor-id'] } as any;
      const modelFindOne = mockModelFindOne();
      const permissionFindOne = jest
        .spyOn(permissionService, 'findOne')
        .mockResolvedValue({} as Permission);
      const mockExecutionContext = buildContext({
        query: { resourceRef: AttachmentResourceRef.MessageAttachment },
        method: 'POST',
        user: mockUser,
      });
      const result = await guard.canActivate(mockExecutionContext);
      expect(result).toBe(true);

      expect(modelFindOne).toHaveBeenCalledTimes(2);
      expect(modelFindOne).toHaveBeenNthCalledWith(1, {
        where: { identity: 'message' },
      });
      expect(modelFindOne).toHaveBeenNthCalledWith(2, {
        where: { identity: 'attachment' },
      });

      expect(permissionFindOne).toHaveBeenCalledTimes(2);
      const permissionWhereCalls = permissionFindOne.mock.calls.map(
        ([args]) => (args as { where: Record<string, any> }).where,
      );
      expect(permissionWhereCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            model: { id: modelIdByIdentity.message },
            action: Action.CREATE,
          }),
          expect.objectContaining({
            model: { id: modelIdByIdentity.attachment },
            action: Action.CREATE,
          }),
        ]),
      );
      permissionWhereCalls.forEach((where) => {
        const roleOperator = (where.role as any).id;
        expect(roleOperator?._type).toBe('in');
        expect(roleOperator?._value).toEqual(mockUser.roles);
      });
    });

    it('should throw NotFoundException for DELETE requests with invalid attachment ID', async () => {
      jest.spyOn(attachmentService, 'findOne').mockResolvedValue(null);

      const mockExecutionContext = buildContext({
        method: 'DELETE',
        params: { id: '86693f56-1c22-4d10-b11e-3b1b0c9a8558' },
      });

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should allow DELETE requests with valid attachment and context', async () => {
      const mockUser = { roles: ['admin-id'] } as any;
      const attachmentWithUuid = {
        ...attachment,
        id: '5a1ea13e-63ef-48da-9afb-7b4d0533b1a0',
      } as Attachment;

      jest
        .spyOn(attachmentService, 'findOne')
        .mockResolvedValue(attachmentWithUuid);

      const modelFindOne = mockModelFindOne();
      const permissionFindOne = jest
        .spyOn(permissionService, 'findOne')
        .mockResolvedValue({} as Permission);
      const mockExecutionContext = buildContext({
        method: 'DELETE',
        params: { id: attachmentWithUuid.id },
        user: mockUser,
      });
      const result = await guard.canActivate(mockExecutionContext);
      expect(result).toBe(true);

      expect(modelFindOne).toHaveBeenCalledTimes(2);
      expect(modelFindOne).toHaveBeenNthCalledWith(1, {
        where: { identity: 'message' },
      });
      expect(modelFindOne).toHaveBeenNthCalledWith(2, {
        where: { identity: 'attachment' },
      });

      expect(permissionFindOne).toHaveBeenCalledTimes(2);
      const permissionWhereCalls = permissionFindOne.mock.calls.map(
        ([args]) => (args as { where: Record<string, any> }).where,
      );
      expect(permissionWhereCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            model: { id: modelIdByIdentity.message },
            action: Action.UPDATE,
          }),
          expect.objectContaining({
            model: { id: modelIdByIdentity.attachment },
            action: Action.DELETE,
          }),
        ]),
      );
      permissionWhereCalls.forEach((where) => {
        const roleOperator = (where.role as any).id;
        expect(roleOperator?._type).toBe('in');
        expect(roleOperator?._value).toEqual(mockUser.roles);
      });
    });

    it('should throw BadRequestException for unsupported HTTP methods', async () => {
      const mockExecutionContext = buildContext({
        method: 'PUT',
      });

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
