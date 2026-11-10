/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  issueMessages,
  toIssuePath,
  toValidationIssues,
} from './validation-issue';

describe('toIssuePath', () => {
  it('keeps string and number segments only', () => {
    expect(toIssuePath(['flow', 0, Symbol('meta'), 'do'])).toEqual([
      'flow',
      0,
      'do',
    ]);
  });
});

describe('toValidationIssues', () => {
  const schemaIssues = [
    { path: ['flow', 0, 'loop', 'while'], message: 'Required' },
    { path: [], message: 'Expected object' },
  ];

  it('locates schema issues by their path', () => {
    expect(toValidationIssues('schema', schemaIssues)).toEqual([
      {
        code: 'schema',
        message: 'flow.0.loop.while: Required',
        path: ['flow', 0, 'loop', 'while'],
      },
      { code: 'schema', message: '<root>: Expected object', path: [] },
    ]);
  });

  it('places schema issues under the path of the value the schema checked', () => {
    expect(
      toValidationIssues('binding_settings', schemaIssues, [
        'defs',
        'gpt',
        'settings',
      ]),
    ).toEqual([
      {
        code: 'binding_settings',
        message: 'defs.gpt.settings.flow.0.loop.while: Required',
        path: ['defs', 'gpt', 'settings', 'flow', 0, 'loop', 'while'],
      },
      {
        code: 'binding_settings',
        message: 'defs.gpt.settings.<root>: Expected object',
        path: ['defs', 'gpt', 'settings'],
      },
    ]);
  });
});

describe('issueMessages', () => {
  it('lists the message of each issue', () => {
    expect(
      issueMessages(
        toValidationIssues('schema', [{ path: ['a'], message: 'bad' }]),
      ),
    ).toEqual(['a: bad']);
  });
});
