import { z, type ZodType } from 'zod';
import { API_CONTRACT_VERSION } from './api-metadata.js';
import {
  AppSpecCreateSchema,
  AppSpecFeaturesSchema,
  AppSpecGenerateSchema,
  AppSpecProjectSchema,
  BacklogApplySchema,
  BacklogGenerateSchema,
  BacklogProjectSchema,
  CredentialsUpdateSchema,
  FeatureBulkDeleteSchema,
  FeatureBulkUpdateSchema,
  FeatureCreateSchema,
  FeatureImportSchema,
  FeatureUpdateSchema,
  LocalStorageMigrationRequestSchema,
  ProjectSettingsUpdateSchema,
  ProjectsOverviewResponseSchema,
  SessionCreateSchema,
  SessionUpdateSchema,
} from './project-domain.js';

export const PROJECT_DOMAIN_CONTRACT_SCHEMAS = {
  ProjectSettingsUpdate: ProjectSettingsUpdateSchema,
  CredentialsUpdate: CredentialsUpdateSchema,
  LocalStorageMigrationRequest: LocalStorageMigrationRequestSchema,
  ProjectsOverviewResponse: ProjectsOverviewResponseSchema,
  FeatureCreate: FeatureCreateSchema,
  FeatureUpdate: FeatureUpdateSchema,
  FeatureBulkUpdate: FeatureBulkUpdateSchema,
  FeatureBulkDelete: FeatureBulkDeleteSchema,
  FeatureImport: FeatureImportSchema,
  SessionCreate: SessionCreateSchema,
  SessionUpdate: SessionUpdateSchema,
  AppSpecCreate: AppSpecCreateSchema,
  AppSpecGenerate: AppSpecGenerateSchema,
  AppSpecFeatures: AppSpecFeaturesSchema,
  AppSpecProject: AppSpecProjectSchema,
  BacklogGenerate: BacklogGenerateSchema,
  BacklogProject: BacklogProjectSchema,
  BacklogApply: BacklogApplySchema,
} satisfies Record<string, ZodType>;

export function createProjectDomainOpenApiDocument() {
  return {
    openapi: '3.1.0' as const,
    info: { title: 'Automaker project-domain contracts', version: API_CONTRACT_VERSION },
    paths: {},
    components: {
      schemas: Object.fromEntries(
        Object.entries(PROJECT_DOMAIN_CONTRACT_SCHEMAS).map(([name, schema]) => [
          name,
          z.toJSONSchema(schema),
        ])
      ),
    },
  };
}
