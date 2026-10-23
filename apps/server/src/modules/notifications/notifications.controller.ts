import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import {
  NotificationMutationRequestSchema,
  NotificationProjectRequestSchema,
  type NotificationMutationRequest,
  type NotificationProjectRequest,
} from './notifications.schemas.js';
import { NotificationsApplicationService } from './notifications.service.js';

@Controller('notifications')
@UseGuards(AllowedPathGuard)
@AllowedPathFields('projectPath')
export class NotificationsController {
  constructor(
    @Inject(NotificationsApplicationService)
    private readonly notifications: NotificationsApplicationService
  ) {}

  @Post('list')
  @HttpCode(200)
  list(
    @Body(new ZodValidationPipe(NotificationProjectRequestSchema)) input: NotificationProjectRequest
  ): Promise<Record<string, unknown>> {
    return this.notifications.list(input);
  }

  @Post('unread-count')
  @HttpCode(200)
  unreadCount(
    @Body(new ZodValidationPipe(NotificationProjectRequestSchema)) input: NotificationProjectRequest
  ): Promise<Record<string, unknown>> {
    return this.notifications.unreadCount(input);
  }

  @Post('mark-read')
  @HttpCode(200)
  markRead(
    @Body(new ZodValidationPipe(NotificationMutationRequestSchema))
    input: NotificationMutationRequest
  ): Promise<Record<string, unknown>> {
    return this.notifications.markRead(input);
  }

  @Post('dismiss')
  @HttpCode(200)
  dismiss(
    @Body(new ZodValidationPipe(NotificationMutationRequestSchema))
    input: NotificationMutationRequest
  ): Promise<Record<string, unknown>> {
    return this.notifications.dismiss(input);
  }
}
