/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z, type ZodIssue } from 'zod';

import { type WorkflowValidationIssue } from '../validation-issue';

const TASK_KIND = 'task';

export type BindingKindSchema = z.ZodTypeAny;

export type BindingActionPolicy = 'forbidden' | 'optional' | 'required';

export type BindingValidationActionMetadata = {
  supportedBindings?: readonly string[];
  settingSchema?: z.ZodTypeAny;
};

export type BindingKindDescriptor<
  TSchema extends z.ZodTypeAny = BindingKindSchema,
  TMultiple extends boolean = boolean,
> = {
  schema: TSchema;
  multiple: TMultiple;
  supportedBindings?: readonly string[];
  actionPolicy?: BindingActionPolicy;
};

export type BindingKindSchemas = Record<string, BindingKindDescriptor>;

export type MountedBindingPayload<
  TBindingKind extends BindingKindDescriptor = BindingKindDescriptor,
  TBindingKinds extends BindingKindSchemas = BindingKindSchemas,
> = {
  settings: z.infer<TBindingKind['schema']>;
  action?: string;
  bindings?: InferWorkflowBindings<TBindingKinds>;
};

export type InferMountedBindingValue<
  TBindingKind extends BindingKindDescriptor = BindingKindDescriptor,
  TBindingKinds extends BindingKindSchemas = BindingKindSchemas,
> = TBindingKind['multiple'] extends true
  ? Record<string, MountedBindingPayload<TBindingKind, TBindingKinds>>
  : TBindingKind['multiple'] extends false
    ? MountedBindingPayload<TBindingKind, TBindingKinds>
    :
        | MountedBindingPayload<TBindingKind, TBindingKinds>
        | Record<string, MountedBindingPayload<TBindingKind, TBindingKinds>>;

export type InferWorkflowBindings<
  TBindingKinds extends BindingKindSchemas = BindingKindSchemas,
> = Partial<{
  [K in keyof TBindingKinds & string]: InferMountedBindingValue<
    TBindingKinds[K],
    TBindingKinds
  >;
}>;

export type CompiledTaskBindings = InferWorkflowBindings;

export type TaskBindingReferences = Record<string, string | string[]>;

export type DefLike = {
  kind: string;
  description?: string;
  action?: string;
  settings?: unknown;
  bindings?: TaskBindingReferences;
  [key: string]: unknown;
};

export type BindingAwareWorkflowLike = {
  defs: Record<string, DefLike>;
};

export type ResolvedBindingDef = {
  kind: string;
  payload: MountedBindingPayload;
};

export type ResolvedBindingDefs = Record<string, ResolvedBindingDef>;

export type ValidateAndResolveBindingsOptions = {
  bindingKinds?: BindingKindSchemas;
  actions?: Record<string, BindingValidationActionMetadata>;
};

type BindingValidationResult = {
  issues: WorkflowValidationIssue[];
  resolvedDefs: ResolvedBindingDefs;
};

const resolveValidationOptions = (
  options?: BindingKindSchemas | ValidateAndResolveBindingsOptions,
): ValidateAndResolveBindingsOptions => {
  if (!options) {
    return {};
  }

  if ('bindingKinds' in options || 'actions' in options) {
    return options as ValidateAndResolveBindingsOptions;
  }

  return { bindingKinds: options as BindingKindSchemas };
};
const hasBindingsConfigured = (workflow: BindingAwareWorkflowLike): boolean => {
  const defs = workflow.defs ?? {};
  const hasNonTaskDefs = Object.values(defs).some(
    (definition) => definition.kind !== TASK_KIND,
  );
  const hasNestedBindings = Object.values(defs).some(
    (definition) =>
      definition.bindings && Object.keys(definition.bindings).length > 0,
  );

  return hasNonTaskDefs || hasNestedBindings;
};
const toBindingSettingsIssues = (
  zodIssues: ZodIssue[],
  defName: string,
): WorkflowValidationIssue[] =>
  zodIssues.map((issue) => {
    const path = issue.path.join('.') || '<root>';

    return {
      code: 'binding_settings',
      message: `defs.${defName}.settings.${path}: ${issue.message}`,
      path: [
        'defs',
        defName,
        'settings',
        ...issue.path.filter(
          (segment): segment is string | number =>
            typeof segment === 'string' || typeof segment === 'number',
        ),
      ],
    };
  });
