/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { MemoryDefinition, MemoryRecordFull } from '@hexabot-ai/types';
import pLimit from 'p-limit';
import { ZodSchema, z } from 'zod';

import { cloneObject } from '@/utils/helpers/clone';
import { deepFreeze } from '@/utils/helpers/freeze';
import { deepMerge } from '@/utils/helpers/object';

import { WorkflowRuntimeContext } from '../contexts/workflow-runtime.context';
import {
  MemoryScope,
  MemoryStoreBatchUpdater,
  MemoryStoreData,
  MemoryStoreIdentifier,
  MemoryStoreInstances,
  MemoryStorePersistRecordFn,
  MemoryStoreUpdater,
  MemoryValue,
} from '../types';

import { SchemaInstance } from './schema-instance';

export class MemoryStore {
  private _raw!: MemoryStoreData;

  private _instances!: MemoryStoreInstances;

  public updateRecord!: MemoryStoreUpdater;

  public update!: MemoryStoreBatchUpdater;

  private identifiers!: MemoryStoreIdentifier;

  public definitionCache!: Map<string, MemoryDefinition>;

  private zodSchemaCache!: Map<string, ZodSchema>;

  private context!: WorkflowRuntimeContext;

  public get raw(): Readonly<MemoryStoreData> {
    return this.context.state.memory as Readonly<MemoryStoreData>;
  }

  public get instances(): Readonly<MemoryStoreInstances> {
    return this._instances;
  }

  /**
   * Build a per-slug Zod schema cache from the definition cache.
   * @param definitionCache - Memory definitions keyed by slug.
   * @returns A cache of Zod schemas keyed by slug.
   */
  private buildZodSchemaCache(
    definitionCache: Map<string, MemoryDefinition>,
  ): Map<string, ZodSchema> {
    const cache = new Map<string, ZodSchema>();
    for (const [slug, definition] of definitionCache.entries()) {
      cache.set(
        slug,
        z.fromJSONSchema(
          definition.schema as Parameters<typeof z.fromJSONSchema>[0],
        ),
      );
    }

    return cache;
  }

  /**
   * Get a cached Zod schema for a memory slug or throw if missing.
   * @param slug - Memory definition slug.
   * @returns The cached Zod schema.
   */
  private getZodSchema(slug: string): ZodSchema {
    const cached = this.zodSchemaCache.get(slug);

    if (!cached) {
      throw new Error(
        `Unable to retrieve memory definition schema for "${slug}".`,
      );
    }

    return cached;
  }

  /**
   * Validate and parse a memory value against the slug's schema.
   * @param slug - Memory definition slug.
   * @param value - Raw memory value to validate.
   * @returns Parsed memory value that matches the schema.
   */
  private parseValue(slug: string, value: MemoryValue): MemoryValue {
    const zodSchema = this.getZodSchema(slug);

    return zodSchema.parse(value) as MemoryValue;
  }

  /**
   * Build a Zod input schema for the update_memory tool.
   * @param allowedSlugs - Optional list of memory slugs to include.
   * @returns Zod schema keyed by memory slug, or undefined when empty.
   */
  public buildUpdateMemorySchema(
    allowedSlugs?: string[],
  ): ZodSchema | undefined {
    if (this.definitionCache.size === 0) {
      return undefined;
    }

    const allowedSlugSet = allowedSlugs ? new Set(allowedSlugs) : undefined;
    if (allowedSlugSet && allowedSlugSet.size === 0) {
      return undefined;
    }

    const shape: Record<string, ZodSchema> = {};
    for (const [slug] of this.definitionCache.entries()) {
      if (allowedSlugSet && !allowedSlugSet.has(slug)) {
        continue;
      }

      const schema = this.zodSchemaCache.get(slug);
      if (!schema) {
        continue;
      }
      shape[slug] = schema;
    }

    if (Object.keys(shape).length === 0) {
      return undefined;
    }

    return z.object({
      memory: z.object(shape).partial(),
    });
  }

  /**
   * Build raw store data and schema instances from records and definitions.
   * @param records - Memory records to hydrate the store from.
   * @param definitionCache - Memory definitions keyed by slug.
   * @returns Raw data and schema-backed instances keyed by slug.
   */
  private buildStoreData(
    records: MemoryRecordFull[],
    definitionCache: Map<string, MemoryDefinition>,
  ) {
    const raw: MemoryStoreData = {};
    const instances: MemoryStoreInstances = {};
    for (const record of records) {
      const { definition: recordDefinition, value } = record;
      const cachedDefinition = definitionCache.get(recordDefinition.slug);
      if (!cachedDefinition || cachedDefinition.id !== recordDefinition.id) {
        // Skip records tied to definitions no longer attached to the workflow.
        continue;
      }
      const { slug } = cachedDefinition;

      // We could have multiple records for a given slug; keep the latest one.
      if (Object.prototype.hasOwnProperty.call(raw, slug)) {
        continue;
      }

      const parsedValue = this.parseValue(slug, value);
      const instance = new SchemaInstance(cachedDefinition.schema, parsedValue);
      raw[slug] = instance.data;
      instances[slug] = instance;
    }

    return { raw, instances };
  }

  private commitToContext() {
    const snapshot = cloneObject(this._raw);
    if (process.env.NODE_ENV !== 'production') {
      deepFreeze(snapshot);
    }
    this.context.state.memory = snapshot;
  }

  /**
   * Re-sync the current store snapshot into the workflow context state.
   */
  public syncToContext(): void {
    this.commitToContext();
  }

