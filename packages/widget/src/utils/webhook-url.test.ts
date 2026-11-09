/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { describe, expect, it } from "vitest";

import {
  buildWebhookUrl,
  rebaseDownloadUrl,
  rebaseDownloadUrls,
} from "./webhook-url";

describe("buildWebhookUrl", () => {
  it("returns the base webhook URL when workflow id is not provided", () => {
    expect(
      buildWebhookUrl({
        sourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    ).toBe("/webhook/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/");
  });

  it("rejects missing source id instead of falling back to channel name", () => {
    expect(() =>
      buildWebhookUrl({
        sourceId: "",
      }),
    ).toThrow("Widget config sourceId is required");
  });

  it("adds workflow_id query param when workflow id is provided", () => {
    expect(
      buildWebhookUrl({
        sourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        workflowId: "workflow-id-123",
      }),
    ).toBe(
      "/webhook/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/?workflow_id=workflow-id-123",
    );
  });

  it("preserves existing query params and appends workflow_id", () => {
    expect(
      buildWebhookUrl({
        sourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        workflowId: "workflow-id-123",
        query: {
          first_name: "John",
          last_name: "Doe",
        },
      }),
    ).toBe(
      "/webhook/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/?first_name=John&last_name=Doe&workflow_id=workflow-id-123",
    );
  });

  it("url-encodes workflow_id value", () => {
    expect(
      buildWebhookUrl({
        sourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        workflowId: "wf id/1",
      }),
    ).toBe(
      "/webhook/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/?workflow_id=wf+id%2F1",
    );
  });
});

describe("rebaseDownloadUrl", () => {
  const download =
    "https://api.example.com/api/webhook/web-source/download/voice.webm?t=a%2Bb";

  it("moves a download link to the origin of the widget's apiUrl", () => {
    expect(rebaseDownloadUrl(download, "https://chat.example.com/api")).toBe(
      "https://chat.example.com/api/webhook/web-source/download/voice.webm?t=a%2Bb",
    );
  });

  it("keeps the link's path when apiUrl has none", () => {
    expect(rebaseDownloadUrl(download, "https://chat.example.com")).toBe(
      "https://chat.example.com/api/webhook/web-source/download/voice.webm?t=a%2Bb",
    );
  });

  it("leaves a link already on the widget's origin untouched", () => {
    expect(rebaseDownloadUrl(download, "https://api.example.com/api")).toBe(
      download,
    );
  });

  it("leaves other URLs untouched", () => {
    for (const url of [
      "https://cdn.example.com/images/photo.png",
      "https://api.example.com/api/webhook/web-source/not-found",
      "not a url",
    ]) {
      expect(rebaseDownloadUrl(url, "https://chat.example.com")).toBe(url);
    }
  });
});

describe("rebaseDownloadUrls", () => {
  const apiUrl = "https://chat.example.com";
  const download = "https://api.example.com/webhook/s/download/a.png?t=1";

  it("rebases a file message's URL", () => {
    expect(
      rebaseDownloadUrls(
        { type: "file", data: { type: "image", url: download } },
        apiUrl,
      ).data,
    ).toEqual({
      type: "image",
      url: "https://chat.example.com/webhook/s/download/a.png?t=1",
    });
  });

  it("rebases carousel and list element images", () => {
    const message = {
      type: "carousel",
      data: { elements: [{ title: "A", image_url: download }, { title: "B" }] },
    };

    expect(rebaseDownloadUrls(message, apiUrl).data.elements).toEqual([
      {
        title: "A",
        image_url: "https://chat.example.com/webhook/s/download/a.png?t=1",
      },
      { title: "B" },
    ]);
  });
});
