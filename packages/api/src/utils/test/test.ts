/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

const typeOrmDataSources: DataSource[] = [];
const testingModules: TestingModule[] = [];

export const registerTypeOrmDataSource = (dataSource: DataSource) => {
  typeOrmDataSources.push(dataSource);
};

export const registerTestingModule = (module: TestingModule) => {
  const close = module.close.bind(module);
  let closed = false;

  module.close = async () => {
    if (closed) {
      return;
    }

    closed = true;
    const moduleIndex = testingModules.indexOf(module);

    if (moduleIndex >= 0) {
      testingModules.splice(moduleIndex, 1);
    }

    await close();
  };

  testingModules.push(module);
};

const closeTestingModules = async () => {
  const modules = [...testingModules];

  testingModules.length = 0;
  await Promise.all(modules.map((module) => module.close()));
};
const closeTypeOrmConnections = async () => {
  await Promise.all(
    typeOrmDataSources.map(async (dataSource) => {
      if (dataSource.isInitialized) {
        await dataSource.destroy();
      }
    }),
  );
  typeOrmDataSources.length = 0;
};

export const getLastTypeOrmDataSource = () =>
  typeOrmDataSources[typeOrmDataSources.length - 1];

export const closeTestingResources = async () => {
  try {
    await closeTestingModules();
  } finally {
    await closeTypeOrmConnections();
  }
};
