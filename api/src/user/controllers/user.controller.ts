/*
 * Copyright © 2025 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
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

import { AttachmentService } from '@/attachment/services/attachment.service';
import {
  AttachmentAccess,
  AttachmentCreatedByRef,
  AttachmentResourceRef,
} from '@/attachment/types';
import { config } from '@/config';
import { Roles } from '@/utils/decorators/roles.decorator';
import { BaseController } from '@/utils/generics/base-controller';
import { generateInitialsAvatar, getBotAvatar } from '@/utils/helpers/avatar';
import { PageQueryDto } from '@/utils/pagination/pagination-query.dto';
import { PageQueryPipe } from '@/utils/pagination/pagination-query.pipe';
import { PopulatePipe } from '@/utils/pipes/populate.pipe';
import { SearchFilterPipe } from '@/utils/pipes/search-filter.pipe';
import { TFilterQuery } from '@/utils/types/filter.types';

import { InvitationCreateDto } from '../dto/invitation.dto';
import {
  UserCreateDto,
  UserEditProfileDto,
  UserRequestResetDto,
  UserResetPasswordDto,
  UserUpdateStateAndRolesDto,
} from '../dto/user.dto';
import { User, UserFull, UserPopulate, UserStub } from '../schemas/user.schema';
import { InvitationService } from '../services/invitation.service';
import { PasswordResetService } from '../services/passwordReset.service';
import { PermissionService } from '../services/permission.service';
import { RoleService } from '../services/role.service';
import { UserService } from '../services/user.service';
import { ValidateAccountService } from '../services/validate-account.service';

@Controller('user')
export class ReadOnlyUserController extends BaseController<
  User,
  UserStub,
  UserPopulate,
  UserFull
> {
  constructor(
    protected readonly userService: UserService,
    protected readonly roleService: RoleService,
    protected readonly invitationService: InvitationService,
    protected readonly permissionService: PermissionService,
    protected readonly attachmentService: AttachmentService,
    protected readonly passwordResetService: PasswordResetService,
    protected readonly validateAccountService: ValidateAccountService,
  ) {
    super(userService);
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
  async getAvatar(@Param('id') id: string) {
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
  @Roles('public')
  @Get(['permissions', 'permissions/:id'])
  async permissions(@Req() req: Request) {
    if (!req.user || !('id' in req.user && req.user.id)) {
      throw new UnauthorizedException();
    }

    const currentUser = await this.userService.findOneAndPopulate(
      req.user.id as string,
    );
    const currentPermissions = await this.permissionService.findAndPopulate({
      role: {
        $in: currentUser?.roles.map(({ id }) => id),
      },
    });

    return {
      roles: currentUser?.roles,
      permissions: currentPermissions.map((permission) => {
        if (permission.model) {
          return {
            model: permission.model.name,
            action: permission.action,
            relation: permission.relation,
          };
        }
      }),
    };
  }

  /**
   * Retrieves a paginated list of users based on filters.
   *
   * @param pageQuery - The pagination query object.
   * @param populate - An array of fields to populate.
   * @param filters - Filters applied to the query.
   *
   * @returns A promise that resolves to a paginated list of users.
   */
  @Get()
  async findPage(
    @Query(PageQueryPipe) pageQuery: PageQueryDto<User>,
    @Query(PopulatePipe)
    populate: string[],
    @Query(
      new SearchFilterPipe<User>({
        allowedFields: ['first_name', 'last_name'],
      }),
    )
    filters: TFilterQuery<User>,
  ) {
    return this.canPopulate(populate)
      ? await this.userService.findAndPopulate(filters, pageQuery)
      : await this.userService.find(filters, pageQuery);
  }

  /**
   * Counts the number of users that match the provided filters.
   *
   * @returns A promise that resolves to the count of filtered users.
   */
  @Get('count')
  async filterCount(
    @Query(
      new SearchFilterPipe<User>({
        allowedFields: ['first_name', 'last_name'],
      }),
    )
    filters?: TFilterQuery<User>,
  ) {
    return await this.count(filters);
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
  async findOne(
    @Param('id') id: string,
    @Query(PopulatePipe)
    populate: string[],
  ) {
    const doc = this.canPopulate(populate)
      ? await this.userService.findOneAndPopulate(id)
      : await this.userService.findOne(id);

    if (!doc) {
      this.logger.warn(`Unable to find User by id ${id}`);
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return doc;
  }
}

@Controller('user')
export class ReadWriteUserController extends ReadOnlyUserController {
  /**
   * Creates a new user.
   *
   * @param user - The user object to create.
   *
   * @returns A promise that resolves to the created user.
   */

  @Post()
  async create(@Body() user: UserCreateDto) {
    this.validate({
      dto: user,
      allowedIds: {
        roles: (await this.roleService.findAll())
          .filter((role) => user.roles.includes(role.id))
          .map((role) => role.id),
        avatar: user.avatar
          ? (await this.attachmentService.findOne(user.avatar))?.id
          : null,
      },
    });
    return await this.userService.create(user);
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
    @Param('id') id: string,
    @Body() userUpdate: UserEditProfileDto,
    @UploadedFile() avatarFile?: Express.Multer.File,
  ) {
    if (!(req.user && 'id' in req.user && req.user.id) || req.user.id !== id) {
      throw new ForbiddenException();
    }

    // Upload Avatar if provided
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
   * @param session - The current session of the user performing the update.
   *
   * @returns The updated user data.
   */

  @Patch(':id')
  async updateStateAndRoles(
    @Param('id') id: string,
    @Body() body: UserUpdateStateAndRolesDto,
    @Req() req: Request,
  ) {
    const oldRoles = (await this.userService.findOne(id))?.roles;
    const newRoles = body.roles;
    const { id: adminRoleId } =
      (await this.roleService.findOne({
        name: 'admin',
      })) || {};
    if (id === req.session.passport?.user?.id && body.state === false) {
      throw new ForbiddenException('Your account state is protected');
    }
    if (
      adminRoleId &&
      req.session.passport?.user?.id === id &&
      oldRoles?.includes(adminRoleId) &&
      !newRoles?.includes(adminRoleId)
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

  @Delete(':id')
  @HttpCode(204)
  async deleteOne(@Param('id') id: string) {
    const result = await this.userService.deleteOne(id);
    if (result.deletedCount === 0) {
      this.logger.warn(`Unable to delete User by id ${id}`);
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return result;
  }

  /**
   * Sends an invitation to a user.
   *
   * This method allows an administrator or authorized user to invite someone by
   * creating an invitation entry in the system.
   *
   * @param invitationCreateDto - The invitation details, including recipient information.
   *
   * @returns The created invitation record.
   */

  @Post('invite')
  async invite(@Body() invitationCreateDto: InvitationCreateDto) {
    return await this.invitationService.create(invitationCreateDto);
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
