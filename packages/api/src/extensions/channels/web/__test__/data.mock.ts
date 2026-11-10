/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { FileType, ButtonType } from '@hexabot-ai/types';

import { textMessage } from '@/channel/lib/__test__/common.mock';
import { VIEW_MORE_PAYLOAD } from '@/chat/helpers/constants';

import { Web } from '../types';

export const webText: Web.OutboundMessageBase = {
  type: Web.OutboundMessageType.text,
  data: textMessage,
};

export const webQuickReplies: Web.OutboundMessageBase = {
  data: {
    quick_replies: [
      {
        title: 'First option',
        payload: 'first_option',
      },
      {
        title: 'Second option',
        payload: 'second_option',
      },
    ],
    text: 'Choose one option',
  },
  type: Web.OutboundMessageType.quick_replies,
};

export const webButtons: Web.OutboundMessageBase = {
  data: {
    buttons: [
      {
        type: ButtonType.postback,
        title: 'First button',
        payload: 'first_button',
      },
      {
        type: ButtonType.web_url,
        title: 'Second button',
        url: 'http://button.com',
      },
    ],
    text: 'Hit one of these buttons :',
  },
  type: Web.OutboundMessageType.buttons,
};

export const webList: Web.OutboundMessageBase = {
  data: {
    buttons: [
      {
        payload: VIEW_MORE_PAYLOAD,
        title: 'View More',
        type: ButtonType.postback,
      },
    ],
    elements: [
      {
        buttons: [
          {
            payload: 'More:First',
            title: 'More',
            type: ButtonType.postback,
          },
        ],
        image_url: 'http://public.url/download/filename.extension?t=any',
        subtitle: 'About being first',
        title: 'First',
      },
      {
        buttons: [
          {
            payload: 'More:Second',
            title: 'More',
            type: ButtonType.postback,
          },
        ],
        image_url: 'http://public.url/download/filename.extension?t=any',
        subtitle: 'About being second',
        title: 'Second',
      },
    ],
  },
  type: Web.OutboundMessageType.list,
};

export const webCarousel: Web.OutboundMessageBase = {
  data: {
    elements: [
      {
        buttons: [
          {
            payload: 'More:First',
            title: 'More',
            type: ButtonType.postback,
          },
        ],
        image_url: 'http://public.url/download/filename.extension?t=any',
        subtitle: 'About being first',
        title: 'First',
      },
      {
        buttons: [
          {
            payload: 'More:Second',
            title: 'More',
            type: ButtonType.postback,
          },
        ],
        image_url: 'http://public.url/download/filename.extension?t=any',
        subtitle: 'About being second',
        title: 'Second',
      },
    ],
  },
  type: Web.OutboundMessageType.carousel,
};

export const webAttachment: Web.OutboundMessageBase = {
  data: {
    quick_replies: [
      {
        payload: 'NEXT',
        title: 'Next >',
      },
    ],
    type: FileType.image,
    url: 'http://public.url/download/filename.extension?t=any',
  },
  type: Web.OutboundMessageType.file,
};