const collectDuplicateReferences = (refs: string[]): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const ref of refs) {
    if (seen.has(ref)) {
      duplicates.add(ref);
      continue;
    }

    seen.add(ref);
  }

  return Array.from(duplicates).sort();
};
const toBindingRefs = (refs: string | string[]): string[] =>
  Array.isArray(refs) ? refs : [refs];
const collectBindingRefs = (
  bindings?: TaskBindingReferences,
): Array<{ kind: string; ref: string }> => {
  if (!bindings) {
    return [];
  }

  const refs: Array<{ kind: string; ref: string }> = [];
  for (const [bindingKind, bindingRefs] of Object.entries(bindings)) {
    for (const ref of toBindingRefs(bindingRefs)) {
      refs.push({ kind: bindingKind, ref });
    }
  }

  return refs;
};
const detectBindingCycles = (
  defs: Record<string, DefLike>,
): WorkflowValidationIssue[] => {
  const issues: WorkflowValidationIssue[] = [];
  const reportedCycles = new Set<string>();
  const states = new Map<string, 'visiting' | 'visited'>();
  const stack: string[] = [];
  const defNames = Object.keys(defs);
  const visit = (defName: string) => {
    const state = states.get(defName);
    if (state === 'visited') {
      return;
    }

    if (state === 'visiting') {
      const cycleStart = stack.indexOf(defName);
      if (cycleStart === -1) {
        return;
      }

      const cyclePath = [...stack.slice(cycleStart), defName];
      const cycleKey = cyclePath.join('->');

      if (!reportedCycles.has(cycleKey)) {
        reportedCycles.add(cycleKey);
        issues.push({
          code: 'binding_cycle',
          message: `defs.${defName}.bindings: Circular binding reference detected (${cyclePath.join(' -> ')}).`,
          path: ['defs', defName, 'bindings'],
        });
      }

      return;
    }

    states.set(defName, 'visiting');
    stack.push(defName);

    const definition = defs[defName];
    for (const { ref } of collectBindingRefs(definition?.bindings)) {
      if (!Object.prototype.hasOwnProperty.call(defs, ref)) {
        continue;
      }

      visit(ref);
    }

    stack.pop();
    states.set(defName, 'visited');
  };

  for (const defName of defNames) {
    visit(defName);
  }

  return issues;
};
const missingActionIssue = (
  defName: string,
  actionName: string,
): WorkflowValidationIssue => ({
  code: 'missing_action',
  message: `defs.${defName}.action: No action implementation provided for "${actionName}".`,
  path: ['defs', defName, 'action'],
  actionName,
});
const resolveSupportedBindingKinds = (
  definition: DefLike,
  defName: string,
  kinds: BindingKindSchemas,
  actions: Record<string, BindingValidationActionMetadata> | undefined,
  issues: WorkflowValidationIssue[],
): readonly string[] | null => {
  if (definition.action) {
    if (!actions) {
      return null;
    }

    const action = actions[definition.action];
    if (!action) {
      issues.push(missingActionIssue(defName, definition.action));

      return [];
    }

    return action.supportedBindings ?? [];
  }

  if (definition.kind === TASK_KIND) {
    return [];
  }

  return kinds[definition.kind]?.supportedBindings ?? [];
};

