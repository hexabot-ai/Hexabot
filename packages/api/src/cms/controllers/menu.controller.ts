/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Menu } from '@hexabot-ai/types';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
} from '@nestjs/common';

import { UuidParam } from '@/utils/decorators/uuid-param.decorator';
import { BaseOrmController } from '@/utils/generics/base-orm.controller';

import { MenuCreateDto, MenuUpdateDto } from '../dto/menu.dto';
import { MenuOrmEntity } from '../entities/menu.entity';
import { MenuService } from '../services/menu.service';

@Controller('menu')
export class MenuController extends BaseOrmController<MenuOrmEntity> {
  constructor(protected readonly menuService: MenuService) {
    super(menuService);
  }

  /**
   * Creates a new menu item.
   *
   * Validates the menu creation request and inserts a new menu into the database.
   *
   * @param body - DTO containing the data needed to create the new menu.
   *
   * @returns A promise that resolves to the created menu item.
   */
  @Post()
  async create(@Body() body: MenuCreateDto): Promise<Menu> {
    return await this.menuService.create(body);
  }

  /**
   * Retrieves a tree-structured list of menu items.
   *
   * This endpoint returns menus arranged in a hierarchical tree structure.
   *
   * @returns A promise that resolves to the tree-structured list of menu items.
   */
  @Get('tree')
  async getTree() {
    return await this.menuService.getTree();
  }

  /**
   * Updates an existing menu item or creates a new one if the ID does not exist.
   *
   * Checks the validity of the request and updates the menu item with the given ID, or creates a new one if the ID is not provided.
   *
   * @param body - DTO containing the data needed to update the menu.
   * @param id - The ID of the menu to update.
   *
   * @returns A promise that resolves to the updated or newly created menu item.
   */
  @Patch(':id')
  async updateOne(
    @Body() body: MenuUpdateDto,
    @UuidParam('id') id: string,
  ): Promise<Menu> {
    if (!id) {
      return await this.create(body as MenuCreateDto);
    }

    return await this.menuService.updateOne(id, body);
  }

  /**
   * Deletes a menu item by its ID.
   *
   * Deletes the specified menu item and its child menus, handling errors and not found scenarios.
   *
   * @param id - The ID of the menu to delete.
   *
   * @returns A promise that resolves to an empty string upon successful deletion.
   */
  @Delete(':id')
  @HttpCode(204)
  async deleteMenuItem(@UuidParam('id') id: string) {
    return this.deleteOne(id);
  }
}
