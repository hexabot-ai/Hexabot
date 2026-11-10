/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  AttachmentPayload,
  Button,
  ButtonType,
  ContentElement,
  ContentOptions,
  ContentPagination,
  OutgoingMessageType,
  StdOutgoingAttachmentEnvelope,
  StdOutgoingButtonsEnvelope,
  StdOutgoingListEnvelope,
  StdOutgoingQuickRepliesEnvelope,
  StdOutgoingSystemEnvelope,
  StdOutgoingTextEnvelope,
  StdQuickReply,
} from '@hexabot-ai/types';

import { getRandomElement } from '@/utils/helpers/safeRandom';

import { getEnvelopeBuilder } from './envelope-builder';

export class EnvelopeFactory {
  /**
   * Processes the provided text or array of texts and returns a string.
   *
   * @param text - The text or an array of text strings to be processed.
   * @returns - The processed text.
   */
  public processText(text: string | string[]): string {
    return Array.isArray(text) ? getRandomElement(text) : text;
  }

  /**
   * Processes the title and payload of a quick reply.
   *
   * @param quickReply - The quick reply to process.
   * @returns - The processed quick reply.
   */
  private processQuickReply(quickReply: StdQuickReply): StdQuickReply {
    return {
      ...quickReply,
      title: this.processText(quickReply.title),
      payload: this.processText(quickReply.payload),
    };
  }

  /**
   * Returns an envelope builder instance for the specified message type.
   *
   * @template F - The envelope message type extending OutgoingMessageType.
   * @param type - The desired envelope message type.
   * @returns A builder instance for creating envelopes of the specified type.
   */
  getBuilder<F extends OutgoingMessageType>(type: F) {
    return getEnvelopeBuilder<F>(type);
  }

  /**
   * Builds a text envelope by processing the provided text.
   *
   * This method normalizes the input text (string or array) and builds a text envelope
   * using the envelope builder.
   *
   * @param text - The text content or an array of text variants.
   * @returns A finalized text envelope object.
   */
  buildTextEnvelope(text: string | string[]): StdOutgoingTextEnvelope {
    const builder = this.getBuilder(OutgoingMessageType.text);
    const processedText = this.processText(text);

    return builder.setText(processedText).build();
  }

  /**
   * Builds a quick replies envelope by processing the text and quick reply items.
   *
   * Processes the input text, then appends each processed quick reply
   * (with processed title and payload) to the envelope before finalizing it.
   *
   * @param text - The text content or an array of text variants.
   * @param quickReplies - An array of quick reply objects.
   * @returns A finalized quick replies envelope object.
   */
  buildQuickRepliesEnvelope(
    text: string | string[],
    quickReplies: StdQuickReply[],
  ): StdOutgoingQuickRepliesEnvelope {
    const builder = this.getBuilder(OutgoingMessageType.quickReply);
    const processedText = this.processText(text);
    const envelope = builder.setText(processedText);

    quickReplies.forEach((qr) => {
      envelope.appendToQuickReplies(this.processQuickReply(qr));
    });

    return envelope.build();
  }

  /**
   * Builds a buttons envelope by processing the text and button items.
   *
   * Processes the input text and iterates over the provided buttons.
   * For postback buttons, both the title and payload are processed; for other button types,
   * only the title is processed. Each processed button is then appended to the envelope.
   *
   * @param text - The text content or an array of text variants.
   * @param buttons - An array of button objects.
   * @returns A finalized buttons envelope object.
   */
  buildButtonsEnvelope(
    text: string | string[],
    buttons: Button[],
  ): StdOutgoingButtonsEnvelope {
    const builder = this.getBuilder(OutgoingMessageType.buttons);
    const processedText = this.processText(text);
    const envelope = builder.setText(processedText);

    buttons.forEach((btn) => {
      if (btn.type === ButtonType.postback) {
        envelope.appendToButtons({
          ...btn,
          title: this.processText(btn.title),
          payload: this.processText(btn.payload),
        });
      } else {
        envelope.appendToButtons({
          ...btn,
          title: this.processText(btn.title),
        });
      }
    });

    return envelope.build();
  }

  /**
   * Builds an attachment envelope with the provided attachment payload.
   *
   * Sets the attachment on the envelope and appends any quick replies after processing them.
   *
   * @param attachment - The attachment payload object.
   * @param quickReplies - Optional array of quick reply objects.
   * @returns A finalized attachment envelope object.
   */
  buildAttachmentEnvelope(
    attachment: AttachmentPayload,
    quickReplies: StdQuickReply[] = [],
  ): StdOutgoingAttachmentEnvelope {
    const builder = this.getBuilder(OutgoingMessageType.attachment);
    const envelope = builder.setAttachment(attachment);

    quickReplies.forEach((qr) => {
      envelope.appendToQuickReplies(this.processQuickReply(qr));
    });

    return envelope.build();
  }

  /**
   * Builds a list or carousel envelope using the provided content options.
   *
   * This method builds a list envelope (applicable for both carousel and list formats)
   * by setting options, elements, and pagination details on the envelope.
   *
   * @param type - The envelope type (carousel or list).
   * @param options - Options for content presentation.
   * @param elements - An array of content elements.
   * @param pagination - Pagination details for the content.
   * @returns A finalized list envelope object.
   */
  buildListEnvelope(
    type: OutgoingMessageType.carousel | OutgoingMessageType.list,
    options: ContentOptions,
    elements: ContentElement[],
    pagination: ContentPagination,
  ): StdOutgoingListEnvelope {
    const builder = this.getBuilder(type);

    return builder
      .setOptions(options)
      .setElements(elements)
      .setPagination(pagination)
      .build();
  }

  /**
   * Builds a system envelope with the specified outcome and optional data.
   *
   * Processes the provided outcome and additional data (if any) to create a system envelope.
   * This envelope type is used for system-level messaging.
   *
   * @param outcome - The outcome message or status.
   * @param data - Optional additional data to include in the envelope.
   * @returns A finalized system envelope object.
   */
  buildSystemEnvelope(
    outcome: string | undefined,
    data?: unknown,
  ): StdOutgoingSystemEnvelope {
    const builder = this.getBuilder(OutgoingMessageType.system);

    return builder.setOutcome(outcome).setData(data).build();
  }
}
