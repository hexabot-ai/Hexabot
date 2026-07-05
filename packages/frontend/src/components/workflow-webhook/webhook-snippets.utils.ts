/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WebhookAuthType } from "@hexabot-ai/types";
import type { WebhookTriggerConfig } from "@hexabot-ai/types";

export type WebhookSnippetTarget =
  | "curl"
  | "wget"
  | "fetch"
  | "python"
  | "axios";

export type WebhookSnippetAuth =
  | { type: "none" }
  | { type: "basic"; username: string; password: string }
  | { type: "header"; headerName: string; headerValue: string }
  // Trigger secrets live in the credentials store and are never returned to
  // the client, so basic/header snippets always carry value placeholders. A
  // JWT snippet may carry a real server-issued token when one was generated.
  | { type: "jwt"; token?: string };

export type WebhookSnippetConfig = {
  url: string;
  auth: WebhookSnippetAuth;
  body: Record<string, unknown>;
};

export const JWT_TOKEN_PLACEHOLDER = "<YOUR_JWT_TOKEN>";
export const PASSWORD_PLACEHOLDER = "<YOUR_PASSWORD>";
export const HEADER_VALUE_PLACEHOLDER = "<YOUR_HEADER_VALUE>";

export const WEBHOOK_SNIPPET_TARGETS: Array<{
  id: WebhookSnippetTarget;
  label: string;
}> = [
  { id: "curl", label: "cURL" },
  { id: "wget", label: "Wget" },
  { id: "fetch", label: "JavaScript (fetch)" },
  { id: "python", label: "Python (requests)" },
  { id: "axios", label: "Node.js (axios)" },
];

export const toSnippetAuth = (
  trigger?: WebhookTriggerConfig | null,
  jwtToken?: string,
): WebhookSnippetAuth => {
  switch (trigger?.authType) {
    case WebhookAuthType.basic:
      return {
        type: "basic",
        username: trigger.username || "<YOUR_USERNAME>",
        password: PASSWORD_PLACEHOLDER,
      };
    case WebhookAuthType.header:
      return {
        type: "header",
        headerName: trigger.headerName || "<YOUR_HEADER_NAME>",
        headerValue: HEADER_VALUE_PLACEHOLDER,
      };
    case WebhookAuthType.jwt:
      return { type: "jwt", token: jwtToken };
    default:
      return { type: "none" };
  }
};

const singleQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
const toJson = (body: Record<string, unknown>) => JSON.stringify(body, null, 2);
const generateCurl = ({ url, auth, body }: WebhookSnippetConfig): string => {
  const lines = [`curl -X POST ${singleQuote(url)}`];

  lines.push(`  -H 'Content-Type: application/json'`);

  switch (auth.type) {
    case "basic":
      lines.push(`  -u ${singleQuote(`${auth.username}:${auth.password}`)}`);
      break;
    case "header":
      lines.push(
        `  -H ${singleQuote(`${auth.headerName}: ${auth.headerValue}`)}`,
      );
      break;
    case "jwt":
      lines.push(
        `  -H ${singleQuote(
          `Authorization: Bearer ${auth.token ?? JWT_TOKEN_PLACEHOLDER}`,
        )}`,
      );
      break;
  }

  lines.push(`  -d ${singleQuote(toJson(body))}`);

  return lines.join(" \\\n");
};
const generateWget = ({ url, auth, body }: WebhookSnippetConfig): string => {
  const lines = [`wget --method=POST`];

  lines.push(`  --header='Content-Type: application/json'`);

  switch (auth.type) {
    case "basic":
      lines.push(
        `  --user=${singleQuote(auth.username)} --password=${singleQuote(
          auth.password,
        )}`,
      );
      break;
    case "header":
      lines.push(
        `  --header=${singleQuote(`${auth.headerName}: ${auth.headerValue}`)}`,
      );
      break;
    case "jwt":
      lines.push(
        `  --header=${singleQuote(
          `Authorization: Bearer ${auth.token ?? JWT_TOKEN_PLACEHOLDER}`,
        )}`,
      );
      break;
  }

  lines.push(`  --body-data=${singleQuote(toJson(body))}`);
  lines.push(`  -O - ${singleQuote(url)}`);

  return lines.join(" \\\n");
};
const buildHeaderEntries = (auth: WebhookSnippetAuth): string[] => {
  const entries = [`"Content-Type": "application/json"`];

  switch (auth.type) {
    case "header":
      entries.push(
        `${JSON.stringify(auth.headerName)}: ${JSON.stringify(
          auth.headerValue,
        )}`,
      );
      break;
    case "jwt":
      entries.push(
        `"Authorization": ${JSON.stringify(
          `Bearer ${auth.token ?? JWT_TOKEN_PLACEHOLDER}`,
        )}`,
      );
      break;
  }

  return entries;
};
const indentBlock = (text: string, indent: string) =>
  text
    .split("\n")
    .map((line, index) => (index === 0 ? line : `${indent}${line}`))
    .join("\n");
