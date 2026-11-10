/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import {
  toValidationIssues,
  type WorkflowValidationIssue,
} from '../validation-issue';

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
  description?: string;
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

type ActionCatalog = NonNullable<ValidateAndResolveBindingsOptions['actions']>;

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
  schemaIssues: z.core.$ZodIssue[],
  defName: string,
): WorkflowValidationIssue[] =>
  toValidationIssues('binding_settings', schemaIssues, [
    'defs',
    defName,
    'settings',
  ]);
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
const isMissingAction = (
  actionName: string | undefined,
  actions: ActionCatalog | undefined,
): actionName is string =>
  Boolean(actionName && actions && !actions[actionName]);
const actionPolicyIssues = (
  defName: string,
  definition: DefLike,
  { actionPolicy = 'optional' }: BindingKindDescriptor,
): WorkflowValidationIssue[] => {
  const issue = (
    code: 'action_required' | 'action_forbidden',
    message: string,
  ): WorkflowValidationIssue[] => [
    {
      code,
      message: `defs.${defName}.action: Binding kind "${definition.kind}" ${message}`,
      path: ['defs', defName, 'action'],
      bindingKind: definition.kind,
    },
  ];

  if (actionPolicy === 'required' && !definition.action) {
    return issue('action_required', 'requires an action.');
  }

  if (actionPolicy === 'forbidden' && definition.action) {
    return issue('action_forbidden', 'does not allow action declarations.');
  }

  return [];
};
/**
 * Check the kind, action and settings of one def. Settings that match the
 * kind's schema are recorded in `parsedSettings`, for mounting.
 */
const validateDef = (
  defName: string,
  definition: DefLike,
  kinds: BindingKindSchemas,
  actions: ActionCatalog | undefined,
  parsedSettings: Map<string, unknown>,
): WorkflowValidationIssue[] => {
  const missingAction = isMissingAction(definition.action, actions)
    ? [missingActionIssue(defName, definition.action)]
    : [];

  if (definition.kind === TASK_KIND) {
    return missingAction;
  }

  const kindDefinition = kinds[definition.kind];
  if (!kindDefinition) {
    return [
      {
        code: 'unknown_binding_kind',
        message: `defs.${defName}.kind: Unknown binding kind "${definition.kind}".`,
        path: ['defs', defName, 'kind'],
        bindingKind: definition.kind,
      },
      ...missingAction,
    ];
  }

  const issues = [
    ...actionPolicyIssues(defName, definition, kindDefinition),
    ...missingAction,
  ];
  const parsed = kindDefinition.schema.safeParse(definition.settings);
  if (!parsed.success) {
    return [
      ...issues,
      ...toBindingSettingsIssues(parsed.error.issues, defName),
    ];
  }

  parsedSettings.set(defName, parsed.data);

  // `?.` on `safeParse` too: hosts may pass serialized schemas.
  const actionParsed = definition.action
    ? actions?.[definition.action]?.settingSchema?.safeParse?.(
        definition.settings,
      )
    : undefined;
  if (actionParsed && !actionParsed.success) {
    issues.push(...toBindingSettingsIssues(actionParsed.error.issues, defName));
  }

  return issues;
};
/**
 * List the binding kinds a def may mount, or null when they cannot be known:
 * no action catalog was given, or the def's action is missing from it.
 */
const resolveSupportedBindingKinds = (
  definition: DefLike,
  kinds: BindingKindSchemas,
  actions: ActionCatalog | undefined,
): readonly string[] | null => {
  if (definition.action) {
    const action = actions?.[definition.action];

    return action ? (action.supportedBindings ?? []) : null;
  }

  if (definition.kind === TASK_KIND) {
    return [];
  }

  return kinds[definition.kind]?.supportedBindings ?? [];
};
/**
 * Check one `bindings.<kind>` entry of a def: the kind exists, the reference
 * cardinality matches it, the def may mount it, and every reference names a
 * def of that kind.
 */
