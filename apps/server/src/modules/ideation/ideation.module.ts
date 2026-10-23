import { Module } from '@nestjs/common';
import { FeaturesModule } from '../features/features.module.js';
import { IdeationApplicationService } from './ideation-application.service.js';
import { IdeationController } from './ideation.controller.js';

@Module({
  imports: [FeaturesModule],
  controllers: [IdeationController],
  providers: [IdeationApplicationService],
})
export class IdeationModule {}
