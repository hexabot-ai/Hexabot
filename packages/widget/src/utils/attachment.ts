/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

export const MIME_TYPES = {
  images: ["image/jpeg", "image/png", "image/webp", "image/bmp", "image/gif"],
  videos: [
    "video/mp4",
    "video/webm",
    "video/ogg",
    "video/quicktime", // common in apple devices
    "video/x-msvideo", // AVI
    "video/x-matroska", // MKV
  ],
  audios: [
    "audio/mpeg", // MP3
    "audio/mp3", // Explicit MP3 type
    "audio/ogg",
    "audio/wav",
    "audio/aac", // common in apple devices
    "audio/x-wav",
    "audio/webm", // voice recorders in Chrome and Android
    "audio/mp4", // voice recorders in Safari and iOS
  ],
  documents: [
    "application/pdf",
    "application/msword", // older ms Word format
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // newer ms word format
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel", // older excel format
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // newer excel format
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "application/rtf",
    "application/epub+zip",
    "application/x-7z-compressed",
    "application/zip",
    "application/x-rar-compressed",
    "application/json",
    "text/csv",
  ],
};

// The type without its parameters: voice recorders type their files like
// `audio/webm;codecs=opus`. Also forgives spaces in the source's list.
const mimeEssence = (type: string) => type.split(";")[0].trim().toLowerCase();

/**
 * Why a file can't be uploaded, as a translation key, or `null` if it can.
 */
export const getFileError = (
  file: File,
  allowedUploadTypes: string[],
  maxUploadSize: number,
) => {
  const type = mimeEssence(file.type);

  if (!allowedUploadTypes.some((allowed) => mimeEssence(allowed) === type)) {
    return "messages.file_message.unsupported_file_type";
  }
  if (file.size > maxUploadSize) {
    return "messages.file_message.unsupported_file_size";
  }

  return null;
};
