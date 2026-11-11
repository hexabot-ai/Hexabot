/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { SetMetadata } from '@nestjs/common';

import type { TRole } from '@/user/entities/role.entity';

export const Roles = (...roles: TRole[]) => SetMetadata('roles', roles);
