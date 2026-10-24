import { Global, Module } from '@nestjs/common';
import { FeatureLoader } from '../../services/feature-loader.js';

/** Shared filesystem boundary, without making feature application services global. */
@Global()
@Module({
  providers: [{ provide: FeatureLoader, useFactory: () => new FeatureLoader() }],
  exports: [FeatureLoader],
})
export class FeatureStorageModule {}