const generateFetch = ({ url, auth, body }: WebhookSnippetConfig): string => {
  const headers = buildHeaderEntries(auth);

  if (auth.type === "basic") {
    headers.push(
      `"Authorization": "Basic " + btoa(${JSON.stringify(
        `${auth.username}:${auth.password}`,
      )})`,
    );
  }

  return [
    `const response = await fetch(${JSON.stringify(url)}, {`,
    `  method: "POST",`,
    `  headers: {`,
    ...headers.map((entry) => `    ${entry},`),
    `  },`,
    `  body: JSON.stringify(${indentBlock(toJson(body), "  ")}),`,
    `});`,
    ``,
    `const result = await response.json();`,
  ].join("\n");
};
const generateAxios = ({ url, auth, body }: WebhookSnippetConfig): string => {
  const headers = buildHeaderEntries(auth);
  const options: string[] = [
    `  headers: {`,
    ...headers.map((entry) => `    ${entry},`),
    `  },`,
  ];

  if (auth.type === "basic") {
    options.push(
      `  auth: {`,
      `    username: ${JSON.stringify(auth.username)},`,
      `    password: ${JSON.stringify(auth.password)},`,
      `  },`,
    );
  }

  return [
    `const axios = require("axios");`,
    ``,
    `const { data } = await axios.post(`,
    `  ${JSON.stringify(url)},`,
    `  ${indentBlock(toJson(body), "  ")},`,
    `  {`,
    ...options.map((line) => `  ${line}`),
    `  },`,
    `);`,
  ].join("\n");
};
const generatePython = ({ url, auth, body }: WebhookSnippetConfig): string => {
  const headers = [`"Content-Type": "application/json"`];
  const requestArgs = ["url", "headers=headers", "json=payload"];

  switch (auth.type) {
    case "basic":
      requestArgs.push(
        `auth=(${JSON.stringify(auth.username)}, ${JSON.stringify(
          auth.password,
        )})`,
      );
      break;
    case "header":
      headers.push(
        `${JSON.stringify(auth.headerName)}: ${JSON.stringify(
          auth.headerValue,
        )}`,
      );
      break;
    case "jwt":
      headers.push(
        `"Authorization": ${JSON.stringify(
          `Bearer ${auth.token ?? JWT_TOKEN_PLACEHOLDER}`,
        )}`,
      );
      break;
  }

  return [
    `import json`,
    ``,
    `import requests`,
    ``,
    `url = ${JSON.stringify(url)}`,
    `headers = {`,
    ...headers.map((entry) => `    ${entry},`),
    `}`,
    // json.loads keeps the payload verbatim JSON (true/false/null) instead of
    // hand-converting literals to Python equivalents.
    `payload = json.loads("""${toJson(body)}""")`,
    ``,
    `response = requests.post(${requestArgs.join(", ")})`,
    `print(response.json())`,
  ].join("\n");
};
const generators: Record<
  WebhookSnippetTarget,
  (config: WebhookSnippetConfig) => string
> = {
  curl: generateCurl,
  wget: generateWget,
  fetch: generateFetch,
  python: generatePython,
  axios: generateAxios,
};

export const generateWebhookSnippet = (
  target: WebhookSnippetTarget,
  config: WebhookSnippetConfig,
): string => generators[target](config);
