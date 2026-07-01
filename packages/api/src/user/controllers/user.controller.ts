/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { diskStorage, memoryStorage } from 'multer';
import { FindManyOptions, In } from 'typeorm';

import { AttachmentService } from '@/attachment/services/attachment.service';
import {
  AttachmentAccess,
  AttachmentCreatedByRef,
  AttachmentResourceRef,
} from '@/attachment/types';
import { config } from '@/config';
import { RequiresLicenseFeature } from '@/license/decorators/requires-license-feature.decorator';
import { LicenseFeature } from '@/license/types/license-feature.enum';
import { UuidParam } from '@/utils';
import { Roles } from '@/utils/decorators/roles.decorator';
import { BaseOrmController } from '@/utils/generics/base-orm.controller';
import { generateInitialsAvatar, getBotAvatar } from '@/utils/helpers/avatar';
import { PopulatePipe } from '@/utils/pipes/populate.pipe';
import { TypeOrmSearchFilterPipe } from '@/utils/pipes/typeorm-search-filter.pipe';

import {
  UserCreateDto,
  UserEditProfileDto,
  UserRequestResetDto,
  UserResetPasswordDto,
  UserUpdateStateAndRolesDto,
} from '../dto/user.dto';
import { UserOrmEntity } from '../entities/user.entity';
import { PasswordResetService } from '../services/passwordReset.service';
import { PermissionService } from '../services/permission.service';
import { RoleService } from '../services/role.service';
import { UserService } from '../services/user.service';
import { ValidateAccountService } from '../services/validate-account.service';
import { getAuthenticatedUserId } from '../utils/authenticated-user';

@Controller('user')
export class ReadOnlyUserController extends BaseOrmController<UserOrmEntity> {
  constructor(
    protected readonly userService: UserService,
    protected readonly roleService: RoleService,
    protected readonly permissionService: PermissionService,
    protected readonly attachmentService: AttachmentService,
    protected readonly passwordResetService: PasswordResetService,
    protected readonly validateAccountService: ValidateAccountService,
  ) {
    super(userService);
  }

  protected async validateRelations(dto: {
    roles: string[];
    avatar: string | null;
  }): Promise<void> {
    const exceptions: string[] = [];

    if (dto.roles?.length) {
      const availableRoles = await this.roleService.findAll();
      const allowedRoleIds = new Set(availableRoles.map((role) => role.id));
      const invalidRoles = dto.roles.filter(
        (roleId) => !allowedRoleIds.has(roleId),
      );

      if (invalidRoles.length) {
        exceptions.push(
          `roles with ID${invalidRoles.length > 1 ? 's' : ''} '${invalidRoles}' not found`,
        );
      }
    }

    if (dto.avatar) {
      const avatar = await this.attachmentService.findOne(dto.avatar);
      if (!avatar) {
        exceptions.push(`avatar with ID '${dto.avatar}' not found`);
      }
    }

    if (exceptions.length) {
      throw new NotFoundException(exceptions.join('; '));
    }
  }

  /**
   * Retrieves the bot's profile picture.
   *
   * @returns A promise that resolves to the bot's avatar URL.
   */
  @Roles('public')
  @Get('bot/profile_pic')
  async getBotAvatar(@Query('color') color: string) {
    return await getBotAvatar(color);
  }

  /**
   * Retrieves the user's profile picture.
   *
   * @param id - The ID of the user.
   *
   * @returns A promise that resolves to the user's avatar or an avatar generated from initials if not found.
   */
  @Get(':id/profile_pic')
  async getAvatar(@UuidParam('id') id: string) {
    const user = await this.userService.findOneAndPopulate(id);

    if (!user) {
      throw new NotFoundException(`user with ID ${id} not found`);
    }

    try {
      if (!user.avatar) {
        throw new Error('User has no avatar');
      }

      return await this.attachmentService.download(user.avatar);
    } catch (err) {
      this.logger.verbose(
        'User has no avatar, generating initials avatar ...',
        err,
      );

      return await generateInitialsAvatar(user);
    }
  }

