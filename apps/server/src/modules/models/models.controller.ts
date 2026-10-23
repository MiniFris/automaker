import { Controller, Get, Inject } from '@nestjs/common';
import { ModelsCatalogService } from './models-catalog.service.js';

@Controller('models')
export class ModelsController {
  constructor(@Inject(ModelsCatalogService) private readonly catalog: ModelsCatalogService) {}

  @Get('available')
  listAvailable(): Promise<Record<string, unknown>> {
    return this.catalog.listAvailable();
  }

  @Get('providers')
  getProviders(): Promise<Record<string, unknown>> {
    return this.catalog.getProviders();
  }
}
