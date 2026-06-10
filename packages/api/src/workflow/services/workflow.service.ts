/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WorkflowEventMap } from '@hexabot-ai/agentic';
import { WorkflowFull, Workflow } from '@hexabot-ai/types';
import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { HookEventKey, OnEvent } from '@nestjs/event-emitter';
import { EntityManager, FindOneOptions } from 'typeorm';
import { z, ZodType } from 'zod';

import { UpdateOneOptions } from '@/utils/generics/base-orm.repository';
import { BaseOrmService } from '@/utils/generics/base-orm.service';
import { InferCreateDto } from '@/utils/types/dto.types';
import {
  SocketGet,
  SocketPost,
} from '@/websocket/decorators/socket-method.decorator';
import { SocketReq } from '@/websocket/decorators/socket-req.decorator';
import { SocketRes } from '@/websocket/decorators/socket-res.decorator';
import { WEBSOCKET_GATEWAY } from '@/websocket/tokens';
import { Room } from '@/websocket/types';
import { SocketRequest } from '@/websocket/utils/socket-request';
import { SocketResponse } from '@/websocket/utils/socket-response';
import type { WebsocketGateway } from '@/websocket/websocket.gateway';

import { WorkflowUpdateDto } from '../dto/workflow.dto';
import { WorkflowOrmEntity } from '../entities/workflow.entity';
import { WorkflowRepository } from '../repositories/workflow.repository';
import { WorkflowType } from '../types';

import { WorkflowRunService } from './workflow-run.service';

type WorkflowSocketGateway = Pick<
  WebsocketGateway,
  'joinSockets' | 'broadcastWorkflowEvent'
>;

@Injectable()
export class WorkflowService extends BaseOrmService<WorkflowOrmEntity> {
  private readonly MANUAL_INPUT_VALIDATION_ERROR = {
    statusCode: 400,
    error: 'Bad Request',
    message: 'Manual workflow input validation failed',
  } as const;

  /**
   * Creates the workflow service with the injected repository.
   *
   * @param repository - ORM repository used to manage workflow entities.
   */
  constructor(
    readonly repository: WorkflowRepository,
    @Inject(WEBSOCKET_GATEWAY)
    private readonly gateway: WorkflowSocketGateway,
    private readonly workflowRunService: WorkflowRunService,
  ) {
    super(repository);
  }

  /**
   * Pick the most recently created workflow if one exists.
   */
  async pickWorkflow(): Promise<WorkflowFull | null> {
    const [latest] = await this.findAndPopulate({
      order: { createdAt: 'DESC' },
      take: 1,
    });

    return latest ?? null;
  }

  /**
   * Persist a workflow using the provided transaction manager.
   *
   * This method intentionally does not emit BaseOrmRepository mutation events;
   * callers that own a larger transaction must emit app-level events after
   * commit.
   */
  async createWithManager(
    manager: EntityManager,
    payload: InferCreateDto<WorkflowOrmEntity>,
  ): Promise<WorkflowOrmEntity> {
    const entity = manager.create(
      WorkflowOrmEntity,
      this.repository.actionDtoToEntity(payload),
    );

    return await manager.save(WorkflowOrmEntity, entity);
  }

  /**
   * Update a workflow while enforcing immutability of its trigger type.
   */
  async updateOne(
    idOrOptions: string | FindOneOptions<WorkflowOrmEntity>,
    payload: WorkflowUpdateDto,
    options?: UpdateOneOptions,
  ): Promise<Workflow> {
    const workflow = await this.findOne(idOrOptions);
    const { type, ...rest } = payload as WorkflowUpdateDto & {
      type?: WorkflowType;
    };

    if (!workflow) {
      return await super.updateOne(idOrOptions, payload, options);
    }

    if (type !== undefined && type !== workflow.type) {
      throw new BadRequestException(
        'Workflow type cannot be changed once created',
      );
    }

    return await super.updateOne(
      idOrOptions,
      rest as WorkflowUpdateDto,
      options,
    );
  }

  /**
   * Validate manual trigger input against the workflow input schema.
   */
  validateManualInput(
    input: unknown,
    inputSchema: WorkflowOrmEntity['inputSchema'],
  ): Record<string, unknown> {
    let schema: ZodType;
    try {
      schema = z.fromJSONSchema(
        inputSchema as Parameters<typeof z.fromJSONSchema>[0],
      );
    } catch {
      throw new BadRequestException({
        ...this.MANUAL_INPUT_VALIDATION_ERROR,
        details: { schema: 'Workflow input schema is not valid.' },
      });
    }

    const validation = schema.safeParse(input);
    if (!validation.success) {
      throw new BadRequestException({
        ...this.MANUAL_INPUT_VALIDATION_ERROR,
        details: validation.error.flatten(),
      });
    }

    if (
      typeof validation.data !== 'object' ||
      validation.data === null ||
      Array.isArray(validation.data)
    ) {
      throw new BadRequestException({
        ...this.MANUAL_INPUT_VALIDATION_ERROR,
        details: {
          input: 'Manual workflow input must resolve to an object payload.',
        },
      });
    }

    return validation.data as Record<string, unknown>;
  }

