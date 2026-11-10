/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ButtonType, OutgoingMessageType } from '@hexabot-ai/types';

import {
  attachmentMessage,
  buttonsMessage,
  contentMessage,
  quickRepliesMessage,
  textMessage,
} from '@/channel/lib/__test__/common.mock';
import { UnsupportedOutgoingFormatError } from '@/channel/lib/outbound';

import {
  webAttachment,
  webButtons,
  webCarousel,
  webList,
  webQuickReplies,
  webText,
} from '../__test__/data.mock';

import { WebOutboundMessageEncoder } from './web-outbound-message-encoder';

describe('WebOutboundMessageEncoder', () => {
  const sourceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const channelAttachmentService = {
    getPublicUrl: jest
      .fn()
      .mockResolvedValue('http://public.url/download/filename.extension?t=any'),
  };
  const i18n = {
    t: jest.fn((key: string) => key),
  };
  const logger = {
    error: jest.fn(),
  };
  let encoder: WebOutboundMessageEncoder;
  const render = (envelope: any, options: any = {}) =>
    encoder.encode(envelope, {
      sourceId,
      ...options,
    });

  beforeEach(() => {
    channelAttachmentService.getPublicUrl.mockClear();
    i18n.t.mockClear();
    logger.error.mockClear();
    encoder = new WebOutboundMessageEncoder(
      i18n as any,
      logger as any,
      channelAttachmentService as any,
    );
  });

  it('renders text envelopes', async () => {
    const formatted = await render({
      type: OutgoingMessageType.text,
      data: textMessage,
    });

    expect(formatted).toEqual(webText);
  });

  it('renders quick replies envelopes', async () => {
    const formatted = await render({
      type: OutgoingMessageType.quickReply,
      data: quickRepliesMessage,
    });

    expect(formatted).toEqual(webQuickReplies);
  });

  it('renders buttons envelopes', async () => {
    const formatted = await render({
      type: OutgoingMessageType.buttons,
      data: buttonsMessage,
    });

    expect(formatted).toEqual(webButtons);
  });

  it('renders list envelopes', async () => {
    const formatted = await render(
      {
        type: OutgoingMessageType.list,
        data: contentMessage,
      },
      {
        content: contentMessage.options,
      },
    );

    expect(formatted).toEqual(webList);
  });

  it('renders carousel envelopes', async () => {
    const formatted = await render(
      {
        type: OutgoingMessageType.carousel,
        data: contentMessage,
      },
      {
        content: {
          ...contentMessage.options,
          display: OutgoingMessageType.carousel,
        },
      },
    );

    expect(formatted).toEqual(webCarousel);
  });

  it('links the web_url buttons of content elements to their URL field, else to the button URL', async () => {
    const visit = {
      type: ButtonType.web_url,
      title: 'Visit',
      url: 'https://hexabot.ai',
    };
    const formatted = await render(
      {
        type: OutgoingMessageType.carousel,
        data: {
          ...contentMessage,
          elements: [
            { ...contentMessage.elements[0], link: 'https://hexabot.ai/first' },
            { ...contentMessage.elements[1], link: '' },
          ],
        },
      },
      {
        content: {
          ...contentMessage.options,
          display: OutgoingMessageType.carousel,
          fields: { ...contentMessage.options.fields, url: 'link' },
          buttons: [visit],
        },
      },
    );

    expect(formatted).toMatchObject({
      data: {
        elements: [
          { buttons: [{ ...visit, url: 'https://hexabot.ai/first' }] },
          { buttons: [visit] },
        ],
      },
    });
  });

  it('leaves out the web_url buttons of content elements without a URL', async () => {
    const formatted = await render(
      {
        type: OutgoingMessageType.carousel,
        data: contentMessage,
      },
      {
        content: {
          ...contentMessage.options,
          display: OutgoingMessageType.carousel,
          buttons: [
            { type: ButtonType.web_url, title: 'Visit', url: '' },
            ...contentMessage.options.buttons,
          ],
        },
      },
    );

    expect(formatted).toEqual(webCarousel);
  });

  it('renders attachment envelopes and resolves public urls', async () => {
    const formatted = await render({
      type: OutgoingMessageType.attachment,
      data: attachmentMessage,
    });

    expect(formatted).toEqual(webAttachment);
    expect(channelAttachmentService.getPublicUrl).toHaveBeenCalledWith(
      sourceId,
      attachmentMessage.attachment.payload,
    );
  });

  it('throws when list content options are missing fields', async () => {
    await expect(
      encoder.encode(
        {
          type: OutgoingMessageType.list,
          data: contentMessage,
        },
        { sourceId },
      ),
    ).rejects.toThrow('Content options are missing the fields');
  });

  it('throws when list message has no elements', async () => {
    await expect(
      encoder.encode(
        {
          type: OutgoingMessageType.list,
          data: {
            ...contentMessage,
            elements: [],
          },
        },
        {
          sourceId,
          content: contentMessage.options,
        },
      ),
    ).rejects.toThrow('Insufficient content count (list >= 0)');
    expect(logger.error).toHaveBeenCalledWith(
      'Insufficient content count (must be >= 0 for list)',
    );
  });

  it('throws when carousel message has no elements', async () => {
    await expect(
      encoder.encode(
        {
          type: OutgoingMessageType.carousel,
          data: {
            ...contentMessage,
            elements: [],
          },
        },
        {
          sourceId,
          content: {
            ...contentMessage.options,
            display: OutgoingMessageType.carousel,
          },
        },
      ),
    ).rejects.toThrow('Insufficient content count (carousel > 0)');
    expect(logger.error).toHaveBeenCalledWith(
      'Insufficient content count (must be > 0 for carousel)',
    );
  });

  it('throws explicit error for unsupported outgoing formats', async () => {
    await expect(
      encoder.encode(
        {
          type: OutgoingMessageType.system,
          data: { outcome: 'noop' },
        } as any,
        { sourceId },
      ),
    ).rejects.toBeInstanceOf(UnsupportedOutgoingFormatError);
  });
});
