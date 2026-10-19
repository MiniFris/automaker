import { translate, useUiLocale } from '@/lib/i18n';
import { useState } from 'react';
import { Workflow, RotateCcw, Replace, Brain } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { Button } from '@/components/ui/button';
import { PhaseModelSelector } from './phase-model-selector';
import { BulkReplaceDialog } from './bulk-replace-dialog';
import type { PhaseModelKey, PhaseModelEntry, ThinkingLevel } from '@automaker/types';
import {
  DEFAULT_PHASE_MODELS,
  DEFAULT_GLOBAL_SETTINGS,
  REASONING_EFFORT_LEVELS,
} from '@automaker/types';

interface PhaseConfig {
  key: PhaseModelKey;
  label: string;
  description: string;
}

const QUICK_TASKS: PhaseConfig[] = [
  {
    key: 'enhancementModel',
    get label() {
      return translate('Feature Enhancement');
    },
    get description() {
      return translate('Improves feature names and descriptions');
    },
  },
  {
    key: 'fileDescriptionModel',
    get label() {
      return translate('File Descriptions');
    },
    get description() {
      return translate('Generates descriptions for context files');
    },
  },
  {
    key: 'imageDescriptionModel',
    get label() {
      return translate('Image Descriptions');
    },
    get description() {
      return translate('Analyzes and describes context images');
    },
  },
  {
    key: 'commitMessageModel',
    get label() {
      return translate('Commit Messages');
    },
    get description() {
      return translate('Generates git commit messages from diffs');
    },
  },
];

const VALIDATION_TASKS: PhaseConfig[] = [
  {
    key: 'validationModel',
    get label() {
      return translate('GitHub Issue Validation');
    },
    get description() {
      return translate('Validates and improves GitHub issues');
    },
  },
];

const GENERATION_TASKS: PhaseConfig[] = [
  {
    key: 'specGenerationModel',
    get label() {
      return translate('App Specification');
    },
    get description() {
      return translate('Generates full application specifications');
    },
  },
  {
    key: 'featureGenerationModel',
    get label() {
      return translate('Feature Generation');
    },
    get description() {
      return translate('Creates features from specifications');
    },
  },
  {
    key: 'backlogPlanningModel',
    get label() {
      return translate('Backlog Planning');
    },
    get description() {
      return translate('Reorganizes and prioritizes backlog');
    },
  },
  {
    key: 'projectAnalysisModel',
    get label() {
      return translate('Project Analysis');
    },
    get description() {
      return translate('Analyzes project structure for suggestions');
    },
  },
  {
    key: 'ideationModel',
    get label() {
      return translate('Ideation');
    },
    get description() {
      return translate('Model for ideation view (generating AI suggestions)');
    },
  },
];

const MEMORY_TASKS: PhaseConfig[] = [
  {
    key: 'memoryExtractionModel',
    get label() {
      return translate('Memory Extraction');
    },
    get description() {
      return translate('Extracts learnings from completed agent sessions');
    },
  },
];

