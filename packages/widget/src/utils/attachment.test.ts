/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { describe, expect, it } from "vitest";

import { getFileError, MIME_TYPES } from "./attachment";

const MB = 1024 * 1024;
const fileOf = (type: string, size = 10) =>
  new File(["x".repeat(size)], "upload", { type });

describe("getFileError", () => {
  it("accepts a voice recording typed with codec parameters", () => {
    expect(
      getFileError(fileOf("audio/webm;codecs=opus"), ["audio/webm"], MB),
    ).toBeNull();
  });

  it("matches the source's list despite spaces and case", () => {
    expect(
      getFileError(fileOf("audio/mp4"), ["audio/webm", " Audio/MP4 "], MB),
    ).toBeNull();
  });

  it("rejects a type the source does not list", () => {
    expect(getFileError(fileOf("audio/webm"), ["audio/mpeg"], MB)).toBe(
      "messages.file_message.unsupported_file_type",
    );
  });

  it("rejects a file over the size limit", () => {
    expect(getFileError(fileOf("audio/webm", 20), ["audio/webm"], 10)).toBe(
      "messages.file_message.unsupported_file_size",
    );
  });
});

describe("MIME_TYPES", () => {
  it("lets the file picker offer voice recordings", () => {
    expect(MIME_TYPES.audios).toEqual(
      expect.arrayContaining(["audio/webm", "audio/mp4", "audio/ogg"]),
    );
  });
});