  /**
   * Retrieves the current user's roles and permissions.
   *
   * @param req - The request object containing the authenticated user.
   *
   * @returns A promise that resolves to the user's roles and associated permissions.
   */
  @Get('permissions')
  async permissions(@Req() req: Request) {
    if (!req.user || !('id' in req.user && req.user.id)) {
      throw new UnauthorizedException();
    }

    const currentUser = await this.userService.findOneAndPopulate(
      req.user.id as string,
    );
    const roleIds = currentUser?.roles?.map(({ id }) => id) ?? [];
    const currentPermissions = await this.permissionService.findAndPopulate({
      where: { role: { id: In(roleIds) } },
    });

    return {
      roles: currentUser?.roles ?? [],
      permissions: currentPermissions
        .map((permission) => {
          if (permission.model) {
            return {
              model: permission.model.name ?? permission.model.identity,
              action: permission.action,
              relation: permission.relation,
            };
          }

          return undefined;
        })
        .filter(Boolean),
    };
  }

  /**
   * Retrieves a paginated list of users based on filters.
   *
   * @param populate - An array of fields to populate.
   * @param options - Combined filters, pagination, and sorting for the query.
   *
   * @returns A promise that resolves to a paginated list of users.
   */
  @Get()
  @RequiresLicenseFeature(LicenseFeature.UserManagement)
  async findUsers(
    @Query(PopulatePipe)
    populate: string[],
    @Query(
      new TypeOrmSearchFilterPipe<UserOrmEntity>({
        allowedFields: ['firstName', 'lastName'],
      }),
    )
    options: FindManyOptions<UserOrmEntity> = {},
  ) {
    return await this.find(options, populate);
  }

  /**
   * Counts the number of users that match the provided filters.
   *
   * @returns A promise that resolves to the count of filtered users.
   */
  @Get('count')
  async filterCount(
    @Query(
      new TypeOrmSearchFilterPipe<UserOrmEntity>({
        allowedFields: ['firstName', 'lastName'],
      }),
    )
    options: FindManyOptions<UserOrmEntity> = {},
  ) {
    return this.count(options);
  }

  /**
   * Retrieves a single user by ID.
   *
   * @param id - The ID of the user to retrieve.
   * @param populate - An array of fields to populate.
   *
   * @returns A promise that resolves to the user document.
   */
  @Get(':id')
  async findUser(
    @UuidParam('id') id: string,
    @Query(PopulatePipe)
    populate: string[],
  ) {
    return await this.findOne(id, populate);
  }
}

@Controller('user')
export class ReadWriteUserController extends ReadOnlyUserController {
  constructor(
    userService: UserService,
    roleService: RoleService,
    permissionService: PermissionService,
    attachmentService: AttachmentService,
    passwordResetService: PasswordResetService,
    validateAccountService: ValidateAccountService,
  ) {
    super(
      userService,
      roleService,
      permissionService,
      attachmentService,
      passwordResetService,
      validateAccountService,
    );
  }

  /**
   * Creates a new user.
   *
   * @param user - The user object to create.
   *
   * @returns A promise that resolves to the created user.
   */
  @RequiresLicenseFeature(LicenseFeature.UserManagement)
  @Post()
  async create(@Body() user: UserCreateDto) {
    await this.validateRelations({
      roles: user.roles,
      avatar: user.avatar ?? null,
    });

    const createdUser = await this.userService.create({
      ...user,
      state: false,
    });

    try {
      await this.validateAccountService.sendConfirmationEmail({
        email: createdUser.email,
        firstName: createdUser.firstName,
      });
    } catch (error) {
      const errorInfo =
        error instanceof Error ? error : new Error(String(error));

      this.logger.warn(
        `User "${createdUser.id}" created, but account confirmation email could not be sent.`,
        errorInfo.message,
        errorInfo.stack,
        'ReadWriteUserController',
      );
    }

    return createdUser;
  }

