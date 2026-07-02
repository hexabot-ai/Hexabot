/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

export {
  Action,
  MethodToAction,
  modelIdentities,
  modelIdentitySchema,
  type ModelPermissionsPerRole,
  type PermissionsTree,
  type TModel,
  type TRelation,
} from "./domain";

export {
  userProfileFullSchema,
  userProfileSchema,
  userProfileStubSchema,
  type UserProfile,
  type UserProfileFull,
  type UserProfileStub,
} from "./user-profile";

export {
  userProfileAssignedFullSchema,
  userProfileAssignedSchema,
  userProfileAssignedStubSchema,
  type UserProfileAssigned,
  type UserProfileAssignedFull,
  type UserProfileAssignedStub,
  type UserProvider,
} from "./user-profile-assigned";

export {
  userFullSchema,
  userSchema,
  userStubSchema,
  type User,
  type UserFull,
  type UserStub,
} from "./user";

export {
  roleFullSchema,
  roleSchema,
  roleStubSchema,
  type Role,
  type RoleFull,
  type RoleStub,
} from "./role";

export {
  modelFullSchema,
  modelSchema,
  modelStubSchema,
  type Model,
  type ModelFull,
  type ModelStub,
} from "./model";

export {
  permissionFullSchema,
  permissionSchema,
  permissionStubSchema,
  type Permission,
  type PermissionFull,
  type PermissionStub,
} from "./permission";

export {
  credentialFullSchema,
  credentialSchema,
  credentialStubSchema,
  type Credential,
  type CredentialFull,
  type CredentialStub,
} from "./credential";

export {
  ApiTokenType,
  apiTokenFullSchema,
  apiTokenSchema,
  apiTokenScopeSchema,
  apiTokenStubSchema,
  type ApiToken,
  type ApiTokenFull,
  type ApiTokenScope,
  type ApiTokenStub,
} from "./api-token";

export {
  mcpTokenFullSchema,
  mcpTokenSchema,
  mcpTokenStubSchema,
  type McpToken,
  type McpTokenFull,
  type McpTokenStub,
} from "./mcp-token";
