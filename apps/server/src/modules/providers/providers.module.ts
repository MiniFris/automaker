import { Global, Module } from '@nestjs/common';
import { LEGACY_SERVICES } from '../../legacy/legacy.tokens.js';
import { ProviderConnectionRepository } from './provider-connection.repository.js';
import { ProviderRegistry } from './provider-registry.service.js';
import { ProviderUsageController } from './provider-usage.controller.js';
import { ProviderUsageService } from './provider-usage.service.js';
import { ProviderSetupStatusService } from './provider-setup-status.service.js';
import { ProviderModelCatalogService } from './provider-model-catalog.service.js';
import { SetupController } from './setup.controller.js';
import { SetupHandlersService } from './setup-handlers.service.js';
import { ToolPolicyService } from './tool-policy.service.js';
import { HostSetupStatusService } from './host-setup-status.service.js';
import { SetupCredentialCache } from './setup-credential-cache.service.js';
import { ProviderConnectionCommandService } from './provider-connection-command.service.js';
import { ProviderInstallGuidanceService } from './provider-install-guidance.service.js';
import {
  SetupStatusRuntime,
  NodeSetupStatusRuntime,
} from '../../core/platform/setup-status.runtime.js';

@Global()
@Module({
  controllers: [ProviderUsageController, SetupController],
  providers: [
    { provide: ProviderConnectionRepository, useExisting: LEGACY_SERVICES.providerConnections },
    { provide: ProviderRegistry, useExisting: LEGACY_SERVICES.providerRegistry },
    ProviderUsageService,
    ProviderSetupStatusService,
    ProviderModelCatalogService,
    SetupHandlersService,
    ToolPolicyService,
    SetupCredentialCache,
    HostSetupStatusService,
    ProviderConnectionCommandService,
    ProviderInstallGuidanceService,
    { provide: SetupStatusRuntime, useClass: NodeSetupStatusRuntime },
  ],
  exports: [ProviderRegistry, ProviderConnectionRepository, ToolPolicyService],
})
export class ProvidersModule {}