  /**
   * Updates an existing user profile.
   *
   * @param req - The request object containing the authenticated user.
   * @param id - The ID of the user to update.
   * @param userUpdate - The user update object.
   *
   * @returns A promise that resolves to the updated user.
   */
  @UseInterceptors(
    FileInterceptor('avatar', {
      limits: {
        fileSize: config.parameters.maxUploadSize,
      },
      storage: (() => {
        if (config.parameters.storageMode === 'memory') {
          return memoryStorage();
        } else {
          return diskStorage({});
        }
      })(),
    }),
  )
  @Patch('edit/:id')
  async updateOne(
    @Req() req: Request,
    @UuidParam('id') id: string,
    @Body() userUpdate: UserEditProfileDto,
    @UploadedFile() avatarFile?: Express.Multer.File,
  ) {
    if (!(req.user && 'id' in req.user && req.user.id) || req.user.id !== id) {
      throw new ForbiddenException();
    }

    const avatar = avatarFile
      ? await this.attachmentService.store(avatarFile, {
          name: avatarFile.originalname,
          size: avatarFile.size,
          type: avatarFile.mimetype,
          resourceRef: AttachmentResourceRef.UserAvatar,
          access: AttachmentAccess.Private,
          createdByRef: AttachmentCreatedByRef.User,
          createdBy: req.user.id,
        })
      : undefined;

    return await this.userService.updateOne(
      req.user.id,
      avatar
        ? {
            ...userUpdate,
            avatar: avatar.id,
          }
        : userUpdate,
    );
  }

  /**
   * Updates the state and roles of a user.
   *
   * This method allows updating the state and roles of a user. It ensures that
   * the current user cannot disable their own account or revoke their admin
   * privileges. If an update attempt fails, it throws a `NotFoundException`.
   *
   * @param id - The ID of the user to update.
   * @param body - The new state and roles of the user.
   * @param req - The current request containing session information.
   *
   * @returns The updated user data.
   */
  @RequiresLicenseFeature(LicenseFeature.UserManagement)
  @Patch(':id')
  async updateStateAndRoles(
    @UuidParam('id') id: string,
    @Body() body: UserUpdateStateAndRolesDto,
    @Req() req: Request,
  ) {
    const existingUser = await this.userService.findOne(id);
    const oldRoleIds = existingUser?.roles ?? [];
    const newRoles = body.roles;
    const adminRole = await this.roleService.findOne({
      where: { name: 'admin' },
    });
    const adminRoleId = adminRole?.id;
    const currentUserId = getAuthenticatedUserId(req);

    if (id === currentUserId && body.state === false) {
      throw new ForbiddenException('Your account state is protected');
    }
    if (
      adminRoleId &&
      currentUserId === id &&
      oldRoleIds.includes(adminRoleId) &&
      newRoles &&
      !newRoles.includes(adminRoleId)
    ) {
      throw new ForbiddenException('Admin privileges are protected');
    }

    const result = await this.userService.updateOne(id, body);
    if (!result) {
      this.logger.warn(`Unable to update User by id ${id}`);
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return result;
  }

  /**
   * Deletes a user by ID.
   *
   * This method deletes a user from the system. If no user with the given ID is found,
   * it throws a `NotFoundException`. A successful deletion returns a `204 No Content` status.
   *
   * @param id - The ID of the user to delete.
   *
   * @returns Nothing (HTTP 204 on success).
   */
  @RequiresLicenseFeature(LicenseFeature.UserManagement)
  @Delete(':id')
  @HttpCode(204)
  async deleteUser(@UuidParam('id') id: string) {
    return await this.deleteOne(id);
  }

  /**
   * Requests a password reset.
   *
   * This method initiates the password reset process for a user. It sends an
   * email or other communication to the user with instructions on how to reset
   * their password.
   *
   * @param body - The email or identifier of the user requesting the password reset.
   *
   * @returns A success message indicating the reset request has been processed.
   */
  @Roles('public')
  @Post('reset')
  async requestReset(@Body() body: UserRequestResetDto) {
    return await this.passwordResetService.requestReset(body);
  }

  /**
   * Resets the password for a user.
   *
   * This method allows a user to reset their password using a provided token. The token
   * must be valid and correspond to a valid reset request.
   *
   * @param body - The new password and any other necessary information.
   * @param token - The reset token provided to the user.
   *
   * @returns A success message indicating the password has been reset.
   */
  @Roles('public')
  @Post('reset/:token')
  async reset(
    @Body() body: UserResetPasswordDto,
    @Param('token') token: string,
  ) {
    return await this.passwordResetService.reset(body, token);
  }

  /**
   * Confirms a user's account.
   *
   * This method verifies a user's account by validating a confirmation token. It marks
   * the account as confirmed and activates it if the token is valid.
   *
   * @param body - The confirmation token to verify the user's account.
   *
   * @returns A success message indicating the account has been confirmed.
   */
  @Roles('public')
  @Post('confirm')
  async confirmAccount(@Body() body: { token: string }) {
    return await this.validateAccountService.confirmAccount(body);
  }
}