export const validateAndResolveBindings = (
  workflow: BindingAwareWorkflowLike,
  options?: BindingKindSchemas | ValidateAndResolveBindingsOptions,
): BindingValidationResult => {
  const issues: WorkflowValidationIssue[] = [];
  const resolvedDefs: ResolvedBindingDefs = {};
  const defs = workflow.defs ?? {};
  const resolvedOptions = resolveValidationOptions(options);
  const kinds = resolvedOptions.bindingKinds ?? {};
  const actions = resolvedOptions.actions;
  const kindNames = Object.keys(kinds);
  const hasBindingUsage = hasBindingsConfigured(workflow);
  const parsedSettingsByDefName = new Map<string, unknown>();

  if (hasBindingUsage && kindNames.length === 0) {
    issues.push({
      code: 'binding_registry_required',
      message:
        'Workflows that declare non-task defs or nested bindings require a non-empty "bindingKinds" registry.',
    });
  }

  for (const [defName, defDefinition] of Object.entries(defs)) {
    if (defDefinition.kind === TASK_KIND) {
      if (defDefinition.action && actions && !actions[defDefinition.action]) {
        issues.push(missingActionIssue(defName, defDefinition.action));
      }
      continue;
    }

    const kindDefinition = kinds[defDefinition.kind];

    if (!kindDefinition) {
      issues.push({
        code: 'unknown_binding_kind',
        message: `defs.${defName}.kind: Unknown binding kind "${defDefinition.kind}".`,
        path: ['defs', defName, 'kind'],
        bindingKind: defDefinition.kind,
      });
      continue;
    }

    const actionPolicy = kindDefinition.actionPolicy ?? 'optional';
    if (actionPolicy === 'required' && !defDefinition.action) {
      issues.push({
        code: 'action_required',
        message: `defs.${defName}.action: Binding kind "${defDefinition.kind}" requires an action.`,
        path: ['defs', defName, 'action'],
        bindingKind: defDefinition.kind,
      });
    }
    if (actionPolicy === 'forbidden' && defDefinition.action) {
      issues.push({
        code: 'action_forbidden',
        message: `defs.${defName}.action: Binding kind "${defDefinition.kind}" does not allow action declarations.`,
        path: ['defs', defName, 'action'],
        bindingKind: defDefinition.kind,
      });
    }
    if (defDefinition.action && actions && !actions[defDefinition.action]) {
      issues.push(missingActionIssue(defName, defDefinition.action));
    }

    const { schema } = kindDefinition;
    const parsedPayload = schema.safeParse(defDefinition.settings);

    if (!parsedPayload.success) {
      issues.push(
        ...toBindingSettingsIssues(parsedPayload.error.issues, defName),
      );
      continue;
    }

    parsedSettingsByDefName.set(defName, parsedPayload.data);

    const actionSchema = defDefinition.action
      ? actions?.[defDefinition.action]?.settingSchema
      : undefined;
    const actionParsed = actionSchema?.safeParse(defDefinition.settings);

    if (actionParsed && !actionParsed.success) {
      issues.push(
        ...toBindingSettingsIssues(actionParsed.error.issues, defName),
      );
    }
  }

  for (const [defName, defDefinition] of Object.entries(defs)) {
    const defBindings = defDefinition.bindings;

    if (!defBindings) {
      continue;
    }

    const supportedKinds = resolveSupportedBindingKinds(
      defDefinition,
      defName,
      kinds,
      actions,
      issues,
    );
    const shouldValidateSupportedKinds = Array.isArray(supportedKinds);

    for (const [bindingKind, bindingRefs] of Object.entries(defBindings)) {
      const bindingPath = ['defs', defName, 'bindings', bindingKind];
      const kindDefinition = kinds[bindingKind];

      if (!kindDefinition) {
        issues.push({
          code: 'unknown_binding_kind',
          message: `defs.${defName}.bindings.${bindingKind}: Unknown binding kind "${bindingKind}".`,
          path: bindingPath,
          bindingKind,
        });
        continue;
      }

      const { multiple } = kindDefinition;
      if (multiple && !Array.isArray(bindingRefs)) {
        issues.push({
          code: 'binding_ref',
          message: `defs.${defName}.bindings.${bindingKind}: Expected an array of def references for binding kind "${bindingKind}".`,
          path: bindingPath,
          bindingKind,
        });
        continue;
      }
      if (!multiple && typeof bindingRefs !== 'string') {
        issues.push({
          code: 'binding_ref',
          message: `defs.${defName}.bindings.${bindingKind}: Expected a single def reference string for binding kind "${bindingKind}".`,
          path: bindingPath,
          bindingKind,
        });
        continue;
      }

      if (
        shouldValidateSupportedKinds &&
        supportedKinds &&
        !supportedKinds.includes(bindingKind)
      ) {
        const supportedKindsLabel =
          supportedKinds.length > 0 ? supportedKinds.join(', ') : '<none>';
        issues.push({
          code: 'binding_unsupported',
          message: `defs.${defName}.bindings.${bindingKind}: "${defDefinition.action ?? defDefinition.kind}" does not support binding kind "${bindingKind}". Supported binding kinds: ${supportedKindsLabel}.`,
          path: bindingPath,
          bindingKind,
        });
      }

      const refs = toBindingRefs(bindingRefs);
      const duplicateRefs = collectDuplicateReferences(refs);
      if (duplicateRefs.length > 0) {
        issues.push({
          code: 'binding_ref',
          message: `defs.${defName}.bindings.${bindingKind}: Duplicate def reference(s): ${duplicateRefs.join(', ')}`,
          path: bindingPath,
          bindingKind,
        });
      }

      for (const ref of refs) {
        const definition = defs[ref];

        if (!definition) {
          issues.push({
            code: 'binding_ref',
            message: `defs.${defName}.bindings.${bindingKind}: Unknown def reference "${ref}".`,
            path: bindingPath,
            bindingKind,
          });
          continue;
        }

        if (definition.kind !== bindingKind) {
          issues.push({
            code: 'binding_ref',
            message: `defs.${defName}.bindings.${bindingKind}: Def "${ref}" has kind "${definition.kind}" and cannot be mounted as "${bindingKind}".`,
            path: bindingPath,
            bindingKind,
          });
        }
      }
    }
  }

  issues.push(...detectBindingCycles(defs));

  const inProgress = new Set<string>();
  const mountResolvedDef = (
    defName: string,
  ): MountedBindingPayload | undefined => {
    const existing = resolvedDefs[defName];
    if (existing) {
      return existing.payload;
    }

    const definition = defs[defName];
    if (!definition || definition.kind === TASK_KIND) {
      return undefined;
    }

    const parsedSettings = parsedSettingsByDefName.get(defName);
    if (parsedSettings === undefined) {
      return undefined;
    }

    if (inProgress.has(defName)) {
      return undefined;
    }

    inProgress.add(defName);
    const nestedBindings = mountTaskBindings(
      definition.bindings,
      resolvedDefs,
      kinds,
      mountResolvedDef,
    );
    const payload: MountedBindingPayload = {
      settings: parsedSettings,
      ...(definition.action ? { action: definition.action } : {}),
      ...(Object.keys(nestedBindings).length > 0
        ? { bindings: nestedBindings }
        : {}),
    };

    resolvedDefs[defName] = {
      kind: definition.kind,
      payload,
    };
    inProgress.delete(defName);

    return payload;
  };

  for (const [defName, definition] of Object.entries(defs)) {
    if (definition.kind === TASK_KIND) {
      continue;
    }

    mountResolvedDef(defName);
  }

  return { issues, resolvedDefs };
};

