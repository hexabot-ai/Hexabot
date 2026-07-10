/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { I18nTranslation } from 'nestjs-i18n';

import { ExtensionJsonLoader } from './extension-json.loader';

jest.mock('chokidar', () => ({
  watch: jest.fn(() => ({
    on: jest.fn().mockReturnThis(),
    close: jest.fn(),
  })),
}));

describe('ExtensionJsonLoader', () => {
  const tempDirectories: string[] = [];
  const createTempDir = async () => {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'hexabot-i18n-loader-'),
    );
    tempDirectories.push(dir);

    return dir;
  };
  const writeJsonFile = async (filePath: string, payload: object) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(payload), 'utf8');
  };

  afterEach(async () => {
    await Promise.all(
      tempDirectories
        .splice(0)
        .map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it('merges core translations with action/helper/channel namespaces', async () => {
    const rootDir = await createTempDir();
    const corePath = path.join(rootDir, 'config', 'i18n');
    const actionsPath = path.join(rootDir, 'extensions', 'actions');
    const helpersPath = path.join(rootDir, 'extensions', 'helpers');
    const channelsPath = path.join(rootDir, 'extensions', 'channels');

    await writeJsonFile(path.join(corePath, 'en', 'messages.json'), {
      hello: 'Hello',
    });
    await writeJsonFile(path.join(corePath, 'fr', 'messages.json'), {
      hello: 'Bonjour',
    });
    await writeJsonFile(
      path.join(actionsPath, 'web', 'i18n', 'en.translations.json'),
      {
        http_request: { 'Request URL': 'Request URL' },
      },
    );
    await writeJsonFile(
      path.join(actionsPath, 'web', 'i18n', 'fr.translations.json'),
      {
        http_request: { 'Request URL': 'URL de la requete' },
      },
    );
    await writeJsonFile(
      path.join(actionsPath, 'messaging', 'i18n', 'en.translations.json'),
      {
        send_text_message: {
          'Message to send': 'Message to send',
        },
      },
    );
    await writeJsonFile(
      path.join(helpersPath, 'local-storage', 'i18n', 'en.translations.json'),
      {
        'local-storage': { 'Local Storage': 'Local Storage' },
      },
    );
    await writeJsonFile(
      path.join(channelsPath, 'web', 'i18n', 'en.translations.json'),
      {
        web: { 'Web Channel': 'Web Channel' },
      },
    );

    const loader = new ExtensionJsonLoader({
      path: corePath,
      extensionPaths: [actionsPath, helpersPath, channelsPath],
      watch: false,
    });
    const translations = (await loader.load()) as I18nTranslation;

    expect(translations).toEqual({
      en: {
        messages: { hello: 'Hello' },
        http_request: { 'Request URL': 'Request URL' },
        send_text_message: { 'Message to send': 'Message to send' },
        'local-storage': { 'Local Storage': 'Local Storage' },
        web: { 'Web Channel': 'Web Channel' },
      },
      fr: {
        messages: { hello: 'Bonjour' },
        http_request: { 'Request URL': 'URL de la requete' },
      },
    });
    await expect(loader.languages()).resolves.toEqual(['en', 'fr']);
  });

  it('keeps core translations when extension i18n folders are missing', async () => {
    const rootDir = await createTempDir();
    const corePath = path.join(rootDir, 'config', 'i18n');

    await writeJsonFile(path.join(corePath, 'en', 'messages.json'), {
      hello: 'Hello',
    });

    const loader = new ExtensionJsonLoader({
      path: corePath,
      extensionPaths: [
        path.join(rootDir, 'extensions', 'actions'),
        path.join(rootDir, 'extensions', 'helpers'),
        path.join(rootDir, 'extensions', 'channels'),
      ],
      watch: false,
    });

    await expect(loader.load()).resolves.toEqual({
      en: {
        messages: { hello: 'Hello' },
      },
    });
  });

  it('ignores legacy namespace/lang/translations.json extension files', async () => {
    const rootDir = await createTempDir();
    const corePath = path.join(rootDir, 'config', 'i18n');
    const actionsPath = path.join(rootDir, 'extensions', 'actions');

    await writeJsonFile(path.join(corePath, 'en', 'messages.json'), {
      hello: 'Hello',
    });
    await writeJsonFile(
      path.join(
        actionsPath,
        'web',
        'i18n',
        'http_request',
        'en',
        'translations.json',
      ),
      { 'Request URL': 'Request URL' },
    );

    const loader = new ExtensionJsonLoader({
      path: corePath,
      extensionPaths: [actionsPath],
      watch: false,
    });

    await expect(loader.load()).resolves.toEqual({
      en: {
        messages: { hello: 'Hello' },
      },
    });
  });
});
