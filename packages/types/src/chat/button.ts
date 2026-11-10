/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from "zod";

export enum ButtonType {
  postback = "postback",
  web_url = "web_url",
}

export type PostBackButton = {
  type: ButtonType.postback;
  title: string;
  payload: string;
};

export type WebUrlButton = {
  type: ButtonType.web_url;
  title: string;
  url: string;
};

export type Button = PostBackButton | WebUrlButton;

export type AnyButton = Button;

export const buttonSchema = z
  .object({
    type: z.enum([ButtonType.postback, ButtonType.web_url]).meta({
      title: "Type",
      description: "The type of button.",
    }),
    title: z.string().meta({
      title: "Title",
      description: "The label shown to the user.",
    }),
    payload: z.string().optional().meta({
      title: "Payload",
      description: "The value sent back when the button is clicked.",
    }),
    url: z
      .union([z.url(), z.literal("")])
      .optional()
      .meta({
        title: "URL",
        description: "The destination URL opened when the button is clicked.",
      }),
  })
  .superRefine((button, ctx) => {
    if (button.type === ButtonType.postback && !button.payload) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload"],
        message: "Payload is required for postback buttons.",
      });
    }

    if (button.type === ButtonType.web_url && !button.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "URL is required for web_url buttons.",
      });
    }
  }) as unknown as z.ZodType<Button>;

export enum PayloadType {
  location = "location",
  attachment = "attachment",
  quickReply = "quickReply",
  button = "button",
  outcome = "outcome",
  menu = "menu",
  content = "content",
}
