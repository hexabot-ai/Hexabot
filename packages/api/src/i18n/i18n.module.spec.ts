/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  PARAMTYPES_METADATA,
  SELF_DECLARED_DEPS_METADATA,
} from '@nestjs/common/constants';
import { I18nModule as NativeI18nModule } from 'nestjs-i18n';

import { I18nModule } from './i18n.module';

describe('I18nModule', () => {
  // Nest builds a class from the constructor metadata it finds on it. A copy
  // of the nestjs-i18n parameters drifts: 10.8 added `loaders` and
  // `middleware`, which the copy left undefined, and a request rejected
  // before routing (an invalid CSRF token) then failed with a 500.
  it('injects what the installed nestjs-i18n declares', () => {
    expect(
      Reflect.getOwnMetadata(PARAMTYPES_METADATA, I18nModule),
    ).toBeUndefined();
    expect(Reflect.getMetadata(PARAMTYPES_METADATA, I18nModule)).toBe(
      Reflect.getMetadata(PARAMTYPES_METADATA, NativeI18nModule),
    );
    expect(Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, I18nModule)).toBe(
      Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, NativeI18nModule),
    );
  });
});
