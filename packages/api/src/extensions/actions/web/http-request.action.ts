/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { JsonValueSchema } from '@hexabot-ai/agentic';
import axios from 'axios';
import { z } from 'zod';

import { createAction } from '@/actions/create-action';
import { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';

const httpRequestInputSchema = z.object({
  url: z.url().meta({
    title: 'URL',
    description: 'Destination URL for the HTTP request.',
  }),
  headers: z.record(z.string(), z.string()).optional().meta({
    title: 'Headers',
    description:
      'Optional request headers as key/value pairs that override defaults.',
  }),
  body: z.string().default('{}').optional().meta({
    title: 'Body',
    description:
      'Optional request body string sent for POST requests, defaults to an empty JSON object.',
  }),
});
const httpRequestSettingsSchema = z.strictObject({
  method: z.enum(['GET', 'POST']).default('GET').meta({
    title: 'Method',
    description: 'HTTP method used for the request.',
  }),
});
const httpRequestOutputSchema = z.object({
  ok: z.boolean().meta({
    title: 'OK',
    description: 'Whether the HTTP response status indicates success.',
  }),
  status: z.int().meta({
    title: 'Status',
    description: 'HTTP response status code.',
  }),
  status_text: z.string().meta({
    title: 'Status Text',
    description: 'HTTP response status text.',
  }),
  url: z.string().meta({
    title: 'URL',
    description: 'Original request URL.',
  }),
  final_url: z.string().optional().meta({
    title: 'Final URL',
    description: 'Final URL after redirects, when available.',
  }),
  body: JsonValueSchema.meta({
    title: 'Body',
    description: 'Parsed or raw response body.',
  }),
  content_type: z.string().optional().meta({
    title: 'Content Type',
    description: 'Response Content-Type header value, when present.',
  }),
  truncated: z.boolean().meta({
    title: 'Truncated',
    description: 'Whether the response body was truncated.',
  }),
  error: z.string().optional().meta({
    title: 'Error',
    description: 'Error message when the request fails.',
  }),
});

type HttpRequestInput = z.infer<typeof httpRequestInputSchema>;
type HttpRequestOutput = z.infer<typeof httpRequestOutputSchema>;
type HttpRequestSettings = z.infer<typeof httpRequestSettingsSchema>;

const DEFAULT_USER_AGENT =
  'HexabotBot/1.0 (+https://hexabot.ai; email=hello@hexabot.ai)';

function normalizeHeaders(
  headers?: Record<string, string>,
): Record<string, string> {
  if (!headers) {
    return {};
  }

  return Object.entries(headers).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      acc[key.toLowerCase()] = value;

      return acc;
    },
    {},
  );
}

function isJsonContentType(contentType?: string) {
  if (!contentType) {
    return false;
  }

  const normalized = contentType.toLowerCase();

  return (
    normalized.includes('application/json') ||
    normalized.includes('text/json') ||
    normalized.includes('+json')
  );
}

function normalizeHeaderValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map(String).join(', ');
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }

  return undefined;
}

function resolveFinalUrl(response: {
  request?: { res?: { responseUrl?: string }; responseUrl?: string };
}) {
  return response.request?.res?.responseUrl ?? response.request?.responseUrl;
}

function isAxiosCancellation(error: unknown) {
  if (typeof axios.isCancel === 'function' && axios.isCancel(error)) {
    return true;
  }

  return (
    error instanceof Error &&
    (error as Error & { code?: string }).code === 'ERR_CANCELED'
  );
}

function parseRequestBody(
  body: string,
): string | Record<string, unknown> | unknown[] {
  const trimmed = body.trim();

  if (!trimmed) {
    return body;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;

    if (parsed !== null && typeof parsed === 'object') {
      return parsed as Record<string, unknown> | unknown[];
    }
  } catch {
    return body;
  }

  return body;
}

/** Parses a JSON text body; a body that is not valid JSON is kept as text. */
function parseJsonBody(
  text: string,
  onInvalidJson: (message: string) => void,
): HttpRequestOutput['body'] {
  try {
    return JSON.parse(text.trim()) as HttpRequestOutput['body'];
  } catch (error) {
    onInvalidJson(
      error instanceof Error ? error.message : 'Invalid JSON response',
    );

    return text;
  }
}

/**
 * Reads a response body: the text of a JSON response is parsed, binary data
 * is read as UTF-8, and anything else is returned as received.
 */
function readResponseBody(
  data: unknown,
  contentType: string | undefined,
  onInvalidJson: (message: string) => void,
): HttpRequestOutput['body'] {
  if (data === undefined || data === null) {
    return '';
  }

  if (typeof data === 'string') {
    return isJsonContentType(contentType) && data.trim()
      ? parseJsonBody(data, onInvalidJson)
      : data;
  }

  // Buffer is a Uint8Array.
  if (data instanceof Uint8Array) {
    return Buffer.from(data).toString('utf8');
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }

  return data as HttpRequestOutput['body'];
}

export const HttpRequestAction = createAction<
  HttpRequestInput,
  HttpRequestOutput,
  WorkflowRuntimeContext,
  HttpRequestSettings
>({
  name: 'http_request',
  description:
    'Performs an HTTP request (GET/POST) and returns status, headers, and body with a safe User-Agent.',
  group: 'web',
  inputSchema: httpRequestInputSchema,
  outputSchema: httpRequestOutputSchema,
  settingsSchema: httpRequestSettingsSchema,
  async execute({ input, context, settings, signal }) {
    const logger = context.services.logger;
    const timeoutMs = settings.timeout_ms ?? 10000;
    const method = settings.method ?? 'GET';
    const requestData =
      method === 'POST' && input.body !== undefined
        ? parseRequestBody(input.body)
        : undefined;
    const headers = {
      'user-agent': DEFAULT_USER_AGENT,
      accept: 'application/json',
      'content-type': 'application/json',
      ...normalizeHeaders(input.headers),
    };

    try {
      const response = await axios.request({
        url: input.url,
        method,
        headers,
        timeout: timeoutMs,
        signal,
        validateStatus: () => true,
        ...(requestData !== undefined ? { data: requestData } : {}),
      });
      const contentType = normalizeHeaderValue(
        response.headers?.['content-type'],
      );

      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        status_text: response.statusText ?? '',
        url: input.url,
        final_url: resolveFinalUrl(response) ?? input.url,
        body: readResponseBody(response.data, contentType, (error) =>
          logger.warn(`http_request JSON parse failed for ${input.url}`, {
            error,
          }),
        ),
        content_type: contentType,
        truncated: false,
      };
    } catch (error) {
      if (signal?.aborted || isAxiosCancellation(error)) {
        throw error;
      }

      const message =
        error instanceof Error ? error.message : 'Unknown network error';

      logger.warn(`http_request failed for ${input.url}`, { error: message });

      return {
        ok: false,
        status: 0,
        status_text: 'network_error',
        url: input.url,
        body: '',
        truncated: false,
        error: message,
      };
    }
  },
});

export default HttpRequestAction;
