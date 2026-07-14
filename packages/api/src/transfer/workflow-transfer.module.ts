/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { InjectDynamicProviders } from 'nestjs-dynamic-providers';

import { ChatModule } from '@/chat/chat.module';
import { CmsModule } from '@/cms/cms.module';
import { UserModule } from '@/user/user.module';
import { WorkflowModule } from '@/workflow/workflow.module';

import { ContentTypeTransferAdapter } from './adapters/content-type-transfer.adapter';
import { CredentialTransferAdapter } from './adapters/credential-transfer.adapter';
import { LabelTransferAdapter } from './adapters/label-transfer.adapter';
import { McpServerTransferAdapter } from './adapters/mcp-server-transfer.adapter';
import { MemoryDefinitionTransferAdapter } from './adapters/memory-definition-transfer.adapter';
import { WorkflowTransferAdapterRegistry } from './workflow-transfer-adapter.registry';
import { WorkflowTransferDefinitionService } from './workflow-transfer-definition.service';
import { WorkflowTransferController } from './workflow-transfer.controller';
import { WorkflowTransferService } from './workflow-transfer.service';

@InjectDynamicProviders(
  'node_modules/@hexabot-ai/api/dist/extensions/**/*.workflow-transfer.adapter.js',
  'node_modules/hexabot-*/**/*.workflow-transfer.adapter.js',
  '../../node_modules/hexabot-*/**/*.workflow-transfer.adapter.js',
  'dist/extensions/**/*.workflow-transfer.adapter.js',
)
@Module({
  imports: [DiscoveryModule, WorkflowModule, UserModule, CmsModule, ChatModule],
  controllers: [WorkflowTransferController],
  providers: [
    WorkflowTransferDefinitionService,
    WorkflowTransferAdapterRegistry,
    CredentialTransferAdapter,
    MemoryDefinitionTransferAdapter,
    ContentTypeTransferAdapter,
    LabelTransferAdapter,
    McpServerTransferAdapter,
    WorkflowTransferService,
  ],
  exports: [WorkflowTransferService, WorkflowTransferAdapterRegistry],
})
export class WorkflowTransferModule {}