const validateBindingEntry = (
  defName: string,
  definition: DefLike,
  bindingKind: string,
  bindingRefs: string | string[],
  context: {
    defs: Record<string, DefLike>;
    kinds: BindingKindSchemas;
    supportedKinds: readonly string[] | null;
  },
): WorkflowValidationIssue[] => {
  const issue = (
    code: 'unknown_binding_kind' | 'binding_ref' | 'binding_unsupported',
    message: string,
  ): WorkflowValidationIssue => ({
    code,
    message: `defs.${defName}.bindings.${bindingKind}: ${message}`,
    path: ['defs', defName, 'bindings', bindingKind],
    bindingKind,
  });
  const kindDefinition = context.kinds[bindingKind];

  if (!kindDefinition) {
    return [
      issue('unknown_binding_kind', `Unknown binding kind "${bindingKind}".`),
    ];
  }

  const { multiple } = kindDefinition;
  if (
    multiple ? !Array.isArray(bindingRefs) : typeof bindingRefs !== 'string'
  ) {
    const expected = multiple
      ? 'an array of def references'
      : 'a single def reference string';

    return [
      issue(
        'binding_ref',
        `Expected ${expected} for binding kind "${bindingKind}".`,
      ),
    ];
  }

  const issues: WorkflowValidationIssue[] = [];
  const { supportedKinds } = context;
  if (supportedKinds && !supportedKinds.includes(bindingKind)) {
    const supportedKindsLabel =
      supportedKinds.length > 0 ? supportedKinds.join(', ') : '<none>';
    issues.push(
      issue(
        'binding_unsupported',
        `"${definition.action ?? definition.kind}" does not support binding kind "${bindingKind}". Supported binding kinds: ${supportedKindsLabel}.`,
      ),
    );
  }

  const refProblems = describeReferenceProblems(
    toBindingRefs(bindingRefs),
    bindingKind,
    context.defs,
  );

  return [
    ...issues,
    ...refProblems.map((message) => issue('binding_ref', message)),
  ];
};
/** Duplicate references, and references that do not name a def of `bindingKind`. */
const describeReferenceProblems = (
  refs: string[],
  bindingKind: string,
  defs: Record<string, DefLike>,
): string[] => {
  const problems: string[] = [];
  const duplicateRefs = collectDuplicateReferences(refs);
  if (duplicateRefs.length > 0) {
    problems.push(`Duplicate def reference(s): ${duplicateRefs.join(', ')}`);
  }

  for (const ref of refs) {
    const target = defs[ref];

    if (!target) {
      problems.push(`Unknown def reference "${ref}".`);
    } else if (target.kind !== bindingKind) {
      problems.push(
        `Def "${ref}" has kind "${target.kind}" and cannot be mounted as "${bindingKind}".`,
      );
    }
  }

  return problems;
};
const validateDefBindings = (
  defName: string,
  definition: DefLike,
  defs: Record<string, DefLike>,
  kinds: BindingKindSchemas,
  actions: ActionCatalog | undefined,
): WorkflowValidationIssue[] => {
  if (!definition.bindings) {
    return [];
  }

  const context = {
    defs,
    kinds,
    supportedKinds: resolveSupportedBindingKinds(definition, kinds, actions),
  };

  return Object.entries(definition.bindings).flatMap(
    ([bindingKind, bindingRefs]) =>
      validateBindingEntry(
        defName,
        definition,
        bindingKind,
        bindingRefs,
        context,
      ),
  );
};
/**
 * Mount every non-task def whose settings parsed, with its nested bindings.
 * A def reached again while it is being mounted, through a cycle, is left
 * out of the def that reached it.
 */
