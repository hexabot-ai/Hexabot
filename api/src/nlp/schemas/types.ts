/*
 * Copyright © 2025 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { NlpEntityFull, NlpEntityStub } from './nlp-entity.schema';
import { NlpValueStub } from './nlp-value.schema';

export enum LookupStrategy {
  keywords = 'keywords',
  trait = 'trait',
  free_text = 'free-text',
  pattern = 'pattern',
}

export type Lookup = `${LookupStrategy}`;

export interface NlpSampleEntityValue {
  entity: string; // entity name
  value: string; // entity value
  start?: number;
  end?: number;
}

export type NlpEntityMap<T extends NlpEntityStub> = { [entityId: string]: T };

export type NlpValueMap<T extends NlpValueStub> = { [valueId: string]: T };

export enum NlpSampleState {
  train = 'train',
  test = 'test',
  inbox = 'inbox',
}

export type NlpCacheMap = Record<string, NlpEntityFull>;

export type NlpMetadata = {
  // Required when lookups is "pattern"
  pattern?: string;
  wordBoundary?: boolean;
  removeSpaces?: boolean;
  toLowerCase?: boolean;
  stripDiacritics?: boolean;
};
