/*
 * Copyright © 2025 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { SocketPost } from '../decorators/socket-method.decorator';

import { SocketEventMetadataStorage } from './socket-event-metadata.storage';

const createSameNamedSocketHandler = (path: string) => {
  class SameNamedSocketHandler {
    @SocketPost(path)
    async subscribe() {
      return undefined;
    }
  }

  return SameNamedSocketHandler;
};

describe('SocketEventMetadataStorage', () => {
  it('keeps metadata isolated by prototype instead of constructor name', () => {
    const FirstHandler = createSameNamedSocketHandler('/first/');
    const SecondHandler = createSameNamedSocketHandler('/second/');

    const firstMetadata = SocketEventMetadataStorage.getMetadataFor(
      new FirstHandler(),
    );
    const secondMetadata = SocketEventMetadataStorage.getMetadataFor(
      new SecondHandler(),
    );

    expect(firstMetadata.map(({ path }) => path)).toEqual(['/first/']);
    expect(secondMetadata.map(({ path }) => path)).toEqual(['/second/']);
  });
});
