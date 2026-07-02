/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Credential, CredentialFull } from '@hexabot-ai/types';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { FindManyOptions } from 'typeorm';
import { DeleteResult } from 'typeorm/driver/mongodb/typings';

import { PopulatePipe, UuidParam } from '@/utils';
import { BaseOrmController } from '@/utils/generics/base-orm.controller';
import { TypeOrmSearchFilterPipe } from '@/utils/pipes/typeorm-search-filter.pipe';

import {
  CredentialCreateDto,
  CredentialUpdateDto,
} from '../dto/credential.dto';
import { CredentialOrmEntity } from '../entities/credential.entity';
import { CredentialService } from '../services/credential.service';
import { requireAuthenticatedUserId } from '../utils/authenticated-user';

@Controller('credential')
export class CredentialController extends BaseOrmController<CredentialOrmEntity> {
  constructor(private readonly credentialService: CredentialService) {
    super(credentialService);
  }

  @Post()
  async create(
    @Body() credentialDto: CredentialCreateDto,
    @Req() req: Request,
  ): Promise<Credential> {
    const userId = requireAuthenticatedUserId(
      req,
      'Only authenticated users are allowed to use this channel',
    );

    return await this.credentialService.create({
      ...credentialDto,
      owner: userId,
    });
  }

  @Get()
  async findCredentials(
    @Query(PopulatePipe)
    populate: string[],
    @Query(
      new TypeOrmSearchFilterPipe<CredentialOrmEntity>({
        allowedFields: ['name', 'value', 'owner.id'],
        defaultSort: ['createdAt', 'desc'],
      }),
    )
    options: FindManyOptions<CredentialOrmEntity> = {},
  ): Promise<Credential[] | CredentialFull[]> {
    return await this.find(options, populate);
  }

  @Get('count')
  async filterCount(
    @Query(
      new TypeOrmSearchFilterPipe<CredentialOrmEntity>({
        allowedFields: ['name', 'value', 'owner.id'],
      }),
    )
    options: FindManyOptions<CredentialOrmEntity> = {},
  ) {
    return await this.count(options);
  }

  @Get(':id')
  async findCredential(
    @UuidParam('id') id: string,
    @Query(PopulatePipe)
    populate: string[],
  ): Promise<Credential | CredentialFull> {
    return await this.findOne(id, populate);
  }

  @Patch(':id')
  async updateOne(
    @UuidParam('id') id: string,
    @Body() credentialUpdate: CredentialUpdateDto,
  ): Promise<Credential> {
    const record = await this.credentialService.findOne(id);
    if (!record) {
      this.logger.warn(`Unable to update Credential by id ${id}`);
      throw new NotFoundException(`Credential with ID ${id} not found`);
    }

    return await this.credentialService.updateOne(id, credentialUpdate);
  }

  @Delete(':id')
  @HttpCode(204)
  async deleteCredential(@UuidParam('id') id: string): Promise<DeleteResult> {
    return await this.deleteOne(id);
  }
}