export const mountTaskBindings = (
  taskBindings: TaskBindingReferences | undefined,
  resolvedDefs: ResolvedBindingDefs,
  bindingKinds?: BindingKindSchemas,
  resolveDef?: (defName: string) => MountedBindingPayload | undefined,
): CompiledTaskBindings => {
  if (!taskBindings) {
    return {};
  }

  const mounted: CompiledTaskBindings = {};
  const kinds = bindingKinds ?? {};

  for (const [bindingKind, bindingRefs] of Object.entries(taskBindings)) {
    const refs = toBindingRefs(bindingRefs);
    const isMultiple =
      kinds[bindingKind]?.multiple ?? Array.isArray(bindingRefs);

    if (!isMultiple) {
      const ref = refs[0];

      if (!ref) {
        continue;
      }

      const resolvedDefPayload =
        resolvedDefs[ref]?.payload ?? resolveDef?.(ref) ?? undefined;

      if (!resolvedDefPayload) {
        continue;
      }

      mounted[bindingKind] = resolvedDefPayload;
      continue;
    }

    const mountedKindDefs: Record<string, MountedBindingPayload> = {};

    for (const ref of refs) {
      const resolvedDefPayload =
        resolvedDefs[ref]?.payload ?? resolveDef?.(ref) ?? undefined;

      if (!resolvedDefPayload) {
        continue;
      }

      mountedKindDefs[ref] = resolvedDefPayload;
    }

    if (Object.keys(mountedKindDefs).length > 0) {
      mounted[bindingKind] = mountedKindDefs;
    }
  }

  return mounted;
};
