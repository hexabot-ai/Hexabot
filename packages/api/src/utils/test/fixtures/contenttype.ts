/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ContentType, DEFAULT_CONTENT_TYPE_SCHEMA } from '@hexabot-ai/types';
import { DataSource, DeepPartial } from 'typeorm';

import { ContentTypeCreateDto } from '@/cms/dto/contentType.dto';
import { ContentTypeOrmEntity } from '@/cms/entities/content-type.entity';

import { getFixturesWithDefaultValues } from '../defaultValues';
import { FixturesTypeBuilder } from '../types';

type TContentTypeFixtures = FixturesTypeBuilder<
  ContentType,
  ContentTypeCreateDto
>;

export const contentTypeDefaultValues: TContentTypeFixtures['defaultValues'] = {
  schema: DEFAULT_CONTENT_TYPE_SCHEMA,
};

const contentTypes: TContentTypeFixtures['values'][] = [
  {
    name: 'Product',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', title: 'Title' },
        status: { type: 'boolean', title: 'Status' },
        description: { type: 'string', title: 'Description' },
        image: { type: 'file', title: 'Image' },
        subtitle: { type: 'string', title: 'Subtitle' },
      } as any,
    },
  },
  {
    name: 'Restaurant',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', title: 'Title' },
        status: { type: 'boolean', title: 'Status' },
        address: { type: 'string', title: 'Description' },
        image: { type: 'file', title: 'Image' },
      } as any,
    },
  },
  {
    name: 'Store',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', title: 'Title' },
        status: { type: 'boolean', title: 'Status' },
        address: { type: 'string', title: 'Description' },
        image: { type: 'file', title: 'Image' },
      } as any,
    },
  },
];

export const contentTypeFixtures = getFixturesWithDefaultValues<
  TContentTypeFixtures['values']
>({
  fixtures: contentTypes,
  defaultValues: contentTypeDefaultValues,
});

export const contentTypeOrmFixtures: DeepPartial<ContentTypeOrmEntity>[] =
  contentTypeFixtures.map(({ name, schema }) => ({
    name,
    schema,
  }));

export const installContentTypeFixturesTypeOrm = async (
  dataSource: DataSource,
): Promise<void> => {
  const repository = dataSource.getRepository(ContentTypeOrmEntity);
  const count = await repository.count();
  if (count > 0) {
    return;
  }

  const entities = repository.create(contentTypeOrmFixtures);
  await repository.save(entities);
};
