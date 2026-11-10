/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import {
  mountTaskBindings,
  validateAndResolveBindings,
  type BindingKindSchemas,
  type DefLike,
} from './base-binding';

const kinds: BindingKindSchemas = {
  tools: {
    schema: z.record(z.string(), z.unknown()),
    multiple: true,
    supportedBindings: ['model'],
  },
  model: {
    schema: z.strictObject({ name: z.string() }),
    multiple: false,
  },
};
const validate = (
  defs: Record<string, DefLike>,
  options?: Parameters<typeof validateAndResolveBindings>[1],
) => validateAndResolveBindings({ defs }, options ?? { bindingKinds: kinds });
const codes = (defs: Record<string, DefLike>, options?: object) =>
  validate(defs, options).issues.map(({ code, message }) => ({
    code,
    message,
  }));

describe('validateAndResolveBindings', () => {
  it('accepts a workflow without defs', () => {
    expect(
      validateAndResolveBindings({} as { defs: Record<string, DefLike> }),
    ).toEqual({ issues: [], resolvedDefs: {} });
  });

  it('takes a bare binding kind registry as options', () => {
    const result = validateAndResolveBindings(
      { defs: { gpt: { kind: 'model', settings: { name: 'gpt' } } } },
      kinds,
    );

    expect(result).toEqual({
      issues: [],
      resolvedDefs: {
        gpt: { kind: 'model', payload: { settings: { name: 'gpt' } } },
      },
    });
  });

  it('requires a registry once a workflow declares bindings', () => {
    expect(
      codes(
        { step: { kind: 'task', action: 'run', bindings: { model: 'gpt' } } },
        {},
      ),
    ).toEqual([
      {
        code: 'binding_registry_required',
        message:
          'Workflows that declare non-task defs or nested bindings require a non-empty "bindingKinds" registry.',
      },
      {
        code: 'unknown_binding_kind',
        message: 'defs.step.bindings.model: Unknown binding kind "model".',
      },
    ]);
  });

  describe('supported binding kinds', () => {
    it('lets a task without action mount nothing', () => {
      expect(
        codes({
          step: { kind: 'task', bindings: { model: 'gpt' } },
          gpt: { kind: 'model', settings: { name: 'gpt' } },
        }),
      ).toEqual([
        {
          code: 'binding_unsupported',
          message:
            'defs.step.bindings.model: "task" does not support binding kind "model". Supported binding kinds: <none>.',
        },
      ]);
    });

    it('reads the kinds a def may mount from its binding kind', () => {
      expect(
        codes({
          lookup: {
            kind: 'tools',
            settings: {},
            bindings: { model: 'gpt', tools: ['other'] },
          },
          other: { kind: 'tools', settings: {} },
          gpt: { kind: 'model', settings: { name: 'gpt' } },
        }),
      ).toEqual([
        {
          code: 'binding_unsupported',
          message:
            'defs.lookup.bindings.tools: "tools" does not support binding kind "tools". Supported binding kinds: model.',
        },
      ]);
    });

    it('reads the kinds a def may mount from its action when one is given', () => {
      const defs = {
        step: { kind: 'task', action: 'run', bindings: { model: 'gpt' } },
        gpt: { kind: 'model', settings: { name: 'gpt' } },
      };

      expect(
        codes(defs, {
          bindingKinds: kinds,
          actions: { run: { supportedBindings: ['model'] } },
        }),
      ).toEqual([]);
      expect(
        codes(defs, { bindingKinds: kinds, actions: { run: {} } }),
      ).toEqual([
        {
          code: 'binding_unsupported',
          message:
            'defs.step.bindings.model: "run" does not support binding kind "model". Supported binding kinds: <none>.',
        },
      ]);
    });

    it('does not judge the bindings of an action without a catalog', () => {
      expect(
        codes({
          step: { kind: 'task', action: 'run', bindings: { model: 'gpt' } },
          gpt: { kind: 'model', settings: { name: 'gpt' } },
        }),
      ).toEqual([]);
    });

    it('lets a def of an unknown kind mount nothing', () => {
      expect(
        codes({
          remote: { kind: 'mcp', settings: {}, bindings: { model: 'gpt' } },
          gpt: { kind: 'model', settings: { name: 'gpt' } },
        }),
      ).toEqual([
        {
          code: 'unknown_binding_kind',
          message: 'defs.remote.kind: Unknown binding kind "mcp".',
        },
        {
          code: 'binding_unsupported',
          message:
            'defs.remote.bindings.model: "mcp" does not support binding kind "model". Supported binding kinds: <none>.',
        },
      ]);
    });
  });

  describe('binding entry issues', () => {
    const issueAt = (bindingKind: string, code: string, message: string) => ({
      code,
      message: `defs.step.bindings.${bindingKind}: ${message}`,
      path: ['defs', 'step', 'bindings', bindingKind],
      bindingKind,
    });

    it('locates every issue of a binding entry on that entry', () => {
      const { issues } = validate(
        {
          step: {
            kind: 'task',
            action: 'run',
            bindings: {
              memory: 'notes',
              model: ['gpt'],
              tools: 'lookup',
            },
          },
          gpt: { kind: 'model', settings: { name: 'gpt' } },
          lookup: { kind: 'tools', settings: {} },
        },
        { bindingKinds: kinds, actions: { run: {} } },
      );

      expect(issues).toEqual([
        issueAt(
          'memory',
          'unknown_binding_kind',
          'Unknown binding kind "memory".',
        ),
        issueAt(
          'model',
          'binding_ref',
          'Expected a single def reference string for binding kind "model".',
        ),
        issueAt(
          'tools',
          'binding_ref',
          'Expected an array of def references for binding kind "tools".',
        ),
      ]);
    });

    it('reports unsupported kinds, duplicates and bad references on the entry', () => {
      const { issues } = validate(
        {
          step: {
            kind: 'task',
            action: 'run',
            bindings: { tools: ['a', 'b', 'a', 'b', 'gpt', 'ghost'] },
          },
          a: { kind: 'tools', settings: {} },
          b: { kind: 'tools', settings: {} },
          gpt: { kind: 'model', settings: { name: 'gpt' } },
        },
        {
          bindingKinds: kinds,
          actions: { run: { supportedBindings: ['model', 'memory'] } },
        },
      );

      expect(issues).toEqual([
        issueAt(
          'tools',
          'binding_unsupported',
          '"run" does not support binding kind "tools". Supported binding kinds: model, memory.',
        ),
        issueAt('tools', 'binding_ref', 'Duplicate def reference(s): a, b'),
        issueAt(
          'tools',
          'binding_ref',
          'Def "gpt" has kind "model" and cannot be mounted as "tools".',
        ),
        issueAt('tools', 'binding_ref', 'Unknown def reference "ghost".'),
      ]);
    });
  });

  describe('missing actions', () => {
    it('reports the missing action of a def whose settings are valid', () => {
      expect(
        codes(
          { lookup: { kind: 'tools', action: 'ghost', settings: {} } },
          { bindingKinds: kinds, actions: {} },
        ),
      ).toEqual([
        {
          code: 'missing_action',
          message:
            'defs.lookup.action: No action implementation provided for "ghost".',
        },
      ]);
    });

    it('reports the missing action of a def of an unknown kind, after its kind', () => {
      expect(
        codes(
          { remote: { kind: 'mcp', action: 'ghost', settings: {} } },
          { bindingKinds: kinds, actions: {} },
        ),
      ).toEqual([
        {
          code: 'unknown_binding_kind',
          message: 'defs.remote.kind: Unknown binding kind "mcp".',
        },
        {
          code: 'missing_action',
          message:
            'defs.remote.action: No action implementation provided for "ghost".',
        },
      ]);
    });

    it('lets a def other than a task leave its action empty', () => {
      expect(
        codes(
          { lookup: { kind: 'tools', action: '', settings: {} } },
          { bindingKinds: kinds, actions: {} },
        ),
      ).toEqual([]);
    });
  });

  describe('def settings', () => {
    it('checks settings against the kind, then against the action', () => {
      const actions = {
        lookup_action: { settingSchema: z.object({ limit: z.number() }) },
      };

      expect(
        codes(
          {
            gpt: { kind: 'model', settings: {} },
            lookup: { kind: 'tools', action: 'lookup_action', settings: {} },
            search: {
              kind: 'tools',
              action: 'lookup_action',
              settings: { limit: 3 },
            },
          },
          { bindingKinds: kinds, actions },
        ),
      ).toEqual([
        {
          code: 'binding_settings',
          message:
            'defs.gpt.settings.name: Invalid input: expected string, received undefined',
        },
        {
          code: 'binding_settings',
          message:
            'defs.lookup.settings.limit: Invalid input: expected number, received undefined',
        },
      ]);
    });

    it('skips the action check when the action declares no settings schema', () => {
      expect(
        codes(
          { lookup: { kind: 'tools', action: 'lookup_action', settings: {} } },
          { bindingKinds: kinds, actions: { lookup_action: {} } },
        ),
      ).toEqual([]);
    });

    it('locates settings issues on the root of the settings', () => {
      expect(
        validate({ gpt: { kind: 'model', settings: 'gpt' } }).issues,
      ).toEqual([
        {
          code: 'binding_settings',
          message:
            'defs.gpt.settings.<root>: Invalid input: expected object, received string',
          path: ['defs', 'gpt', 'settings'],
        },
      ]);
    });

    it('does not mount a def whose settings do not match its kind', () => {
      expect(
        validate({
          gpt: { kind: 'model', settings: {} },
          lookup: { kind: 'tools', settings: {}, bindings: { model: 'gpt' } },
        }).resolvedDefs,
      ).toEqual({ lookup: { kind: 'tools', payload: { settings: {} } } });
    });
  });

  describe('resolved defs', () => {
    it('mounts nested bindings, the action and the description', () => {
      const { resolvedDefs } = validate({
        lookup: {
          kind: 'tools',
          action: 'lookup_action',
          description: 'Looks things up',
          settings: { depth: 1 },
          bindings: { model: 'gpt' },
        },
        gpt: { kind: 'model', settings: { name: 'gpt' } },
      });

      expect(resolvedDefs).toEqual({
        gpt: { kind: 'model', payload: { settings: { name: 'gpt' } } },
        lookup: {
          kind: 'tools',
          payload: {
            settings: { depth: 1 },
            action: 'lookup_action',
            description: 'Looks things up',
            bindings: { model: { settings: { name: 'gpt' } } },
          },
        },
      });
    });

    it('leaves a def reached through a cycle out of the def that reached it', () => {
      const { resolvedDefs } = validate(
        {
          alpha: { kind: 'tools', settings: {}, bindings: { tools: ['beta'] } },
          beta: { kind: 'tools', settings: {}, bindings: { tools: ['alpha'] } },
        },
        {
          bindingKinds: {
            tools: { ...kinds.tools, supportedBindings: ['tools'] },
          },
        },
      );

      expect(resolvedDefs).toEqual({
        alpha: {
          kind: 'tools',
          payload: {
            settings: {},
            bindings: {
              tools: {
                beta: { settings: {} },
              },
            },
          },
        },
        beta: { kind: 'tools', payload: { settings: {} } },
      });
    });
  });
});

