/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { forwardRef, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AttachmentModule } from '@/attachment/attachment.module';
import { MailerModule } from '@/mailer/mailer.module';

import { ApiTokenController } from './controllers/api-token.controller';
import { LocalAuthController } from './controllers/auth.controller';
import { CredentialController } from './controllers/credential.controller';
import { ModelController } from './controllers/model.controller';
import { PermissionController } from './controllers/permission.controller';
import { RoleController } from './controllers/role.controller';
import { ReadWriteUserController } from './controllers/user.controller';
import { ApiTokenOrmEntity } from './entities/api-token.entity';
import { CredentialOrmEntity } from './entities/credential.entity';
import { ModelOrmEntity } from './entities/model.entity';
import { PermissionOrmEntity } from './entities/permission.entity';
import { RoleOrmEntity } from './entities/role.entity';
import { UserOrmEntity } from './entities/user.entity';
import { AuthenticationGuard } from './guards/authentication.guard';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { ApiBearerStrategy } from './passport/auth-strategy/api-bearer.strategy';
import { LocalStrategy } from './passport/auth-strategy/local.strategy';
import { AuthSerializer } from './passport/session.serializer';
import { ApiTokenRepository } from './repositories/api-token.repository';
import { CredentialRepository } from './repositories/credential.repository';
import { ModelRepository } from './repositories/model.repository';
import { PermissionRepository } from './repositories/permission.repository';
import { RoleRepository } from './repositories/role.repository';
import { UserRepository } from './repositories/user.repository';
import { ModelSeeder } from './seeds/model.seed';
import { PermissionSeeder } from './seeds/permission.seed';
import { RoleSeeder } from './seeds/role.seed';
import { UserSeeder } from './seeds/user.seed';
import { ApiTokenService } from './services/api-token.service';
import { AuthService } from './services/auth.service';
import { CredentialService } from './services/credential.service';
import { ModelService } from './services/model.service';
import { PasswordResetService } from './services/passwordReset.service';
import { PermissionService } from './services/permission.service';
import { RoleService } from './services/role.service';
import { UserService } from './services/user.service';
import { ValidateAccountService } from './services/validate-account.service';

@Module({
  imports: [
    MailerModule,
    TypeOrmModule.forFeature([
      UserOrmEntity,
      ModelOrmEntity,
      RoleOrmEntity,
      PermissionOrmEntity,
      CredentialOrmEntity,
      ApiTokenOrmEntity,
    ]),
    PassportModule.register({
      session: true,
    }),
    JwtModule,
    forwardRef(() => AttachmentModule),
  ],
  providers: [
    PermissionSeeder,
    PermissionService,
    ModelService,
    UserService,
    RoleService,
    ModelSeeder,
    RoleSeeder,
    UserSeeder,
    UserRepository,
    RoleRepository,
    ModelRepository,
    PermissionRepository,
    CredentialRepository,
    ApiTokenRepository,
    LocalStrategy,
    ApiBearerStrategy,
    AuthService,
    LocalAuthGuard,
    AuthenticationGuard,
    AuthSerializer,
    PasswordResetService,
    ValidateAccountService,
    CredentialService,
    ApiTokenService,
  ],
  controllers: [
    LocalAuthController,
    ApiTokenController,
    ReadWriteUserController,
    RoleController,
    PermissionController,
    ModelController,
    CredentialController,
  ],
  exports: [
    UserService,
    PermissionService,
    ModelService,
    CredentialService,
    ApiTokenService,
  ],
})
export class UserModule {}
