/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';

import { config } from '@/config';

export interface IOOutgoingMessage {
  statusCode: number;
  body: any;
  headers: Record<string, string>;
}

export interface IOIncomingMessage {
  method: string;
  headers: Record<string, string>;
  data: Record<string, any>;
  params: Record<string, any>;
  url: string;
}

@Injectable()
export class IOMessagePipe implements PipeTransform<string, IOIncomingMessage> {
  transform(value: string, _metadata: ArgumentMetadata): IOIncomingMessage {
    let message: IOIncomingMessage;
    try {
      // TODO: Investigate why it arrives parsed
      message =
        typeof value === 'string'
          ? JSON.parse(value)
          : (value as any as IOIncomingMessage);
    } catch (_error) {
      throw new BadRequestException('Invalid JSON format');
    }

    if (!message.method || !message.url) {
      throw new BadRequestException('Missing required fields: method, url');
    }

    const url = message.url.startsWith('http')
      ? message.url
      : `${config.apiBaseUrl}${message.url}`;

    if (!URL.canParse(url)) {
      throw new BadRequestException('Cannot parse url');
    }

    if (
      !['get', 'post', 'put', 'delete', 'patch', 'options', 'head'].includes(
        message.method,
      )
    ) {
      throw new BadRequestException('Invalid method!');
    }

    return message;
  }
}
