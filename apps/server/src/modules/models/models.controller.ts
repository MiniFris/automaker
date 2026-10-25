import { Controller, Get, Inject } from '@nestjs/common';
import { ModelsCatalogService } from './models-catalog.service.js';
import {
  AvailableModelsResponseSchema,
  ModelProvidersResponseSchema,
} from '@automaker/contracts/domains/model-responses';

@Controller('models')
export class ModelsController {
  constructor(@Inject(ModelsCatalogService) private readonly catalog: ModelsCatalogService) {}

  @Get('available')
  async listAvailable() {
    return AvailableModelsResponseSchema.parse(await this.catalog.listAvailable());
  }

  @Get('providers')
  async getProviders() {
    return ModelProvidersResponseSchema.parse(await this.catalog.getProviders());
  }
}