  /**
   * Internally subscribe web-sockets to user's event
   * For example : Notify chat if new user interacted with the chatbot
   *
   * @param req - The socket request object
   * @param res - The socket response object
   */
  @SocketGet('/workflow/subscribe/')
  @SocketPost('/workflow/subscribe/')
  async subscribe(
    @SocketReq() req: SocketRequest,
    @SocketRes() res: SocketResponse,
  ) {
    try {
      const subscribeRoom = await this.gateway.joinSockets(
        req,
        Room.WORKFLOW,
        'workflow',
      );

      return res.status(200).json({
        success: true,
        subscribe: subscribeRoom,
      });
    } catch (e) {
      this.logger.error('Websocket subscription', e);
      throw new InternalServerErrorException(e);
    }
  }

  private async sendWorkflowEvent(
    workflowEvent: HookEventKey,
    payload: WorkflowEventMap[keyof WorkflowEventMap],
  ) {
    const t = Date.now();

    if (!payload.runId) {
      this.logger.error('runId is required');

      return;
    }
    const workflowRun = await this.workflowRunService.findOne(payload.runId);
    if (!workflowRun?.context) {
      this.logger.error('workflowRun context is required');

      return;
    }
    const { initiatorId, workflowId, threadId } = workflowRun.context;
    if (
      typeof initiatorId !== 'string' ||
      !initiatorId ||
      typeof workflowId !== 'string' ||
      !workflowId
    ) {
      this.logger.error(
        'workflowRun context requires initiatorId and workflowId',
      );

      return;
    }

    const workflow = await this.findOne(workflowId);
    if (!workflow?.type) {
      this.logger.error('workflow is required');

      return;
    }

    this.gateway.broadcastWorkflowEvent({
      ...payload,
      t,
      workflowRun,
      workflowId,
      initiatorId,
      threadId: typeof threadId === 'string' ? threadId : undefined,
      workflowEvent: workflowEvent.replace('hook:', ''),
    });
  }

  @OnEvent('hook:workflow:start')
  async sendWorkflowStart(payload: WorkflowEventMap[keyof WorkflowEventMap]) {
    await this.sendWorkflowEvent('hook:workflow:start', payload);
  }

  @OnEvent('hook:workflow:finish')
  async sendWorkflowFinish(payload: WorkflowEventMap[keyof WorkflowEventMap]) {
    await this.sendWorkflowEvent('hook:workflow:finish', payload);
  }

  @OnEvent('hook:workflow:suspended')
  async sendWorkflowSuspended(
    payload: WorkflowEventMap[keyof WorkflowEventMap],
  ) {
    await this.sendWorkflowEvent('hook:workflow:suspended', payload);
  }

  @OnEvent('hook:workflow:failure')
  async sendWorkflowFailure(payload: WorkflowEventMap[keyof WorkflowEventMap]) {
    await this.sendWorkflowEvent('hook:workflow:failure', payload);
  }

  @OnEvent('hook:step:start')
  async sendWorkflowStepStart(
    payload: WorkflowEventMap[keyof WorkflowEventMap],
  ) {
    await this.sendWorkflowEvent('hook:step:start', payload);
  }

  @OnEvent('hook:step:suspended')
  async sendWorkflowStepSuspended(
    payload: WorkflowEventMap[keyof WorkflowEventMap],
  ) {
    await this.sendWorkflowEvent('hook:step:suspended', payload);
  }

  @OnEvent('hook:step:success')
  async sendWorkflowStepSuccess(
    payload: WorkflowEventMap[keyof WorkflowEventMap],
  ) {
    await this.sendWorkflowEvent('hook:step:success', payload);
  }

  @OnEvent('hook:step:error')
  async sendWorkflowStepError(
    payload: WorkflowEventMap[keyof WorkflowEventMap],
  ) {
    await this.sendWorkflowEvent('hook:step:error', payload);
  }

  @OnEvent('hook:step:cancelled')
  async sendWorkflowStepCancelled(
    payload: WorkflowEventMap[keyof WorkflowEventMap],
  ) {
    await this.sendWorkflowEvent('hook:step:cancelled', payload);
  }
}
