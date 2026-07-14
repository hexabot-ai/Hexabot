/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  isTaskDefinition,
  issueMessages,
  validateWorkflow,
  type JsonValue,
  type WorkflowDefinition,
} from '@hexabot-ai/agentic';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';

import { ActionService } from '@/actions/actions.service';
import { ActionName } from '@/actions/types';
import { RuntimeBindingsService } from '@/bindings/runtime-bindings.service';
import {
  isWorkflowResourceRefKind,
  WORKFLOW_RESOURCE_REF_METADATA_KEY,
  type WorkflowActionResourceRefDescriptor,
  type WorkflowResourceRefKind,
  type WorkflowResourceRefMetadata,
  type WorkflowSchemaResourceRefDescriptor,
} from '@/workflow/resource-refs';

export type WorkflowTaskResourceRefs = {
  [kind: string]: string[];
};

export type WorkflowTaskResourceIdMaps = Record<string, Record<string, string>>;

export type WorkflowBindingResourceRefs = WorkflowTaskResourceRefs;

type JsonSchemaResourceNode = {
  [key: string]: unknown;
  $defs?: Record<string, JsonSchemaResourceNode>;
  definitions?: Record<string, JsonSchemaResourceNode>;
  $ref?: string;
  properties?: Record<string, JsonSchemaResourceNode>;
  items?: JsonSchemaResourceNode | JsonSchemaResourceNode[];
  allOf?: JsonSchemaResourceNode[];
  anyOf?: JsonSchemaResourceNode[];
  oneOf?: JsonSchemaResourceNode[];
};

@Injectable()
export class WorkflowTransferDefinitionService {
  constructor(
    private readonly actionService: ActionService,
    private readonly runtimeBindingsService: RuntimeBindingsService,
  ) {}

  parseWithLocalCatalog(definitionYml: string): WorkflowDefinition {
    const validation = validateWorkflow(definitionYml, {
      bindingKinds: this.runtimeBindingsService.getRegistry(),
      actions: Object.fromEntries(
        Object.entries(this.actionService.getRegistry()).map(
          ([actionName, action]) => [
            actionName,
            { supportedBindings: action.supportedBindings ?? [] },
          ],
        ),
      ),
    });

    if (!validation.success) {
      throw new BadRequestException(
        `Invalid workflow YAML: ${issueMessages(validation.issues).join('; ')}`,
      );
    }

    return validation.data;
  }

  collectBindingResourceRefs(
    definition: WorkflowDefinition,
  ): WorkflowBindingResourceRefs {
    const refs = this.createResourceRefSet();
    const bindingKinds = this.runtimeBindingsService.getRegistry();

    for (const def of Object.values(definition.defs ?? {})) {
      if (isTaskDefinition(def)) {
        continue;
      }

      for (const descriptor of this.getBindingResourceRefs(
        bindingKinds,
        def.kind,
      )) {
        this.addLiteralResourceRefs(
          this.getResourceRefSet(refs, descriptor.kind),
          this.getDefinitionValueAtPath(def.settings, descriptor.path),
        );
      }
    }

    return this.toResourceRefs(refs);
  }

  remapBindingResourceRefs(
    definition: WorkflowDefinition,
    idMaps: WorkflowTaskResourceIdMaps,
  ): WorkflowDefinition {
    let didChange = false;
    const bindingKinds = this.runtimeBindingsService.getRegistry();
    const nextDefs = Object.fromEntries(
      Object.entries(definition.defs ?? {}).map(([defName, def]) => {
        if (isTaskDefinition(def)) {
          return [defName, def];
        }

        let nextDef = def;
        for (const descriptor of this.getBindingResourceRefs(
          bindingKinds,
          def.kind,
        )) {
          const result = this.remapDefinitionValueAtPath(
            nextDef.settings,
            descriptor.path,
            idMaps[descriptor.kind] ?? {},
          );

          if (result.didChange) {
            didChange = true;
            nextDef = {
              ...nextDef,
              settings: result.value as Record<string, unknown>,
            };
          }
        }

        return [defName, nextDef];
      }),
    ) as WorkflowDefinition['defs'];

    return didChange
      ? {
          ...definition,
          defs: nextDefs,
        }
      : definition;
  }

