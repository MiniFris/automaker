import { Module } from '@nestjs/common';
import { ModelsCatalogService } from './models-catalog.service.js';
import { ModelsController } from './models.controller.js';
import { ProvidersModule } from '../providers/providers.module.js';

@Module({
  imports: [ProvidersModule],
  controllers: [ModelsController],
  providers: [ModelsCatalogService],
})
export class ModelsModule {}
