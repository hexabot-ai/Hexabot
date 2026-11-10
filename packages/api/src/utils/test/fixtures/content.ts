/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Content } from '@hexabot-ai/types';
import { DataSource, DeepPartial } from 'typeorm';

import { ContentCreateDto } from '@/cms/dto/content.dto';
import { ContentTypeOrmEntity } from '@/cms/entities/content-type.entity';
import { ContentOrmEntity } from '@/cms/entities/content.entity';

import { getFixturesWithDefaultValues } from '../defaultValues';
import { FixturesTypeBuilder } from '../types';

import {
  contentTypeOrmFixtures,
  installContentTypeFixturesTypeOrm,
} from './contenttype';

type TContentFixtures = FixturesTypeBuilder<Content, ContentCreateDto>;

export const contentDefaultValues: TContentFixtures['defaultValues'] = {
  status: true,
};

const contents: TContentFixtures['values'][] = [
  {
    title: 'Jean',
    properties: {
      subtitle: 'Jean Droit Taille Normale',
      image: {
        type: 'image',
        payload: {
          url: 'https://images-na.ssl-images-amazon.com/images/I/31DY09uzLDL._SX38_SY50_CR,0,0,38,50_.jpg',
        },
      },
    },
    contentType: '0',
  },
  {
    title: 'Adaptateur',
    properties: {
      subtitle: 'Rankie Adaptateur DisplayPort vers VGA, 1080P Full HD, Noir',
      image: {
        type: 'image',
        payload: {
          url: 'https://images-eu.ssl-images-amazon.com/images/I/41mUnrSGKwL._SL75_.jpg',
        },
      },
    },
    contentType: '0',
    status: false,
  },
  {
    title: 'Sac a Main Femmes Cuir',
    properties: {
      subtitle:
        'BestoU Sac a Main Femmes Cuir Bandoulieres Grand Sacs Porte Cabas (Marron)',
      image: {
        type: 'image',
        payload: {
          url: 'https://images-na.ssl-images-amazon.com/images/I/51AV-LVMMEL._SS36_.jpg',
        },
      },
    },
    contentType: '0',
  },
  {
    title: 'Kitten Heel',
    properties: {
      subtitle: 'Kitten Heel Sling Back',
      image: {
        type: 'image',
        payload: {
          url: 'https://images-na.ssl-images-amazon.com/images/I/31qzy-FAE5L._SS47_.jpg',
        },
      },
    },
    contentType: '0',
  },
  {
    title: 'A Collection of Nameless',
    properties: {
      subtitle:
        'Scenarios - A Collection of Nameless Detective Stories (English Edition)',
      image: {
        type: 'image',
        payload: {
          url: 'https://images-na.ssl-images-amazon.com/images/I/31qzy-FAE5L._SS47_.jpg',
        },
      },
    },
    contentType: '0',
  },
  {
    title: 'Pizza Hut',
    properties: {
      address: '90،, Avenue Taher Ben Ammar, Tunis',
      image: {
        type: 'image',
        payload: {
          url: 'https://www.google.com/maps/uv?hl=fr&pb=!1s0x12fd336848aa1b4d:0xeccb5887cef91140!3m1!7e115!4shttps://lh5.googleusercontent.com/p/AF1QipNEPe0sTSH08WF57AXb1YfmFCDFJPKCUwW0Ervn%3Dw260-h175-n-k-no!5spizza+hut+address+-+Recherche+Google&imagekey=!1e10!2sAF1QipNEPe0sTSH08WF57AXb1YfmFCDFJPKCUwW0Ervn',
        },
      },
    },
    contentType: '1',
  },
  {
    title: 'store 1',
    properties: {
      image: {
        type: 'image',
        payload: {
          id: null,
        },
      },
    },
    contentType: '2',
  },
  {
    title: 'store 2',
    properties: {
      image: {
        type: 'image',
        payload: {
          id: null,
        },
      },
    },
    contentType: '2',
  },
  {
    title: 'store 3',
    properties: {
      image: {
        type: 'image',
        payload: {
          url: 'https://remote.file/image.jpg',
        },
      },
    },
    contentType: '2',
  },
];

export const contentFixtures = getFixturesWithDefaultValues<
  TContentFixtures['values']
>({
  fixtures: contents,
  defaultValues: contentDefaultValues,
});

export const contentOrmFixtures: DeepPartial<ContentOrmEntity>[] =
  contentFixtures.map(({ contentType, ...fixture }) => ({
    ...fixture,
    contentTypeId: contentType,
  }));

export const installContentFixturesTypeOrm = async (
  dataSource: DataSource,
): Promise<void> => {
  const contentRepository = dataSource.getRepository(ContentOrmEntity);
  const existingContents = await contentRepository.count();
  if (existingContents > 0) {
    return;
  }

  await installContentTypeFixturesTypeOrm(dataSource);
  const contentTypeRepository = dataSource.getRepository(ContentTypeOrmEntity);
  const contentTypes = await contentTypeRepository.find({
    order: { name: 'ASC' },
  });
  const entities = contentOrmFixtures.map((fixture) => {
    const {
      contentTypeId: rawContentTypeId,
      contentType: rawContentType,
      ...rest
    } = fixture as DeepPartial<ContentOrmEntity> & {
      contentTypeId?: string;
      contentType?: unknown;
    };
    const entity =
      rawContentTypeId ??
      (typeof rawContentType === 'string' ? rawContentType : undefined);
    const index = Number(entity);
    const fallbackName =
      !Number.isNaN(index) && contentTypeOrmFixtures[index]
        ? contentTypeOrmFixtures[index].name
        : undefined;
    const target = contentTypes.find(
      (type) =>
        type.id === entity ||
        type.name === entity ||
        (fallbackName ? type.name === fallbackName : false),
    );

    if (!target) {
      throw new Error(
        `Unable to resolve content type for fixture contentType reference: ${entity}`,
      );
    }

    return contentRepository.create({
      ...rest,
      contentType: target,
      contentTypeId: target.id,
    });
  });

  await contentRepository.save(entities);
};