  collectTaskResourceRefs(
    definition: WorkflowDefinition,
  ): WorkflowTaskResourceRefs {
    const refs = this.createResourceRefSet();
    const actions = this.actionService.getRegistry();

    for (const def of Object.values(definition.defs ?? {})) {
      if (!isTaskDefinition(def)) {
        continue;
      }

      for (const descriptor of this.getActionResourceRefs(
        actions,
        def.action,
      )) {
        this.addLiteralResourceRefs(
          this.getResourceRefSet(refs, descriptor.kind),
          this.getDefinitionValueAtPath(
            descriptor.source === 'input' ? def.inputs : def.settings,
            descriptor.path,
          ),
        );
      }
    }

    return {
      ...this.toResourceRefs(refs),
    };
  }

  remapTaskResourceRefs(
    definition: WorkflowDefinition,
    idMaps: WorkflowTaskResourceIdMaps,
  ): WorkflowDefinition {
    let didChange = false;
    const actions = this.actionService.getRegistry();
    const nextDefs = Object.fromEntries(
      Object.entries(definition.defs ?? {}).map(([defName, def]) => {
        if (!isTaskDefinition(def)) {
          return [defName, def];
        }

        let nextDef = def;
        for (const descriptor of this.getActionResourceRefs(
          actions,
          def.action,
        )) {
          const sourceKey =
            descriptor.source === 'input' ? 'inputs' : 'settings';
          const result = this.remapDefinitionValueAtPath(
            nextDef[sourceKey],
            descriptor.path,
            idMaps[descriptor.kind] ?? {},
          );

          if (result.didChange) {
            didChange = true;
            nextDef = {
              ...nextDef,
              [sourceKey]: result.value,
            };
          }
        }

        return [defName, nextDef];
      }),
    ) as WorkflowDefinition['defs'];

    return didChange
      ? {
          ...definition,
          defs: nextDefs,
        }
      : definition;
  }

  private getActionResourceRefs(
    actions: ReturnType<ActionService['getRegistry']>,
    actionName: string,
  ): readonly WorkflowActionResourceRefDescriptor[] {
    const action = actions[actionName as ActionName];
    if (!action) {
      return [];
    }

    return [
      ...this.collectSchemaResourceRefs(action.inputSchema).map(
        (descriptor) => ({
          ...descriptor,
          source: 'input' as const,
        }),
      ),
      ...this.collectSchemaResourceRefs(action.settingSchema).map(
        (descriptor) => ({
          ...descriptor,
          source: 'settings' as const,
        }),
      ),
    ];
  }

  private getBindingResourceRefs(
    bindingKinds: ReturnType<RuntimeBindingsService['getRegistry']>,
    bindingKind: string,
  ): readonly WorkflowSchemaResourceRefDescriptor[] {
    const bindingDefinition = bindingKinds[bindingKind];

    return bindingDefinition
      ? this.collectSchemaResourceRefs(bindingDefinition.schema)
      : [];
  }

  private collectSchemaResourceRefs(
    schema: ZodTypeAny,
  ): readonly WorkflowSchemaResourceRefDescriptor[] {
    const jsonSchema = schema.toJSONSchema({
      target: 'draft-07',
    }) as JsonSchemaResourceNode;
    const refs: WorkflowSchemaResourceRefDescriptor[] = [];

    this.visitJsonSchemaResourceRefs(jsonSchema, [], jsonSchema, refs);

    return this.dedupeSchemaResourceRefs(refs);
  }

