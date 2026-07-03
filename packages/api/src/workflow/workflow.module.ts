/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { forwardRef, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SchedulerRegistry } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChatModule } from '@/chat/chat.module';
import { ThreadOrmEntity } from '@/chat/entities/thread.entity';
import { CmsModule } from '@/cms/cms.module';
import { UserModule } from '@/user/user.module';

import { ConversationalWorkflowContext } from './contexts/conversational-workflow.context';
import { ManualWorkflowContext } from './contexts/manual-workflow.context';
import { ScheduledWorkflowContext } from './contexts/scheduled-workflow.context';
import { WorkflowContextFactory } from './contexts/workflow-context-factory';
import { McpServerController } from './controllers/mcp-server.controller';
import { MemoryDefinitionController } from './controllers/memory-definition.controller';
import { WorkflowRunController } from './controllers/workflow-run.controller';
import { WorkflowVersionController } from './controllers/workflow-version.controller';
import { WorkflowController } from './controllers/workflow.controller';
import { McpServerOrmEntity } from './entities/mcp-server.entity';
import { MemoryDefinitionOrmEntity } from './entities/memory-definition.entity';
import { MemoryRecordOrmEntity } from './entities/memory-record.entity';
import { WorkflowRunOrmEntity } from './entities/workflow-run.entity';
import { WorkflowVersionOrmEntity } from './entities/workflow-version.entity';
import { WorkflowOrmEntity } from './entities/workflow.entity';
import { WebhookTriggerGuard } from './guards/webhook-trigger.guard';
import { McpServerRepository } from './repositories/mcp-server.repository';
import { MemoryDefinitionRepository } from './repositories/memory-definition.repository';
import { MemoryRecordRepository } from './repositories/memory-record.repository';
import { WorkflowRunRepository } from './repositories/workflow-run.repository';
import { WorkflowVersionRepository } from './repositories/workflow-version.repository';
import { WorkflowRepository } from './repositories/workflow.repository';
import { MemoryDefinitionSeeder } from './seeds/memory-definition.seed';
import { WorkflowSeeder } from './seeds/workflow.seed';
import { AgenticService } from './services/agentic.service';
import { McpClientPoolService } from './services/mcp-client-pool.service';
import { McpServerService } from './services/mcp-server.service';
import { MemoryDefinitionService } from './services/memory-definition.service';
import { MemoryRecordService } from './services/memory-record.service';
import { MemoryService } from './services/memory.service';
import { WebhookTriggerService } from './services/webhook-trigger.service';
import { WorkflowRunService } from './services/workflow-run.service';
import { WorkflowSchedulerService } from './services/workflow-scheduler.service';
import { WorkflowVersionService } from './services/workflow-version.service';
import { WorkflowService } from './services/workflow.service';
import { WORKFLOW_CALL_SERVICE } from './types';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkflowOrmEntity,
      WorkflowVersionOrmEntity,
      WorkflowRunOrmEntity,
      MemoryDefinitionOrmEntity,
      MemoryRecordOrmEntity,
      McpServerOrmEntity,
      ThreadOrmEntity,
    ]),
    forwardRef(() => CmsModule),
    forwardRef(() => ChatModule),
    UserModule,
    JwtModule.register({}),
  ],
  controllers: [
    WorkflowController,
    WorkflowVersionController,
    WorkflowRunController,
    MemoryDefinitionController,
    McpServerController,
  ],
  providers: [
    WorkflowRepository,
    WorkflowVersionRepository,
    WorkflowRunRepository,
    MemoryDefinitionRepository,
    MemoryRecordRepository,
    McpServerRepository,
    MemoryDefinitionSeeder,
    WorkflowSeeder,
    WorkflowService,
    WorkflowVersionService,
    WorkflowRunService,
    MemoryDefinitionService,
    MemoryRecordService,
    MemoryService,
    McpServerService,
    McpClientPoolService,
    SchedulerRegistry,
    WorkflowSchedulerService,
    ConversationalWorkflowContext,
    ManualWorkflowContext,
    ScheduledWorkflowContext,
    WorkflowContextFactory,
    AgenticService,
    WebhookTriggerService,
    WebhookTriggerGuard,
    { provide: WORKFLOW_CALL_SERVICE, useExisting: AgenticService },
  ],
  exports: [
    WorkflowRepository,
    WorkflowVersionRepository,
    WorkflowRunRepository,
    MemoryDefinitionRepository,
    MemoryRecordRepository,
    McpServerRepository,
    WorkflowService,
    WorkflowVersionService,
    WorkflowRunService,
    MemoryDefinitionService,
    MemoryRecordService,
    MemoryService,
    McpServerService,
    McpClientPoolService,
    ConversationalWorkflowContext,
    AgenticService,
    WebhookTriggerService,
    WebhookTriggerGuard,
    WORKFLOW_CALL_SERVICE,
  ],
})
export class WorkflowModule {}
