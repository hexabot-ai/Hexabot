/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  FileType,
  ButtonType,
  OutgoingMessageType,
  StdOutgoingAttachmentMessageData,
  StdOutgoingButtonsMessageData,
  StdOutgoingListMessageData,
  StdOutgoingQuickRepliesMessageData,
  StdOutgoingTextMessageData,
} from '@hexabot-ai/types';

import { AttachmentOrmEntity } from '@/attachment/entities/attachment.entity';
import {
  AttachmentAccess,
  AttachmentCreatedByRef,
  AttachmentResourceRef,
} from '@/attachment/types';

export const textMessage: StdOutgoingTextMessageData = {
  text: 'Hello World',
};

export const quickRepliesMessage: StdOutgoingQuickRepliesMessageData = {
  text: 'Choose one option',
  quickReplies: [
    {
      title: 'First option',
      payload: 'first_option',
    },
    {
      title: 'Second option',
      payload: 'second_option',
    },
  ],
};

export const buttonsMessage: StdOutgoingButtonsMessageData = {
  text: 'Hit one of these buttons :',
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
};

const MOCK_ATTACHMENT_ID = '11111111-1111-4111-8111-111111111111';
const attachment: AttachmentOrmEntity = Object.assign(
  new AttachmentOrmEntity(),
  {
    id: MOCK_ATTACHMENT_ID,
    name: 'attachment.jpg',
    type: 'image/jpeg',
    size: 3539,
    location: '39991e51-55c6-4a26-9176-b6ba04f180dc.jpg',
    channel: {
      ['any-channel']: {
        id: 'any-channel-attachment-id',
      },
    },
    resourceRef: AttachmentResourceRef.MessageAttachment,
    access: AttachmentAccess.Public,
    createdByRef: AttachmentCreatedByRef.User,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
);

export const contentMessage: StdOutgoingListMessageData = {
  options: {
    display: OutgoingMessageType.list,
    fields: {
      title: 'title',
      subtitle: 'desc',
      image_url: 'thumbnail',
    },
    buttons: [
      {
        type: ButtonType.postback,
        title: 'More',
        payload: '',
      },
    ],
    limit: 2,
  },
  elements: [
    {
      id: '1',
      entity: 'rank',
      title: 'First',
      desc: 'About being first',
      thumbnail: {
        type: 'image',
        payload: { id: attachment.id },
      },
      getPayload() {
        return this.title;
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      status: true,
    },
    {
      id: '2',
      entity: 'rank',
      title: 'Second',
      desc: 'About being second',
      thumbnail: {
        type: 'image',
        payload: { id: attachment.id },
      },
      getPayload() {
        return this.title;
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      status: true,
    },
  ],
  pagination: {
    total: 3,
    skip: 0,
    limit: 2,
  },
};

export const attachmentMessage: StdOutgoingAttachmentMessageData = {
  attachment: {
    type: FileType.image,
    payload: { id: attachment.id },
  },
  quickReplies: [
    {
      title: 'Next >',
      payload: 'NEXT',
    },
  ],
};
