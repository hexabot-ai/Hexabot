/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { assertSnakeCaseName, isSnakeCaseName, toSnakeCase } from './naming';

describe('isSnakeCaseName', () => {
  it.each(['send', 'send_email', 'step_2', 'v2_api'])('accepts %s', (name) => {
    expect(isSnakeCaseName(name)).toBe(true);
  });

  it.each([
    '',
    'Send',
    'send-email',
    'send__email',
    '_send',
    'send_',
    'send email',
  ])('refuses "%s"', (name) => {
    expect(isSnakeCaseName(name)).toBe(false);
  });
});

describe('assertSnakeCaseName', () => {
  it('accepts a single word', () => {
    expect(() => assertSnakeCaseName('send', 'action')).not.toThrow();
  });

  it('names the entity and the rule it breaks', () => {
    expect(() => assertSnakeCaseName('sendEmail', 'action')).toThrow(
      'action name must be snake_case (lowercase letters and digits separated by single underscores). Received: "sendEmail"',
    );
  });
});

describe('toSnakeCase', () => {
  it.each([
    ['sendEmail', 'send_email'],
    ['Send Email!', 'send_email'],
    ['  --send--email--  ', 'send_email'],
    ['HTTPRequest2xx', 'httprequest2xx'],
    ['already_snake', 'already_snake'],
    ['', ''],
  ])('turns "%s" into "%s"', (input, expected) => {
    expect(toSnakeCase(input)).toBe(expected);
  });
});