function PhaseGroup({
  title,
  subtitle,
  phases,
}: {
  title: string;
  subtitle: string;
  phases: PhaseConfig[];
}) {
  useUiLocale();
  const { phaseModels, setPhaseModel } = useAppStore();

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <div className="space-y-3">
        {phases.map((phase) => (
          <PhaseModelSelector
            key={phase.key}
            label={phase.label}
            description={phase.description}
            value={phaseModels[phase.key] ?? DEFAULT_PHASE_MODELS[phase.key]}
            onChange={(model) => setPhaseModel(phase.key, model)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Default model for new feature cards section.
 * This is separate from phase models but logically belongs with model configuration.
 */
function FeatureDefaultModelSection() {
  useUiLocale();
  const { defaultFeatureModel, setDefaultFeatureModel } = useAppStore();
  const defaultValue: PhaseModelEntry =
    defaultFeatureModel ?? DEFAULT_GLOBAL_SETTINGS.defaultFeatureModel;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">{translate('Feature Defaults')}</h3>
        <p className="text-xs text-muted-foreground">
          {translate('Default model for new feature cards when created')}
        </p>
      </div>
      <div className="space-y-3">
        <PhaseModelSelector
          label={translate('Default Feature Model')}
          description={translate('Model and thinking level used when creating new feature cards')}
          value={defaultValue}
          onChange={setDefaultFeatureModel}
          align="end"
        />
      </div>
    </div>
  );
}

// Thinking level options with descriptions for the settings UI
const THINKING_LEVEL_OPTIONS: { id: ThinkingLevel; label: string; description: string }[] = [
  {
    id: 'none',
    get label() {
      return translate('None');
    },
    get description() {
      return translate('No extended thinking');
    },
  },
  {
    id: 'low',
    get label() {
      return translate('Low');
    },
    get description() {
      return translate('Light reasoning (1k tokens)');
    },
  },
  {
    id: 'medium',
    get label() {
      return translate('Medium');
    },
    get description() {
      return translate('Moderate reasoning (10k tokens)');
    },
  },
  {
    id: 'high',
    get label() {
      return translate('High');
    },
    get description() {
      return translate('Deep reasoning (16k tokens)');
    },
  },
  {
    id: 'ultrathink',
    get label() {
      return translate('Ultra');
    },
    get description() {
      return translate('Maximum reasoning (32k tokens)');
    },
  },
  {
    id: 'adaptive',
    get label() {
      return translate('Adaptive');
    },
    get description() {
      return translate('Model decides reasoning depth');
    },
  },
];

/**
 * Default thinking level / reasoning effort section.
 * These defaults are applied when selecting a model via the primary button
 * in the two-stage model selector (i.e. clicking the model name directly).
 */
function DefaultThinkingLevelSection() {
  useUiLocale();
  const {
    defaultThinkingLevel,
    setDefaultThinkingLevel,
    defaultReasoningEffort,
    setDefaultReasoningEffort,
  } = useAppStore();

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">
          {translate('Quick-Select Defaults')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {translate(
            'Thinking/reasoning level applied when quick-selecting a model from the dropdown. You can always fine-tune per model via the expand arrow.'
          )}
        </p>
      </div>
      <div className="space-y-3">
        {/* Default Thinking Level (Claude models) */}
        <div
          className={cn(
            'flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl',
            'bg-accent/20 border border-border/30',
            'hover:bg-accent/30 transition-colors'
          )}
        >
          <div className="flex items-center gap-3 flex-1">
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0">
              <Brain className="w-4 h-4 text-purple-500" />
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-medium text-foreground">
                {translate('Default Thinking Level')}
              </h4>
              <p className="text-xs text-muted-foreground truncate">
                {translate('Applied to Claude models when quick-selected')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-wrap justify-start sm:justify-end">
            {THINKING_LEVEL_OPTIONS.map((option) => (
              <button
                key={option.id}
                onClick={() => setDefaultThinkingLevel(option.id)}
                className={cn(
                  'px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-lg text-xs font-medium transition-all',
                  'border whitespace-nowrap',
                  defaultThinkingLevel === option.id
                    ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                    : 'bg-background border-border/50 text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
                title={translate(option.description)}
              >
                {translate(option.label)}
              </button>
            ))}
          </div>
        </div>

        {/* Default Reasoning Effort (Codex models) */}
        <div
          className={cn(
            'flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl',
            'bg-accent/20 border border-border/30',
            'hover:bg-accent/30 transition-colors'
          )}
        >
          <div className="flex items-center gap-3 flex-1">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
              <Brain className="w-4 h-4 text-blue-500" />
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-medium text-foreground">
                {translate('Default Reasoning Effort')}
              </h4>
              <p className="text-xs text-muted-foreground truncate">
                {translate('Applied to Codex/OpenAI models when quick-selected')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-wrap justify-start sm:justify-end">
            {REASONING_EFFORT_LEVELS.map((option) => (
              <button
                key={option.id}
                onClick={() => setDefaultReasoningEffort(option.id)}
                className={cn(
                  'px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-lg text-xs font-medium transition-all',
                  'border whitespace-nowrap',
                  defaultReasoningEffort === option.id
                    ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                    : 'bg-background border-border/50 text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
                title={translate(option.description)}
              >
                {translate(option.label)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ModelDefaultsSection() {
  useUiLocale();
  const { resetPhaseModels, claudeCompatibleProviders } = useAppStore();
  const [showBulkReplace, setShowBulkReplace] = useState(false);

  // Check if there are any enabled ClaudeCompatibleProviders
  const hasEnabledProviders =
    claudeCompatibleProviders && claudeCompatibleProviders.some((p) => p.enabled !== false);

  return (
    <div
      className={cn(
        'rounded-2xl overflow-hidden',
        'border border-border/50',
        'bg-gradient-to-br from-card/90 via-card/70 to-card/80 backdrop-blur-xl',
        'shadow-sm shadow-black/5'
      )}
    >
      {/* Header */}
      <div className="p-6 border-b border-border/50 bg-gradient-to-r from-transparent via-accent/5 to-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500/20 to-brand-600/10 flex items-center justify-center border border-brand-500/20">
              <Workflow className="w-5 h-5 text-brand-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground tracking-tight">
                {translate('Model Defaults')}
              </h2>
              <p className="text-sm text-muted-foreground/80">
                {translate('Configure which AI model to use for each application task')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasEnabledProviders && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowBulkReplace(true)}
                className="gap-2"
              >
                <Replace className="w-3.5 h-3.5" />
                {translate('Bulk Replace')}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={resetPhaseModels} className="gap-2">
              <RotateCcw className="w-3.5 h-3.5" />
              {translate('Reset to Defaults')}
            </Button>
          </div>
        </div>
      </div>

      {/* Bulk Replace Dialog */}
      <BulkReplaceDialog open={showBulkReplace} onOpenChange={setShowBulkReplace} />

      {/* Content */}
      <div className="p-6 space-y-8">
        {/* Feature Defaults */}
        <FeatureDefaultModelSection />

        {/* Default Thinking Level / Reasoning Effort */}
        <DefaultThinkingLevelSection />

        {/* Quick Tasks */}
        <PhaseGroup
          title={translate('Quick Tasks')}
          subtitle={translate('Fast models recommended for speed and cost savings')}
          phases={QUICK_TASKS}
        />

        {/* Validation Tasks */}
        <PhaseGroup
          title={translate('Validation Tasks')}
          subtitle={translate('Smart models recommended for accuracy')}
          phases={VALIDATION_TASKS}
        />

        {/* Generation Tasks */}
        <PhaseGroup
          title={translate('Generation Tasks')}
          subtitle={translate('Powerful models recommended for quality output')}
          phases={GENERATION_TASKS}
        />

        {/* Memory Tasks */}
        <PhaseGroup
          title={translate('Memory Tasks')}
          subtitle={translate('Fast models recommended for learning extraction')}
          phases={MEMORY_TASKS}
        />
      </div>
    </div>
  );
}
