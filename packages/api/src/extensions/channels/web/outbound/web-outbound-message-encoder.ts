/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  ActionOptions,
  AttachmentRef,
  Button,
  ButtonType,
  ContentElement,
  OutgoingMessageType,
  StdOutgoingAttachmentMessageData,
  StdOutgoingButtonsMessageData,
  StdOutgoingListMessageData,
  StdOutgoingMessageEnvelope,
  StdOutgoingQuickRepliesMessageData,
  StdOutgoingTextMessageData,
} from '@hexabot-ai/types';
import { Injectable, Type } from '@nestjs/common';

import { ChannelOutboundMessageEncoder } from '@/channel/lib/outbound';
import { ChannelAttachmentService } from '@/channel/services/channel-attachment.service';
import { VIEW_MORE_PAYLOAD } from '@/chat/helpers/constants';
import { ContentOrmEntity } from '@/cms/entities/content.entity';
import { I18nService } from '@/i18n/services/i18n.service';
import { LoggerService } from '@/logger/logger.service';

import { Web } from '../types';

export type WebSourceScopedEncodeOptions = ActionOptions & {
  sourceId: string;
};

export class WebOutboundMessageEncoder extends ChannelOutboundMessageEncoder<
  Web.OutboundMessageBase,
  WebSourceScopedEncodeOptions
