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
import {
  NotificationsListResponseSchema,
  NotificationCountResponseSchema,
  NotificationReadResponseSchema,
  NotificationDismissResponseSchema,
} from '@automaker/contracts/domains/notifications';

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
  async list(
    @Body(new ZodValidationPipe(NotificationProjectRequestSchema)) input: NotificationProjectRequest
  ) {
    return NotificationsListResponseSchema.parse(await this.notifications.list(input));
  }

  @Post('unread-count')
  @HttpCode(200)
  async unreadCount(
    @Body(new ZodValidationPipe(NotificationProjectRequestSchema)) input: NotificationProjectRequest
  ) {
    return NotificationCountResponseSchema.parse(await this.notifications.unreadCount(input));
  }

  @Post('mark-read')
  @HttpCode(200)
  async markRead(
    @Body(new ZodValidationPipe(NotificationMutationRequestSchema))
    input: NotificationMutationRequest
  ) {
    return NotificationReadResponseSchema.parse(await this.notifications.markRead(input));
  }

  @Post('dismiss')
  @HttpCode(200)
  async dismiss(
    @Body(new ZodValidationPipe(NotificationMutationRequestSchema))
    input: NotificationMutationRequest
  ) {
    return NotificationDismissResponseSchema.parse(await this.notifications.dismiss(input));
  }
}