describe('mountTaskBindings', () => {
  const resolvedDefs = {
    gpt: { kind: 'model', payload: { settings: { name: 'gpt' } } },
    lookup: { kind: 'tools', payload: { settings: {} } },
  };

  it('mounts nothing without bindings', () => {
    expect(mountTaskBindings(undefined, resolvedDefs, kinds)).toEqual({});
  });

  it('mounts one payload for a single-ref kind and a map otherwise', () => {
    expect(
      mountTaskBindings(
        { model: 'gpt', tools: ['lookup', 'missing'] },
        resolvedDefs,
        kinds,
      ),
    ).toEqual({
      model: { settings: { name: 'gpt' } },
      tools: { lookup: { settings: {} } },
    });
  });

  it('tells single from multiple references by their shape without a registry', () => {
    expect(
      mountTaskBindings({ model: 'gpt', tools: ['lookup'] }, resolvedDefs),
    ).toEqual({
      model: { settings: { name: 'gpt' } },
      tools: { lookup: { settings: {} } },
    });
  });

  it('leaves out kinds whose references resolve to nothing', () => {
    expect(
      mountTaskBindings({ model: '', tools: ['missing'] }, resolvedDefs, kinds),
    ).toEqual({});
    expect(mountTaskBindings({ model: [] }, resolvedDefs, kinds)).toEqual({});
  });

  it('resolves references the resolved defs do not hold yet', () => {
    const resolveDef = jest.fn((defName: string) =>
      defName === 'late' ? { settings: { late: true } } : undefined,
    );

    expect(
      mountTaskBindings(
        { tools: ['lookup', 'late'] },
        resolvedDefs,
        kinds,
        resolveDef,
      ),
    ).toEqual({
      tools: { lookup: { settings: {} }, late: { settings: { late: true } } },
    });
    expect(resolveDef).toHaveBeenCalledTimes(1);
    expect(resolveDef).toHaveBeenCalledWith('late');
  });
});