> {
  constructor(
    private readonly i18n: I18nService,
    private readonly logger: LoggerService,
    private readonly channelAttachmentService: ChannelAttachmentService,
  ) {
    super();
  }

  async encode(
    envelope: StdOutgoingMessageEnvelope,
    options: WebSourceScopedEncodeOptions,
  ): Promise<Web.OutboundMessageBase> {
    if (!options?.sourceId) {
      throw new Error('Missing sourceId in outbound encode options');
    }

    return await this.dispatchEnvelope(envelope, options, {
      [OutgoingMessageType.text]: ({ data }) => this.encodeTextMessage(data),
      [OutgoingMessageType.quickReply]: ({ data }) =>
        this.encodeQuickRepliesMessage(data),
      [OutgoingMessageType.buttons]: ({ data }) =>
        this.encodeButtonsMessage(data),
      [OutgoingMessageType.attachment]: ({ data }, sourceOptions) =>
        this.encodeAttachmentMessage(data, sourceOptions.sourceId),
      [OutgoingMessageType.list]: ({ data }, actionOptions) =>
        this.encodeListMessage(data, actionOptions),
      [OutgoingMessageType.carousel]: ({ data }, actionOptions) =>
        this.encodeCarouselMessage(data, actionOptions),
    });
  }

  protected encodeTextMessage(
    message: StdOutgoingTextMessageData,
  ): Web.OutboundMessageBase {
    return {
      type: Web.OutboundMessageType.text,
      data: message,
    };
  }

  protected encodeQuickRepliesMessage(
    message: StdOutgoingQuickRepliesMessageData,
  ): Web.OutboundMessageBase {
    return {
      type: Web.OutboundMessageType.quick_replies,
      data: {
        text: message.text,
        quick_replies: message.quickReplies,
      },
    };
  }

  protected encodeButtonsMessage(
    message: StdOutgoingButtonsMessageData,
  ): Web.OutboundMessageBase {
    return {
      type: Web.OutboundMessageType.buttons,
      data: {
        text: message.text,
        buttons: message.buttons,
      },
    };
  }

  protected async encodeAttachmentMessage(
    message: StdOutgoingAttachmentMessageData,
    sourceId: string,
  ): Promise<Web.OutboundMessageBase> {
    const payload: Web.OutboundMessageBase = {
      type: Web.OutboundMessageType.file,
      data: {
        type: message.attachment.type,
        url: await this.channelAttachmentService.getPublicUrl(
          sourceId,
          message.attachment.payload,
        ),
      },
    };
    if (message.quickReplies && message.quickReplies.length > 0) {
      return {
        ...payload,
        data: {
          ...payload.data,
          quick_replies: message.quickReplies,
        } as Web.OutboundFileMessageData,
      };
    }

    return payload;
  }

  protected async encodeContentElements(
    data: ContentElement[],
    options: WebSourceScopedEncodeOptions,
  ): Promise<Web.MessageElement[]> {
    if (!options.content || !options.content.fields) {
      throw new Error('Content options are missing the fields');
    }

    const fields = options.content.fields;
    const buttons: Button[] = options.content.buttons;
    const result: Web.MessageElement[] = [];

    for (const item of data) {
      const element: Web.MessageElement = {
        title: item[fields.title],
        buttons: item.buttons || [],
      };

      if (fields.subtitle && item[fields.subtitle]) {
        element.subtitle = item[fields.subtitle];
      }

      if (fields.image_url && item[fields.image_url]) {
        const attachmentRef =
          typeof item[fields.image_url] === 'string'
            ? { url: item[fields.image_url] }
            : (item[fields.image_url].payload as AttachmentRef);
        element.image_url = await this.channelAttachmentService.getPublicUrl(
          options.sourceId,
          attachmentRef,
        );
      }

      buttons.forEach((button: Button, index) => {
        const btn = { ...button };
        if (btn.type === ButtonType.web_url) {
          // The URL field of the content, else the URL of the button.
          const url: string | undefined =
            (fields.url && item[fields.url]) || btn.url;

          if (!url) {
            return;
          }

          btn.url = url.startsWith('http') ? url : 'https://' + url;
          if (!element.default_action) {
            const { title: _title, ...defaultAction } = btn;
            element.default_action = defaultAction;
          }
        } else {
          if (
            'action_payload' in fields &&
            fields.action_payload &&
            fields.action_payload in item
          ) {
            btn.payload = btn.title + ':' + item[fields.action_payload];
          } else {
            const postback = ContentOrmEntity.getPayload(item);
            btn.payload = btn.title + ':' + postback;
          }
        }
        if (index === 0 && fields.action_title && item[fields.action_title]) {
          btn.title = item[fields.action_title];
        }
        element.buttons?.push(btn);
      });

      if (Array.isArray(element.buttons) && element.buttons.length === 0) {
        delete element.buttons;
      }

      result.push(element);
    }

    return result;
  }

  protected async encodeListMessage(
    message: StdOutgoingListMessageData,
    options: WebSourceScopedEncodeOptions,
  ): Promise<Web.OutboundMessageBase> {
    const data = message.elements || [];
    const pagination = message.pagination;
    let buttons: Button[] = [],
      elements: Web.MessageElement[] = [];

    if (!data.length) {
      this.logger.error('Insufficient content count (must be >= 0 for list)');
      throw new Error('Insufficient content count (list >= 0)');
    }

    if (pagination.total - pagination.skip - pagination.limit > 0) {
      buttons = [
        {
          type: ButtonType.postback,
          title: this.i18n.t('View More'),
          payload: VIEW_MORE_PAYLOAD,
        },
      ];
    }

    elements = await this.encodeContentElements(data, options);
    const topElementStyle = options.content?.top_element_style
      ? {
          top_element_style: options.content?.top_element_style,
        }
      : {};

    return {
      type: Web.OutboundMessageType.list,
      data: {
        elements,
        buttons,
        ...topElementStyle,
      },
    };
  }

  protected async encodeCarouselMessage(
    message: StdOutgoingListMessageData,
    options: WebSourceScopedEncodeOptions,
  ): Promise<Web.OutboundMessageBase> {
    const data = message.elements || [];
    if (data.length === 0) {
      this.logger.error(
        'Insufficient content count (must be > 0 for carousel)',
      );
      throw new Error('Insufficient content count (carousel > 0)');
    }

    const elements = await this.encodeContentElements(data, options);

    return {
      type: Web.OutboundMessageType.carousel,
      data: {
        elements,
      },
    };
  }
}

export function createWebOutboundMessageEncoder(
  _channelName: string,
): Type<WebOutboundMessageEncoder> {
  @Injectable()
  class BoundWebOutboundMessageEncoder extends WebOutboundMessageEncoder {
    constructor(
      i18n: I18nService,
      logger: LoggerService,
      channelAttachmentService: ChannelAttachmentService,
    ) {
      super(i18n, logger, channelAttachmentService);
    }
  }

  return BoundWebOutboundMessageEncoder;
}

export default WebOutboundMessageEncoder;
