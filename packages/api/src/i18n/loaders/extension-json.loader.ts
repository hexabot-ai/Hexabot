/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { promises as fs } from 'fs';
import path from 'path';

import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import chokidar, { FSWatcher } from 'chokidar';
import {
  I18N_LOADER_OPTIONS,
  I18nAbstractLoaderOptions,
  I18nJsonLoader,
  I18nLoader,
  I18nTranslation,
} from 'nestjs-i18n';
import pLimit from 'p-limit';
import { Observable, Subject, merge, of, switchMap } from 'rxjs';

import { deepMerge, isPlainObject } from '@/utils/helpers/object';

type ExtensionJsonLoaderOptions = I18nAbstractLoaderOptions & {
  extensionPaths?: string[];
};

type TranslationDict = Record<string, unknown>;
type ParsedExtensionTranslation = {
  lang: string;
  payload: TranslationDict;
};

const EXTENSION_TRANSLATION_FILENAME =
  /^(?<lang>[A-Za-z0-9_-]+)\.translations\.json$/;

@Injectable()
export class ExtensionJsonLoader extends I18nLoader implements OnModuleDestroy {
  private readonly normalizedOptions: ExtensionJsonLoaderOptions;

  private readonly events = new Subject<void>();

  private watcher?: FSWatcher;

  constructor(
    @Inject(I18N_LOADER_OPTIONS)
    options: ExtensionJsonLoaderOptions,
  ) {
    super();
    this.normalizedOptions = {
      ...options,
      path: path.normalize(options.path),
      extensionPaths: (options.extensionPaths ?? []).map((extensionPath) =>
        path.normalize(extensionPath),
      ),
    };

    if (this.normalizedOptions.watch) {
      const watchPaths = [
        this.normalizedOptions.path,
        ...(this.normalizedOptions.extensionPaths ?? []),
      ];
      this.watcher = chokidar
        .watch(watchPaths, { ignoreInitial: true })
        .on('all', () => {
          this.events.next();
        });
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.events.complete();
    if (this.watcher) {
      await this.watcher.close();
    }
  }

  async languages(): Promise<string[] | Observable<string[]>> {
    if (this.normalizedOptions.watch) {
      return merge(
        of(await this.parseLanguages()),
        this.events.pipe(switchMap(() => this.parseLanguages())),
      );
    }

    return this.parseLanguages();
  }

  async load(): Promise<I18nTranslation | Observable<I18nTranslation>> {
    if (this.normalizedOptions.watch) {
      return merge(
        of(await this.parseTranslations()),
        this.events.pipe(switchMap(() => this.parseTranslations())),
      );
    }

    return this.parseTranslations();
  }

  private async parseLanguages(): Promise<string[]> {
    const translations = await this.parseTranslations();

    return Object.keys(translations);
  }

  private async parseTranslations(): Promise<I18nTranslation> {
    const baseTranslations = await this.loadJsonTranslations(
      this.normalizedOptions.path,
      false,
    );
    const translations = deepMerge({}, baseTranslations as TranslationDict);

    if (!this.normalizedOptions.extensionPaths?.length) {
      return translations as I18nTranslation;
    }

    const extensionFiles = await this.resolveExtensionTranslationFiles(
      this.normalizedOptions.extensionPaths,
    );

    for (const extensionFile of extensionFiles) {
      const { lang, payload } = await this.loadExtensionJsonFile(extensionFile);
      const existingLangTranslations = isPlainObject(translations[lang])
        ? (translations[lang] as TranslationDict)
        : {};

      translations[lang] = deepMerge(existingLangTranslations, payload);
    }

    return translations as I18nTranslation;
  }

  private async loadJsonTranslations(
    loadPath: string,
    ignoreErrors: boolean,
  ): Promise<I18nTranslation> {
    try {
      await fs.access(loadPath);
      const loaderOptions: I18nAbstractLoaderOptions = {
        path: loadPath,
        ...(this.normalizedOptions.includeSubfolders !== undefined
          ? { includeSubfolders: this.normalizedOptions.includeSubfolders }
          : {}),
        ...(this.normalizedOptions.filePattern
          ? { filePattern: this.normalizedOptions.filePattern }
          : {}),
      };
      const loader = new I18nJsonLoader(loaderOptions);

      return (await loader.load()) as I18nTranslation;
    } catch (error) {
      if (ignoreErrors) {
        return {};
      }
      throw error;
    }
  }

  private async resolveExtensionTranslationFiles(
    extensionRootPaths: string[],
  ): Promise<string[]> {
    const fsLimit = pLimit(8);
    const i18nDirectories = (
      await Promise.all(
        extensionRootPaths.map((rootPath) =>
          fsLimit(() => this.findI18nDirectories(rootPath, fsLimit)),
        ),
      )
    ).flat();
    const translationFiles = (
      await Promise.all(
        i18nDirectories.map((i18nDir) =>
          fsLimit(() => this.findTranslationFilesInI18nDirectory(i18nDir)),
        ),
      )
    ).flat();

    return Array.from(new Set(translationFiles)).sort((a, b) =>
      a.localeCompare(b),
    );
  }

  private async findI18nDirectories(
    rootPath: string,
    fsLimit: ReturnType<typeof pLimit>,
  ): Promise<string[]> {
    const entries = await fs
      .readdir(rootPath, { withFileTypes: true })
      .catch(() => null);
    if (!entries) {
      return [];
    }
    const nestedResults = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) =>
          fsLimit(async () => {
            const entryPath = path.join(rootPath, entry.name);
            if (entry.name === 'i18n') {
              return [entryPath];
            }

            return this.findI18nDirectories(entryPath, fsLimit);
          }),
        ),
    );

    return nestedResults.flat();
  }

  private async findTranslationFilesInI18nDirectory(
    i18nPath: string,
  ): Promise<string[]> {
    const entries = await fs.readdir(i18nPath, { withFileTypes: true });

    return entries
      .filter(
        (entry) =>
          entry.isFile() && EXTENSION_TRANSLATION_FILENAME.test(entry.name),
      )
      .map((entry) => path.join(i18nPath, entry.name));
  }

  private async loadExtensionJsonFile(
    filePath: string,
  ): Promise<ParsedExtensionTranslation> {
    const fileName = path.basename(filePath);
    const match = fileName.match(EXTENSION_TRANSLATION_FILENAME);
    if (!match?.groups?.lang) {
      throw new Error(
        `Invalid extension i18n filename "${fileName}", expected "<lang>.translations.json"`,
      );
    }

    const fileData = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
    if (!isPlainObject(fileData)) {
      throw new Error(
        `Invalid extension i18n payload in "${filePath}", expected object map`,
      );
    }

    return {
      lang: match.groups.lang,
      payload: fileData,
    };
  }
}
