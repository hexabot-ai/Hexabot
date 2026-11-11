/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import axios from 'axios';

import { ActionService } from '@/actions/actions.service';
import { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';

import { HttpRequestAction } from './http-request.action';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    request: jest.fn(),
  },
}));

describe('HttpRequestAction', () => {
  let actionService: ActionService;
  let action: InstanceType<typeof HttpRequestAction>;
  let logger: { warn: jest.Mock };
  let context: WorkflowRuntimeContext;

  const getRequestMock = () => axios.request as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    actionService = { register: jest.fn() } as unknown as ActionService;
    action = new HttpRequestAction(actionService);
    logger = { warn: jest.fn() };
    context = { services: { logger } } as unknown as WorkflowRuntimeContext;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('sends a GET request with normalized headers and parses JSON string responses', async () => {
    const requestMock = getRequestMock();
    const input = {
      url: 'https://example.com/resource',
      headers: {
        Authorization: 'Bearer token',
      },
    };

    requestMock.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      data: '{"hello":"world"}',
      request: { res: { responseUrl: 'https://final.example.com/resource' } },
    });

    const result = await action.execute({
      input,
      context,
      settings: {} as any,
      bindings: {} as any,
    });

    expect(requestMock).toHaveBeenCalledTimes(1);
    const requestArgs = requestMock.mock.calls[0][0];

    expect(requestArgs).toEqual(
      expect.objectContaining({
        url: input.url,
        method: 'GET',
        timeout: 10000,
        validateStatus: expect.any(Function),
        headers: {
          'user-agent':
            'HexabotBot/1.0 (+https://hexabot.ai; email=hello@hexabot.ai)',
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: 'Bearer token',
        },
      }),
    );
    expect(requestArgs).not.toHaveProperty('data');

    expect(result).toMatchObject({
      ok: true,
      status: 200,
      status_text: 'OK',
      url: input.url,
      final_url: 'https://final.example.com/resource',
      body: { hello: 'world' },
      content_type: 'application/json; charset=utf-8',
      truncated: false,
    });
  });

  it('parses JSON string request body for POST and returns object responses', async () => {
    const requestMock = getRequestMock();
    const input = {
      url: 'https://example.com/submit',
      body: '{"ping":"pong"}',
    };

    requestMock.mockResolvedValueOnce({
      status: 201,
      statusText: 'Created',
      headers: {},
      data: { id: 42 },
    });

    const result = await action.execute({
      input,
      context,
      settings: { method: 'POST', timeout_ms: 5000 } as any,
      bindings: {} as any,
    });

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: input.url,
        method: 'POST',
        timeout: 5000,
        data: { ping: 'pong' },
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      status: 201,
      status_text: 'Created',
      url: input.url,
      final_url: input.url,
      body: { id: 42 },
      truncated: false,
    });
    expect(result.content_type).toBeUndefined();
  });

  it('keeps raw string when POST request body is not valid JSON', async () => {
    const requestMock = getRequestMock();
    const input = {
      url: 'https://example.com/plain',
      body: 'ping=pong',
    };

    requestMock.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { ok: true },
    });

    await action.execute({
      input,
      context,
      settings: { method: 'POST' } as any,
      bindings: {} as any,
    });

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: input.url,
        method: 'POST',
        data: 'ping=pong',
      }),
    );
  });

  it('converts binary response data to utf8 strings', async () => {
    const requestMock = getRequestMock();
    const input = { url: 'https://example.com/binary' };

    requestMock.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/plain' },
      data: Buffer.from('binary-body'),
    });

    const result = await action.execute({
      input,
      context,
      settings: {} as any,
      bindings: {} as any,
    });

    expect(result).toMatchObject({
      ok: true,
      status: 200,
      status_text: 'OK',
      url: input.url,
      final_url: input.url,
      body: 'binary-body',
      content_type: 'text/plain',
      truncated: false,
    });
  });

  it('logs a warning and returns raw text when JSON parsing fails', async () => {
    const requestMock = getRequestMock();
    const input = { url: 'https://example.com/bad-json' };

    requestMock.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      data: '{invalid}',
    });

    const result = await action.execute({
      input,
      context,
      settings: {} as any,
      bindings: {} as any,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      `http_request JSON parse failed for ${input.url}`,
      { error: expect.any(String) },
    );
    expect(result.body).toBe('{invalid}');
  });

  it('handles network errors and returns a failure payload', async () => {
    const requestMock = getRequestMock();
    const input = { url: 'https://example.com/down' };

    requestMock.mockRejectedValueOnce(new Error('network down'));

    const result = await action.execute({
      input,
      context,
      settings: {} as any,
      bindings: {} as any,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      `http_request failed for ${input.url}`,
      { error: 'network down' },
    );
    expect(result).toMatchObject({
      ok: false,
      status: 0,
      status_text: 'network_error',
      url: input.url,
      body: '',
      truncated: false,
      error: 'network down',
    });
  });

  describe('response body', () => {
    const respondWith = async (data: unknown, contentType?: string) => {
      getRequestMock().mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: contentType ? { 'content-type': contentType } : {},
        data,
      });

      return await action.execute({
        input: { url: 'https://example.com/body' },
        context,
        settings: {} as any,
        bindings: {} as any,
      });
    };

    it('is empty when the response has no data', async () => {
      expect((await respondWith(null, 'application/json')).body).toBe('');
      expect((await respondWith(undefined)).body).toBe('');
    });

    it('keeps text as received unless the response is JSON', async () => {
      expect((await respondWith('{"a":1}', 'text/plain')).body).toBe('{"a":1}');
      expect((await respondWith('{"a":1}')).body).toBe('{"a":1}');
      expect((await respondWith('  ', 'application/json')).body).toBe('  ');
      expect(
        (await respondWith(' {"a":1} ', 'application/problem+json')).body,
      ).toEqual({ a: 1 });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('reads binary data as UTF-8 text', async () => {
      const bytes = new TextEncoder().encode('héllo');

      expect((await respondWith(bytes)).body).toBe('héllo');
      expect((await respondWith(bytes.buffer)).body).toBe('héllo');
    });

    it('returns structured data as received', async () => {
      expect((await respondWith([1, { a: 2 }])).body).toEqual([1, { a: 2 }]);
    });
  });

  it('sends a POST body that is not a JSON object or array as text', async () => {
    const requestMock = getRequestMock();
    requestMock.mockResolvedValue({ status: 204, statusText: '', data: '' });

    for (const body of ['42', '  ']) {
      await action.execute({
        input: { url: 'https://example.com/post', body },
        context,
        settings: { method: 'POST' } as any,
        bindings: {} as any,
      });
    }

    expect(requestMock.mock.calls.map(([config]) => config.data)).toEqual([
      '42',
      '  ',
    ]);
  });

  it('rethrows a cancelled request', async () => {
    const requestMock = getRequestMock();
    const controller = new AbortController();
    const aborted = new Error('aborted');
    const canceled = Object.assign(new Error('canceled'), {
      code: 'ERR_CANCELED',
    });
    requestMock
      .mockImplementationOnce(async () => {
        controller.abort();
        throw aborted;
      })
      .mockRejectedValueOnce(canceled);
    const run = (signal?: AbortSignal) =>
      action.execute({
        input: { url: 'https://example.com/slow' },
        context,
        settings: {} as any,
        bindings: {} as any,
        signal,
      });

    await expect(run(controller.signal)).rejects.toBe(aborted);
    await expect(run()).rejects.toBe(canceled);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