  private visitJsonSchemaResourceRefs(
    node: JsonSchemaResourceNode,
    path: string[],
    root: JsonSchemaResourceNode,
    refs: WorkflowSchemaResourceRefDescriptor[],
    seenRefs = new Set<string>(),
  ): void {
    if (path.length > 0) {
      for (const metadata of this.getResourceRefMetadata(node)) {
        refs.push({
          kind: metadata.kind,
          path: path.join('.'),
        });
      }
    }

    if (typeof node.$ref === 'string') {
      if (seenRefs.has(node.$ref)) {
        return;
      }

      const referencedNode = this.resolveJsonSchemaRef(root, node.$ref);
      if (referencedNode) {
        this.visitJsonSchemaResourceRefs(
          referencedNode,
          path,
          root,
          refs,
          new Set([...seenRefs, node.$ref]),
        );
      }

      return;
    }

    for (const [propertyName, propertyNode] of Object.entries(
      node.properties ?? {},
    )) {
      this.visitJsonSchemaResourceRefs(
        propertyNode,
        [...path, propertyName],
        root,
        refs,
        seenRefs,
      );
    }

    const arrayItems = node.items;
    if (Array.isArray(arrayItems)) {
      for (const itemNode of arrayItems) {
        this.visitJsonSchemaResourceRefs(itemNode, path, root, refs, seenRefs);
      }
    } else if (arrayItems) {
      this.visitJsonSchemaResourceRefs(arrayItems, path, root, refs, seenRefs);
    }

    for (const variantKey of ['allOf', 'anyOf', 'oneOf'] as const) {
      for (const variantNode of node[variantKey] ?? []) {
        this.visitJsonSchemaResourceRefs(
          variantNode,
          path,
          root,
          refs,
          seenRefs,
        );
      }
    }
  }

  private getResourceRefMetadata(
    node: JsonSchemaResourceNode,
  ): WorkflowResourceRefMetadata[] {
    const metadata = node[WORKFLOW_RESOURCE_REF_METADATA_KEY];
    const values = Array.isArray(metadata) ? metadata : [metadata];

    return values.flatMap((value) => {
      if (
        typeof value === 'object' &&
        value !== null &&
        'kind' in value &&
        isWorkflowResourceRefKind(value.kind)
      ) {
        return [{ kind: value.kind }];
      }

      return [];
    });
  }

  private resolveJsonSchemaRef(
    root: JsonSchemaResourceNode,
    ref: string,
  ): JsonSchemaResourceNode | null {
    if (!ref.startsWith('#/')) {
      return null;
    }

    return ref
      .slice(2)
      .split('/')
      .map((segment) => {
        return segment.replace(/~1/g, '/').replace(/~0/g, '~');
      })
      .reduce<unknown>((current, segment) => {
        return typeof current === 'object' &&
          current !== null &&
          segment in current
          ? (current as Record<string, unknown>)[segment]
          : null;
      }, root) as JsonSchemaResourceNode | null;
  }

