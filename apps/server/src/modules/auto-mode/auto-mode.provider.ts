import type { FactoryProvider } from '@nestjs/common';
import { APPLICATION_EVENTS } from '../../core/eventing/application-events.js';
import type { EventEmitter } from '../../lib/events.js';
import { SettingsService } from '../../services/settings-service.js';
import { FeatureLoader } from '../../services/feature-loader.js';
import { NotificationService } from '../../services/notification-service.js';
import { AutoModeServiceCompat } from '../../services/auto-mode/index.js';
import { ProviderRegistry } from '../providers/provider-registry.service.js';
import { ToolPolicyService } from '../providers/tool-policy.service.js';

export const autoModeProvider: FactoryProvider<AutoModeServiceCompat> = {
  provide: AutoModeServiceCompat,
  inject: [
    APPLICATION_EVENTS,
    SettingsService,
    FeatureLoader,
    NotificationService,
    ProviderRegistry,
    ToolPolicyService,
  ],
  useFactory: (
    events: EventEmitter,
    settings: SettingsService,
    features: FeatureLoader,
    notifications: NotificationService,
    providers: ProviderRegistry,
    policy: ToolPolicyService
  ) =>
    new AutoModeServiceCompat(events, settings, features, null, notifications, providers, policy),
};
