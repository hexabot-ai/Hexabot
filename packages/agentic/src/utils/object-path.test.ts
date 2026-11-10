/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { getValueAtPath, setValueAtPath } from './object-path';

describe('getValueAtPath', () => {
  const value = { flow: [{ do: 'first' }, { loop: { steps: ['x'] } }] };

  it('reads nested object keys and array indexes', () => {
    expect(getValueAtPath(value, ['flow', 1, 'loop', 'steps', 0])).toBe('x');
    expect(getValueAtPath(value, [])).toBe(value);
  });

  it('reads nothing past null, undefined or a primitive', () => {
    expect(getValueAtPath({ flow: null }, ['flow', 0])).toBeUndefined();
    expect(getValueAtPath({}, ['flow', 0])).toBeUndefined();
    expect(getValueAtPath({ name: 'run' }, ['name', 'length'])).toBeUndefined();
  });

  it('reads array items by number only', () => {
    expect(getValueAtPath(value, ['flow', '0'])).toBeUndefined();
    expect(getValueAtPath(value, ['flow', 'length'])).toBeUndefined();
  });

  it('reads object keys given as numbers', () => {
    expect(getValueAtPath({ 1: 'one' }, [1])).toBe('one');
  });
});

describe('setValueAtPath', () => {
  it('copies every container on the path and leaves the input untouched', () => {
    const value = { flow: [{ do: 'first' }, { do: 'second' }], outputs: {} };
    const next = setValueAtPath(value, ['flow', 1, 'do'], 'renamed');

    expect(next).toEqual({
      flow: [{ do: 'first' }, { do: 'renamed' }],
      outputs: {},
    });
    expect(value.flow[1].do).toBe('second');
    expect(next.flow).not.toBe(value.flow);
    expect(next.flow[0]).toBe(value.flow[0]);
    expect(next.outputs).toBe(value.outputs);
  });

  it('replaces the whole value for an empty path', () => {
    expect(setValueAtPath({ a: 1 }, [], 'next')).toBe('next');
  });

  it('sets a missing last key but creates no missing container', () => {
    expect(setValueAtPath({}, ['defs'], { task: {} })).toEqual({
      defs: { task: {} },
    });
    expect(setValueAtPath({}, ['defs', 'task'], { kind: 'task' })).toEqual({
      defs: undefined,
    });
  });

  it('returns the value as is when the path does not fit it', () => {
    const list = ['a'];

    expect(setValueAtPath(list, ['0'], 'b')).toBe(list);
    expect(setValueAtPath('text', ['length'], 1)).toBe('text');
    expect(setValueAtPath({ name: null }, ['name', 'first'], 'x')).toEqual({
      name: null,
    });
  });
});
