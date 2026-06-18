/*
 * Copyright © 2025 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { JwtSignOptions, JwtVerifyOptions } from '@nestjs/jwt';

export const jwtExpiresIn = (expiresIn: string): JwtSignOptions['expiresIn'] =>
  expiresIn as JwtSignOptions['expiresIn'];

export const jwtVerifyOptions = (
  options: JwtSignOptions,
): JwtVerifyOptions => ({
  secret: options.secret,
  algorithms: options.algorithm ? [options.algorithm] : undefined,
});
