/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WebhookAuthType } from "@hexabot-ai/types";
import type { WebhookTriggerConfig } from "@hexabot-ai/types";
import { describe, expect, it } from "vitest";

import {
  generateWebhookSnippet,
  HEADER_VALUE_PLACEHOLDER,
  JWT_TOKEN_PLACEHOLDER,
  PASSWORD_PLACEHOLDER,
  toSnippetAuth,
  WEBHOOK_SNIPPET_TARGETS,
} from "./webhook-snippets.utils";
import type { WebhookSnippetConfig } from "./webhook-snippets.utils";

const url = "https://api.example.com/webhook/wf-1/trigger";
const body = { name: "Ada", active: true, retries: null };
const buildConfig = (
  overrides: Partial<WebhookSnippetConfig> = {},
): WebhookSnippetConfig => ({
  url,
  auth: { type: "none" },
  body,
  ...overrides,
});

describe("toSnippetAuth", () => {
  it("maps a missing config to none", () => {
    expect(toSnippetAuth(null)).toEqual({ type: "none" });
    expect(toSnippetAuth(undefined)).toEqual({ type: "none" });
  });

  it("maps basic auth with a password placeholder", () => {
    expect(
      toSnippetAuth({
        enabled: true,
        authType: WebhookAuthType.basic,
        username: "ada",
        passwordCredentialId: "cred-1",
      } as WebhookTriggerConfig),
    ).toEqual({
      type: "basic",
      username: "ada",
      password: PASSWORD_PLACEHOLDER,
    });
  });

  it("falls back to placeholders for empty non-secret fields", () => {
    expect(
      toSnippetAuth({
        enabled: true,
        authType: WebhookAuthType.basic,
        username: null,
        passwordCredentialId: null,
      } as WebhookTriggerConfig),
    ).toEqual({
      type: "basic",
      username: "<YOUR_USERNAME>",
      password: PASSWORD_PLACEHOLDER,
    });
    expect(
      toSnippetAuth({
        enabled: true,
        authType: WebhookAuthType.header,
        headerName: null,
        headerValueCredentialId: "cred-2",
      } as WebhookTriggerConfig),
    ).toEqual({
      type: "header",
      headerName: "<YOUR_HEADER_NAME>",
      headerValue: HEADER_VALUE_PLACEHOLDER,
    });
  });

  it("always uses a header value placeholder", () => {
    expect(
      toSnippetAuth({
        enabled: true,
        authType: WebhookAuthType.header,
        headerName: "X-Webhook-Token",
        headerValueCredentialId: "cred-2",
      } as WebhookTriggerConfig),
    ).toEqual({
      type: "header",
      headerName: "X-Webhook-Token",
      headerValue: HEADER_VALUE_PLACEHOLDER,
    });
  });

  it("carries a generated token for jwt auth", () => {
    const config = {
      enabled: true,
      authType: WebhookAuthType.jwt,
      jwtSecretCredentialId: "cred-3",
      jwtAlgorithm: null,
    } as WebhookTriggerConfig;

    expect(toSnippetAuth(config)).toEqual({ type: "jwt", token: undefined });
    expect(toSnippetAuth(config, "signed.jwt.token")).toEqual({
      type: "jwt",
      token: "signed.jwt.token",
    });
  });
});

describe("generateWebhookSnippet", () => {
  it.each(WEBHOOK_SNIPPET_TARGETS.map(({ id }) => id))(
    "includes the url and body for %s",
    (target) => {
      const snippet = generateWebhookSnippet(target, buildConfig());

      expect(snippet).toContain(url);
      expect(snippet).toContain(`"name": "Ada"`);
      expect(snippet).toContain("Content-Type");
    },
  );

  it("generates curl basic auth", () => {
    const snippet = generateWebhookSnippet(
      "curl",
      buildConfig({
        auth: { type: "basic", username: "ada", password: "s3cret" },
      }),
    );

    expect(snippet).toContain("-u 'ada:s3cret'");
  });

  it("generates curl header auth", () => {
    const snippet = generateWebhookSnippet(
      "curl",
      buildConfig({
        auth: {
          type: "header",
          headerName: "X-Webhook-Token",
          headerValue: "token-123",
        },
      }),
    );

    expect(snippet).toContain("-H 'X-Webhook-Token: token-123'");
  });

  it("generates jwt placeholders for every target", () => {
    for (const { id } of WEBHOOK_SNIPPET_TARGETS) {
      const snippet = generateWebhookSnippet(
        id,
        buildConfig({ auth: { type: "jwt" } }),
      );

      expect(snippet).toContain(`Bearer ${JWT_TOKEN_PLACEHOLDER}`);
    }
  });

  it("substitutes a generated token for every target", () => {
    for (const { id } of WEBHOOK_SNIPPET_TARGETS) {
      const snippet = generateWebhookSnippet(
        id,
        buildConfig({ auth: { type: "jwt", token: "signed.jwt.token" } }),
      );

      expect(snippet).toContain("Bearer signed.jwt.token");
      expect(snippet).not.toContain(JWT_TOKEN_PLACEHOLDER);
    }
  });

  it("escapes single quotes in shell payloads", () => {
    const config = buildConfig({ body: { note: "it's fine" } });

    expect(generateWebhookSnippet("curl", config)).toContain(`it'\\''s fine`);
    expect(generateWebhookSnippet("wget", config)).toContain(`it'\\''s fine`);
  });

  it("handles an empty body", () => {
    const snippet = generateWebhookSnippet("curl", buildConfig({ body: {} }));

    expect(snippet).toContain("-d '{}'");
  });

  it("uses wget --user/--password for basic auth", () => {
    const snippet = generateWebhookSnippet(
      "wget",
      buildConfig({
        auth: { type: "basic", username: "ada", password: "s3cret" },
      }),
    );

    expect(snippet).toContain("--user='ada'");
    expect(snippet).toContain("--password='s3cret'");
  });

  it("uses btoa for fetch basic auth and axios auth option", () => {
    const auth = {
      type: "basic",
      username: "ada",
      password: "s3cret",
    } as const;

    expect(generateWebhookSnippet("fetch", buildConfig({ auth }))).toContain(
      `"Basic " + btoa("ada:s3cret")`,
    );
    expect(generateWebhookSnippet("axios", buildConfig({ auth }))).toContain(
      `username: "ada"`,
    );
  });

  it("keeps JSON literals intact in python via json.loads", () => {
    const snippet = generateWebhookSnippet("python", buildConfig());

    expect(snippet).toContain(`json.loads("""`);
    expect(snippet).toContain(`"active": true`);
    expect(snippet).not.toContain("auth=");
  });
});