const resolveBindingDefs = (
  defs: Record<string, DefLike>,
  kinds: BindingKindSchemas,
  parsedSettings: Map<string, unknown>,
): ResolvedBindingDefs => {
  const resolvedDefs: ResolvedBindingDefs = {};
  const inProgress = new Set<string>();
  const mountDef = (defName: string): MountedBindingPayload | undefined => {
    const existing = resolvedDefs[defName];
    if (existing) {
      return existing.payload;
    }

    const definition = defs[defName];
    const settings = parsedSettings.get(defName);
    if (
      !definition ||
      definition.kind === TASK_KIND ||
      settings === undefined ||
      inProgress.has(defName)
    ) {
      return undefined;
    }

    inProgress.add(defName);
    const nestedBindings = mountTaskBindings(
      definition.bindings,
      resolvedDefs,
      kinds,
      mountDef,
    );
    const payload: MountedBindingPayload = {
      settings,
      ...(definition.action ? { action: definition.action } : {}),
      ...(definition.description
        ? { description: definition.description }
        : {}),
      ...(Object.keys(nestedBindings).length > 0
        ? { bindings: nestedBindings }
        : {}),
    };

    resolvedDefs[defName] = { kind: definition.kind, payload };
    inProgress.delete(defName);

    return payload;
  };

  for (const [defName, definition] of Object.entries(defs)) {
    if (definition.kind !== TASK_KIND) {
      mountDef(defName);
    }
  }

  return resolvedDefs;
};

/**
 * Validate the defs and bindings of a workflow, and mount every valid
 * non-task def so tasks can be handed their bindings.
 */
export const validateAndResolveBindings = (
  workflow: BindingAwareWorkflowLike,
  options?: BindingKindSchemas | ValidateAndResolveBindingsOptions,
): BindingValidationResult => {
  const defs = workflow.defs ?? {};
  const { bindingKinds: kinds = {}, actions } =
    resolveValidationOptions(options);
  const issues: WorkflowValidationIssue[] = [];
  const parsedSettings = new Map<string, unknown>();

  if (hasBindingsConfigured(workflow) && Object.keys(kinds).length === 0) {
    issues.push({
      code: 'binding_registry_required',
      message:
        'Workflows that declare non-task defs or nested bindings require a non-empty "bindingKinds" registry.',
    });
  }

  for (const [defName, definition] of Object.entries(defs)) {
    issues.push(
      ...validateDef(defName, definition, kinds, actions, parsedSettings),
    );
  }

  for (const [defName, definition] of Object.entries(defs)) {
    issues.push(
      ...validateDefBindings(defName, definition, defs, kinds, actions),
    );
  }

  issues.push(...detectBindingCycles(defs));

  return {
    issues,
    resolvedDefs: resolveBindingDefs(defs, kinds, parsedSettings),
  };
};

/** Payloads of the references that resolve, keyed by def name; none gives undefined. */
const resolveEach = (
  refs: string[],
  resolve: (ref: string) => MountedBindingPayload | undefined,
): Record<string, MountedBindingPayload> | undefined => {
  const payloads: Record<string, MountedBindingPayload> = {};
  for (const ref of refs) {
    const payload = resolve(ref);
    if (payload) {
      payloads[ref] = payload;
    }
  }

  return Object.keys(payloads).length > 0 ? payloads : undefined;
};

/**
 * Mount the defs a task (or def) references in `bindings`, by binding kind:
 * one payload for a single-ref kind, payloads keyed by def name otherwise.
 * References that resolve to nothing are left out.
 */
export const mountTaskBindings = (
  taskBindings: TaskBindingReferences | undefined,
  resolvedDefs: ResolvedBindingDefs,
  bindingKinds: BindingKindSchemas = {},
  resolveDef?: (defName: string) => MountedBindingPayload | undefined,
): CompiledTaskBindings => {
  if (!taskBindings) {
    return {};
  }

  const resolve = (ref: string) =>
    resolvedDefs[ref]?.payload ?? resolveDef?.(ref);
  const mounted: CompiledTaskBindings = {};

  for (const [bindingKind, bindingRefs] of Object.entries(taskBindings)) {
    const refs = toBindingRefs(bindingRefs);
    const isMultiple =
      bindingKinds[bindingKind]?.multiple ?? Array.isArray(bindingRefs);
    const payload = isMultiple
      ? resolveEach(refs, resolve)
      : refs[0]
        ? resolve(refs[0])
        : undefined;

    if (payload) {
      mounted[bindingKind] = payload;
    }
  }

  return mounted;
};