  private dedupeSchemaResourceRefs(
    refs: WorkflowSchemaResourceRefDescriptor[],
  ): WorkflowSchemaResourceRefDescriptor[] {
    const seen = new Set<string>();

    return refs.filter((ref) => {
      const key = `${ref.kind}:${ref.path}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    });
  }

  private createResourceRefSet(): Record<string, Set<string>> {
    return {};
  }

  private getResourceRefSet(
    refs: Record<string, Set<string>>,
    kind: WorkflowResourceRefKind,
  ): Set<string> {
    refs[kind] ??= new Set<string>();

    return refs[kind];
  }

  private toResourceRefs(
    refs: Record<string, Set<string>>,
  ): WorkflowTaskResourceRefs {
    return Object.fromEntries(
      Object.entries(refs).map(([kind, ids]) => [kind, Array.from(ids)]),
    );
  }

  private asRecord(value: unknown): Record<string, JsonValue> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, JsonValue>)
      : null;
  }

  private getDefinitionValueAtPath(
    value: unknown,
    path: string,
  ): JsonValue | undefined {
    let current: unknown = value;
    for (const segment of this.parseResourcePath(path)) {
      const record = this.asRecord(current);
      if (!record || !(segment in record)) {
        return undefined;
      }

      current = record[segment];
    }

    return current as JsonValue | undefined;
  }

  private parseResourcePath(path: string): string[] {
    return path
      .split('.')
      .map((segment) => segment.trim())
      .filter(Boolean);
  }

  private normalizeLiteralResourceId(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();

    return normalized && !normalized.startsWith('=') ? normalized : null;
  }

  private addLiteralResourceRef(refs: Set<string>, value: unknown): void {
    const ref = this.normalizeLiteralResourceId(value);
    if (ref) {
      refs.add(ref);
    }
  }

  private addLiteralResourceRefs(refs: Set<string>, value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) {
        this.addLiteralResourceRef(refs, item);
      }

      return;
    }

    this.addLiteralResourceRef(refs, value);
  }

  private remapLiteralResourceValue(
    value: JsonValue | undefined,
    idMap: Record<string, string>,
  ): JsonValue | undefined {
    const ref = this.normalizeLiteralResourceId(value);

    return ref ? (idMap[ref] ?? value) : value;
  }

  private remapLiteralResourceRefs(
    value: JsonValue | undefined,
    idMap: Record<string, string>,
  ): JsonValue | undefined {
    return Array.isArray(value)
      ? this.remapLiteralResourceArray(value, idMap)
      : this.remapLiteralResourceValue(value, idMap);
  }

  private remapLiteralResourceArray(
    value: JsonValue | undefined,
    idMap: Record<string, string>,
  ): JsonValue | undefined {
    if (!Array.isArray(value)) {
      return value;
    }

    let didChange = false;
    const nextValue: JsonValue[] = value.map((item) => {
      const nextItem = this.remapLiteralResourceValue(item, idMap) ?? item;
      if (nextItem !== item) {
        didChange = true;
      }

      return nextItem;
    });

    return didChange ? nextValue : value;
  }

  private remapDefinitionValueAtPath(
    value: unknown,
    path: string,
    idMap: Record<string, string>,
  ): { value: JsonValue | undefined; didChange: boolean } {
    return this.remapDefinitionPathSegments(
      value,
      this.parseResourcePath(path),
      idMap,
    );
  }

  private remapDefinitionPathSegments(
    value: unknown,
    segments: string[],
    idMap: Record<string, string>,
  ): { value: JsonValue | undefined; didChange: boolean } {
    const [segment, ...tail] = segments;
    if (!segment) {
      return { value: value as JsonValue | undefined, didChange: false };
    }

    const record = this.asRecord(value);
    if (!record || !(segment in record)) {
      return { value: value as JsonValue | undefined, didChange: false };
    }

    if (tail.length === 0) {
      const nextValue = this.remapLiteralResourceRefs(record[segment], idMap);
      if (nextValue === record[segment]) {
        return { value: value as JsonValue | undefined, didChange: false };
      }

      return {
        value: this.withUpdatedPathValue(record, segment, nextValue),
        didChange: true,
      };
    }

    const result = this.remapDefinitionPathSegments(
      record[segment],
      tail,
      idMap,
    );
    if (!result.didChange) {
      return { value: value as JsonValue | undefined, didChange: false };
    }

    return {
      value: this.withUpdatedPathValue(record, segment, result.value),
      didChange: true,
    };
  }

  private withUpdatedPathValue(
    record: Record<string, JsonValue>,
    segment: string,
    value: JsonValue | undefined,
  ): JsonValue {
    const nextRecord: Record<string, JsonValue> = { ...record };
    if (value === undefined) {
      delete nextRecord[segment];
    } else {
      nextRecord[segment] = value;
    }

    return nextRecord;
  }
}
