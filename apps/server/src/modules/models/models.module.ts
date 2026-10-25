import { Module } from '@nestjs/common';
import { ModelsCatalogService } from './models-catalog.service.js';
import { ModelsController } from './models.controller.js';

@Module({
  controllers: [ModelsController],
  providers: [ModelsCatalogService],
})
export class ModelsModule {}