  /**
   * Create a MemoryStore instance with the provided identifiers and records.
   * @param params - Initialization parameters.
   * @param params.identifiers - Identifiers for owner, workflow, and run.
   * @param params.definitionCache - Memory definitions keyed by slug.
   * @param params.records - Memory records to hydrate the store from.
   * @param params.upsertRecord - Persistence function for memory updates.
   * @returns A new MemoryStore instance.
   */
  public static createStore(
    {
      identifiers,
      definitionCache,
      records,
      upsertRecord,
    }: {
      identifiers: MemoryStoreIdentifier;
      definitionCache: Map<string, MemoryDefinition>;
      records: MemoryRecordFull[];
      upsertRecord: MemoryStorePersistRecordFn;
    },
    context: WorkflowRuntimeContext,
  ): MemoryStore {
    return new MemoryStore(
      {
        identifiers,
        records,
        definitionCache,
        persistFn: upsertRecord,
      },
      context,
    );
  }

  /**
   * Initialize the store with definitions, records, and a persistence callback.
   * Prefer MemoryStore.createStore for initialization.
   * @param params - Initialization parameters.
   * @param params.identifiers - Identifiers for owner, workflow, and run.
   * @param params.records - Memory records to hydrate the store from.
   * @param params.definitionCache - Memory definitions keyed by slug.
   * @param params.persistFn - Persistence function for memory updates.
   */
  constructor(
    {
      identifiers,
      records,
      definitionCache,
      persistFn,
    }: {
      identifiers: MemoryStoreIdentifier;
      records: MemoryRecordFull[];
      definitionCache: Map<string, MemoryDefinition>;
      persistFn: MemoryStorePersistRecordFn;
    },
    context: WorkflowRuntimeContext,
  ) {
    this.context = context;
    this.zodSchemaCache = this.buildZodSchemaCache(definitionCache);
    const { raw, instances } = this.buildStoreData(records, definitionCache);

    // Define non-enumerable properties to keep runtime store fields hidden from serialization.
    Object.defineProperties(this, {
      _raw: {
        value: raw,
        enumerable: false,
        writable: true,
        configurable: false,
      },
      _instances: {
        value: instances,
        enumerable: false,
        writable: true,
        configurable: false,
      },
      updateRecord: {
        value: (slug: string, value: MemoryValue) =>
          this.updateStoreEntry(slug, value, persistFn),
        enumerable: false,
        writable: true,
        configurable: true,
      },
      update: {
        value: (values: MemoryStoreData) =>
          this.updateStoreEntries(values, persistFn),
        enumerable: false,
        writable: true,
        configurable: true,
      },
      identifiers: {
        value: identifiers,
        enumerable: false,
        writable: true,
        configurable: true,
      },
      definitionCache: {
        value: definitionCache,
        enumerable: false,
        writable: false,
        configurable: false,
      },
      zodSchemaCache: {
        value: this.zodSchemaCache,
        enumerable: false,
        writable: false,
        configurable: false,
      },
      context: {
        value: context,
        enumerable: false,
        writable: false,
        configurable: false,
      },
    });

    this.commitToContext();
  }

  /**
   * Persist and update a single memory entry, returning the normalized result.
   * @param slug - Memory definition slug.
   * @param value - New memory value to store.
   * @param persistRecord - Persistence function for memory updates.
   * @returns Normalized update result for the slug.
   */
  private async updateStoreEntry(
    slug: string,
    value: MemoryValue,
    persistRecord: MemoryStorePersistRecordFn,
  ): Promise<MemoryValue> {
    const { ownerId, workflowId, threadId, runId } = this.identifiers;
    if (!ownerId) {
      throw new Error('An owner id is required to update memory.');
    }

    const definition = this.definitionCache.get(slug);
    if (!definition) {
      throw new Error(`Unknown memory definition "${slug}".`);
    }
    if (definition.scope === MemoryScope.workflow && !workflowId) {
      throw new Error(
        'Workflow id is required to update workflow-scoped memory.',
      );
    }

    if (definition.scope === MemoryScope.run && !runId) {
      throw new Error('Run id is required to update run-scoped memory.');
    }
    if (definition.scope === MemoryScope.thread && !threadId) {
      throw new Error('Thread id is required to update thread-scoped memory.');
    }

    const parsedValue = this.parseValue(slug, value);

    await persistRecord({
      definition,
      ownerId,
      workflowId,
      threadId,
      runId,
      value: parsedValue,
    });

    // Update in-memory cache after persistence to keep store state consistent.
    const instance = new SchemaInstance(definition.schema, parsedValue);
    this._raw = { ...this._raw, [slug]: instance.data };
    this._instances = { ...this._instances, [slug]: instance };
    this.commitToContext();

    return parsedValue;
  }

  /**
   * Persist and update multiple memory entries, returning normalized results.
   * @param values - Memory values keyed by slug.
   * @param persistRecord - Persistence function for memory updates.
   * @returns Normalized update results for each entry.
   */
  private async updateStoreEntries(
    values: MemoryStoreData,
    persistRecord: MemoryStorePersistRecordFn,
  ): Promise<MemoryStoreData> {
    const entries = Object.entries(values);
    if (entries.length === 0) {
      return {};
    }

    const dbLimit = pLimit(8);
    const updates = await Promise.all(
      entries.map(([slug, value]) =>
        dbLimit(async () => {
          const currentValue = this.raw[slug];
          const canMerge =
            currentValue !== null &&
            value !== null &&
            typeof currentValue === 'object' &&
            typeof value === 'object' &&
            !Array.isArray(currentValue) &&
            !Array.isArray(value);
          const nextValue = canMerge
            ? deepMerge(cloneObject(currentValue), value)
            : value;
          const parsedValue = await this.updateStoreEntry(
            slug,
            nextValue,
            persistRecord,
          );

          return [slug, parsedValue] as const;
        }),
      ),
    );

    return Object.fromEntries(updates);
  }
}
