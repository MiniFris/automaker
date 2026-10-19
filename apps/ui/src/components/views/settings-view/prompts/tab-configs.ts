import { translate } from '@/lib/i18n';
import {
  MessageSquareText,
  Bot,
  KanbanSquare,
  Sparkles,
  GitCommitHorizontal,
  Type,
  CheckCircle,
  Lightbulb,
  FileCode,
  FileText,
  Wand2,
  Cog,
} from 'lucide-react';
import {
  DEFAULT_AUTO_MODE_PROMPTS,
  DEFAULT_AGENT_PROMPTS,
  DEFAULT_BACKLOG_PLAN_PROMPTS,
  DEFAULT_ENHANCEMENT_PROMPTS,
  DEFAULT_COMMIT_MESSAGE_PROMPTS,
  DEFAULT_TITLE_GENERATION_PROMPTS,
  DEFAULT_ISSUE_VALIDATION_PROMPTS,
  DEFAULT_IDEATION_PROMPTS,
  DEFAULT_APP_SPEC_PROMPTS,
  DEFAULT_CONTEXT_DESCRIPTION_PROMPTS,
  DEFAULT_SUGGESTIONS_PROMPTS,
  DEFAULT_TASK_EXECUTION_PROMPTS,
} from '@automaker/prompts';
import type { TabConfig } from './types';

/**
 * Configuration for all prompt customization tabs.
 * Each tab defines its fields, banners, and optional sections.
 */
export const TAB_CONFIGS: TabConfig[] = [
  {
    id: 'auto-mode',
    get label() {
      return translate('Auto Mode');
    },
    icon: Bot,
    get title() {
      return translate('Auto Mode Prompts');
    },
    category: 'autoMode',
    banner: {
      type: 'info',
      get title() {
        return translate('Planning Mode Markers');
      },
      get description() {
        return translate(
          'Planning prompts use special markers like [PLAN_GENERATED] and [SPEC_GENERATED] to control the Auto Mode workflow. These markers must be preserved for proper functionality.'
        );
      },
    },
    fields: [
      {
        key: 'planningLite',
        get label() {
          return translate('Planning: Lite Mode');
        },
        get description() {
          return translate('Quick planning outline without approval requirement');
        },
        defaultValue: DEFAULT_AUTO_MODE_PROMPTS.planningLite,
        critical: true,
      },
      {
        key: 'planningLiteWithApproval',
        get label() {
          return translate('Planning: Lite with Approval');
        },
        get description() {
          return translate('Planning outline that waits for user approval');
        },
        defaultValue: DEFAULT_AUTO_MODE_PROMPTS.planningLiteWithApproval,
        critical: true,
      },
      {
        key: 'planningSpec',
        get label() {
          return translate('Planning: Spec Mode');
        },
        get description() {
          return translate('Detailed specification with task breakdown');
        },
        defaultValue: DEFAULT_AUTO_MODE_PROMPTS.planningSpec,
        critical: true,
      },
      {
        key: 'planningFull',
        get label() {
          return translate('Planning: Full SDD Mode');
        },
        get description() {
          return translate('Comprehensive Software Design Document with phased implementation');
        },
        defaultValue: DEFAULT_AUTO_MODE_PROMPTS.planningFull,
        critical: true,
      },
    ],
    sections: [
      {
        get title() {
          return translate('Template Prompts');
        },
        banner: {
          type: 'info',
          get title() {
            return translate('Template Variables');
          },
          get description() {
            return translate(
              'Template prompts use Handlebars syntax for variable substitution. Available variables include {{featureId}}, {{title}}, {{description}}, etc.'
            );
          },
        },
        fields: [
          {
            key: 'featurePromptTemplate',
            get label() {
              return translate('Feature Prompt Template');
            },
            get description() {
              return translate(
                'Template for building feature implementation prompts. Variables: featureId, title, description, spec, imagePaths, dependencies, verificationInstructions'
              );
            },
            defaultValue: DEFAULT_AUTO_MODE_PROMPTS.featurePromptTemplate,
          },
          {
            key: 'followUpPromptTemplate',
            get label() {
              return translate('Follow-up Prompt Template');
            },
            get description() {
              return translate(
                'Template for follow-up prompts when resuming work. Variables: featurePrompt, previousContext, followUpInstructions'
              );
            },
            defaultValue: DEFAULT_AUTO_MODE_PROMPTS.followUpPromptTemplate,
          },
          {
            key: 'continuationPromptTemplate',
            get label() {
              return translate('Continuation Prompt Template');
            },
            get description() {
              return translate(
                'Template for continuation prompts. Variables: featurePrompt, previousContext'
              );
            },
            defaultValue: DEFAULT_AUTO_MODE_PROMPTS.continuationPromptTemplate,
          },
          {
            key: 'pipelineStepPromptTemplate',
            get label() {
              return translate('Pipeline Step Prompt Template');
            },
            get description() {
              return translate(
                'Template for pipeline step execution prompts. Variables: stepName, featurePrompt, previousContext, stepInstructions'
              );
            },
            defaultValue: DEFAULT_AUTO_MODE_PROMPTS.pipelineStepPromptTemplate,
          },
        ],
      },
    ],
  },
  {
    id: 'agent',
    get label() {
      return translate('Agent');
    },
    icon: MessageSquareText,
    get title() {
      return translate('Agent Runner Prompts');
    },
    category: 'agent',
    fields: [
      {
        key: 'systemPrompt',
        get label() {
          return translate('System Prompt');
        },
        get description() {
          return translate("Defines the AI's role and behavior in interactive chat sessions");
        },
        defaultValue: DEFAULT_AGENT_PROMPTS.systemPrompt,
      },
    ],
  },
  {
    id: 'backlog-plan',
    get label() {
      return translate('Backlog');
    },
    icon: KanbanSquare,
    get title() {
      return translate('Backlog Planning Prompts');
    },
    category: 'backlogPlan',
    banner: {
      type: 'warning',
      get title() {
        return translate('Warning: Critical Prompts');
      },
      get description() {
        return translate(
          'Backlog plan prompts require a strict JSON output format. Modifying these prompts incorrectly can break the backlog planning feature and potentially corrupt your feature data. Only customize if you fully understand the expected output structure.'
        );
      },
    },
    fields: [
      {
        key: 'systemPrompt',
        get label() {
          return translate('System Prompt');
        },
        get description() {
          return translate(
            'Defines how the AI modifies the feature backlog (Plan button on Kanban board)'
          );
        },
        defaultValue: DEFAULT_BACKLOG_PLAN_PROMPTS.systemPrompt,
        critical: true,
      },
      {
        key: 'userPromptTemplate',
        get label() {
          return translate('User Prompt Template');
        },
        get description() {
          return translate(
            'Template for the user prompt sent to the AI. Variables: currentFeatures, userRequest'
          );
        },
        defaultValue: DEFAULT_BACKLOG_PLAN_PROMPTS.userPromptTemplate,
        critical: true,
      },
    ],
  },
  {
    id: 'enhancement',
    get label() {
      return translate('Enhancement');
    },
    icon: Sparkles,
    get title() {
      return translate('Enhancement Prompts');
    },
    category: 'enhancement',
    fields: [
      {
        key: 'improveSystemPrompt',
        get label() {
          return translate('Improve Mode');
        },
        get description() {
          return translate('Transform vague requests into clear, actionable tasks');
        },
        defaultValue: DEFAULT_ENHANCEMENT_PROMPTS.improveSystemPrompt,
      },
      {
        key: 'technicalSystemPrompt',
        get label() {
          return translate('Technical Mode');
        },
        get description() {
          return translate('Add implementation details and technical specifications');
        },
        defaultValue: DEFAULT_ENHANCEMENT_PROMPTS.technicalSystemPrompt,
      },
      {
        key: 'simplifySystemPrompt',
        get label() {
          return translate('Simplify Mode');
        },
        get description() {
          return translate('Make verbose descriptions concise and focused');
        },
        defaultValue: DEFAULT_ENHANCEMENT_PROMPTS.simplifySystemPrompt,
      },
      {
        key: 'acceptanceSystemPrompt',
        get label() {
          return translate('Acceptance Criteria Mode');
        },
        get description() {
          return translate('Add testable acceptance criteria to descriptions');
        },
        defaultValue: DEFAULT_ENHANCEMENT_PROMPTS.acceptanceSystemPrompt,
      },
      {
        key: 'uxReviewerSystemPrompt',
        get label() {
          return translate('User Experience Mode');
        },
        get description() {
          return translate('Review and enhance from a user experience and design perspective');
        },
        defaultValue: DEFAULT_ENHANCEMENT_PROMPTS.uxReviewerSystemPrompt,
      },
    ],
  },
  {
    id: 'commit-message',
    get label() {
      return translate('Commit');
    },
    icon: GitCommitHorizontal,
    get title() {
      return translate('Commit Message Prompts');
    },
    category: 'commitMessage',
    fields: [
      {
        key: 'systemPrompt',
        get label() {
          return translate('System Prompt');
        },
        get description() {
          return translate(
            'Instructions for generating git commit messages from diffs. The AI will receive the git diff and generate a conventional commit message.'
          );
        },
        defaultValue: DEFAULT_COMMIT_MESSAGE_PROMPTS.systemPrompt,
      },
    ],
  },
  {
    id: 'title-generation',
    get label() {
      return translate('Title');
    },
    icon: Type,
    get title() {
      return translate('Title Generation Prompts');
    },
    category: 'titleGeneration',
    fields: [
      {
        key: 'systemPrompt',
        get label() {
          return translate('System Prompt');
        },
        get description() {
          return translate(
            'Instructions for generating concise, descriptive feature titles from descriptions. Used when auto-generating titles for new features.'
          );
        },
        defaultValue: DEFAULT_TITLE_GENERATION_PROMPTS.systemPrompt,
      },
    ],
  },
  {
    id: 'issue-validation',
    get label() {
      return translate('Issues');
    },
    icon: CheckCircle,
    get title() {
      return translate('Issue Validation Prompts');
    },
    category: 'issueValidation',
    banner: {
      type: 'warning',
      get title() {
        return translate('Warning: Critical Prompt');
      },
      get description() {
        return translate(
          'The issue validation prompt guides the AI through a structured validation process and expects specific output format. Modifying this prompt incorrectly may affect validation accuracy.'
        );
      },
    },
    fields: [
      {
        key: 'systemPrompt',
        get label() {
          return translate('System Prompt');
        },
        get description() {
          return translate(
            'Instructions for validating GitHub issues against the codebase. Guides the AI to determine if issues are valid, invalid, or need clarification.'
          );
        },
        defaultValue: DEFAULT_ISSUE_VALIDATION_PROMPTS.systemPrompt,
        critical: true,
      },
    ],
  },
  {
    id: 'ideation',
    get label() {
      return translate('Ideation');
    },
    icon: Lightbulb,
    get title() {
      return translate('Ideation Prompts');
    },
    category: 'ideation',
    fields: [
      {
        key: 'ideationSystemPrompt',
        get label() {
          return translate('Ideation Chat System Prompt');
        },
        get description() {
          return translate(
            'System prompt for AI-powered ideation chat conversations. Guides the AI to brainstorm and suggest feature ideas.'
          );
        },
        defaultValue: DEFAULT_IDEATION_PROMPTS.ideationSystemPrompt,
      },
      {
        key: 'suggestionsSystemPrompt',
        get label() {
          return translate('Suggestions System Prompt');
        },
        get description() {
          return translate(
            'System prompt for generating structured feature suggestions. Used when generating batch suggestions from prompts.'
          );
        },
        defaultValue: DEFAULT_IDEATION_PROMPTS.suggestionsSystemPrompt,
        critical: true,
      },
    ],
  },
  {
    id: 'app-spec',
    get label() {
      return translate('App Spec');
    },
    icon: FileCode,
    get title() {
      return translate('App Specification Prompts');
    },
    category: 'appSpec',
    fields: [
      {
        key: 'generateSpecSystemPrompt',
        get label() {
          return translate('Generate Spec System Prompt');
        },
        get description() {
          return translate('System prompt for generating project specifications from overview');
        },
        defaultValue: DEFAULT_APP_SPEC_PROMPTS.generateSpecSystemPrompt,
      },
      {
        key: 'structuredSpecInstructions',
        get label() {
          return translate('Structured Spec Instructions');
        },
        get description() {
          return translate('Instructions for structured specification output format');
        },
        defaultValue: DEFAULT_APP_SPEC_PROMPTS.structuredSpecInstructions,
        critical: true,
      },
      {
        key: 'generateFeaturesFromSpecPrompt',
        get label() {
          return translate('Generate Features from Spec');
        },
        get description() {
          return translate('Prompt for generating features from a project specification');
        },
        defaultValue: DEFAULT_APP_SPEC_PROMPTS.generateFeaturesFromSpecPrompt,
        critical: true,
      },
    ],
  },
  {
    id: 'context-description',
    get label() {
      return translate('Context');
    },
    icon: FileText,
    get title() {
      return translate('Context Description Prompts');
    },
    category: 'contextDescription',
    fields: [
      {
        key: 'describeFilePrompt',
        get label() {
          return translate('Describe File Prompt');
        },
        get description() {
          return translate('Prompt for generating descriptions of text files added as context');
        },
        defaultValue: DEFAULT_CONTEXT_DESCRIPTION_PROMPTS.describeFilePrompt,
      },
      {
        key: 'describeImagePrompt',
        get label() {
          return translate('Describe Image Prompt');
        },
        get description() {
          return translate('Prompt for generating descriptions of images added as context');
        },
        defaultValue: DEFAULT_CONTEXT_DESCRIPTION_PROMPTS.describeImagePrompt,
      },
    ],
  },
  {
    id: 'suggestions',
    get label() {
      return translate('Suggestions');
    },
    icon: Wand2,
    get title() {
      return translate('Suggestions Prompts');
    },
    category: 'suggestions',
    fields: [
      {
        key: 'featuresPrompt',
        get label() {
          return translate('Features Suggestion Prompt');
        },
        get description() {
          return translate('Prompt for analyzing the project and suggesting new features');
        },
        defaultValue: DEFAULT_SUGGESTIONS_PROMPTS.featuresPrompt,
      },
      {
        key: 'refactoringPrompt',
        get label() {
          return translate('Refactoring Suggestion Prompt');
        },
        get description() {
          return translate('Prompt for identifying refactoring opportunities');
        },
        defaultValue: DEFAULT_SUGGESTIONS_PROMPTS.refactoringPrompt,
      },
      {
        key: 'securityPrompt',
        get label() {
          return translate('Security Suggestion Prompt');
        },
        get description() {
          return translate('Prompt for analyzing security vulnerabilities');
        },
        defaultValue: DEFAULT_SUGGESTIONS_PROMPTS.securityPrompt,
      },
      {
        key: 'performancePrompt',
        get label() {
          return translate('Performance Suggestion Prompt');
        },
        get description() {
          return translate('Prompt for identifying performance issues');
        },
        defaultValue: DEFAULT_SUGGESTIONS_PROMPTS.performancePrompt,
      },
      {
        key: 'baseTemplate',
        get label() {
          return translate('Base Template');
        },
        get description() {
          return translate('Base template applied to all suggestion types');
        },
        defaultValue: DEFAULT_SUGGESTIONS_PROMPTS.baseTemplate,
      },
    ],
  },
  {
    id: 'task-execution',
    get label() {
      return translate('Tasks');
    },
    icon: Cog,
    get title() {
      return translate('Task Execution Prompts');
    },
    category: 'taskExecution',
    banner: {
      type: 'info',
      get title() {
        return translate('Template Variables');
      },
      get description() {
        return translate(
          'Task execution prompts use Handlebars syntax for variable substitution. Variables include {{taskId}}, {{taskDescription}}, {{completedTasks}}, etc.'
        );
      },
    },
    fields: [
      {
        key: 'taskPromptTemplate',
        get label() {
          return translate('Task Prompt Template');
        },
        get description() {
          return translate('Template for building individual task execution prompts');
        },
        defaultValue: DEFAULT_TASK_EXECUTION_PROMPTS.taskPromptTemplate,
      },
      {
        key: 'implementationInstructions',
        get label() {
          return translate('Implementation Instructions');
        },
        get description() {
          return translate('Instructions appended to feature implementation prompts');
        },
        defaultValue: DEFAULT_TASK_EXECUTION_PROMPTS.implementationInstructions,
      },
      {
        key: 'playwrightVerificationInstructions',
        get label() {
          return translate('Playwright Verification Instructions');
        },
        get description() {
          return translate('Instructions for automated Playwright verification (when enabled)');
        },
        defaultValue: DEFAULT_TASK_EXECUTION_PROMPTS.playwrightVerificationInstructions,
      },
      {
        key: 'learningExtractionSystemPrompt',
        get label() {
          return translate('Learning Extraction System Prompt');
        },
        get description() {
          return translate(
            'System prompt for extracting learnings/ADRs from implementation output'
          );
        },
        defaultValue: DEFAULT_TASK_EXECUTION_PROMPTS.learningExtractionSystemPrompt,
        critical: true,
      },
      {
        key: 'learningExtractionUserPromptTemplate',
        get label() {
          return translate('Learning Extraction User Template');
        },
        get description() {
          return translate(
            'User prompt template for learning extraction. Variables: featureTitle, implementationLog'
          );
        },
        defaultValue: DEFAULT_TASK_EXECUTION_PROMPTS.learningExtractionUserPromptTemplate,
        critical: true,
      },
      {
        key: 'planRevisionTemplate',
        get label() {
          return translate('Plan Revision Template');
        },
        get description() {
          return translate(
            'Template for prompting plan revisions. Variables: planVersion, previousPlan, userFeedback'
          );
        },
        defaultValue: DEFAULT_TASK_EXECUTION_PROMPTS.planRevisionTemplate,
      },
      {
        key: 'continuationAfterApprovalTemplate',
        get label() {
          return translate('Continuation After Approval Template');
        },
        get description() {
          return translate(
            'Template for continuation after plan approval. Variables: userFeedback, approvedPlan'
          );
        },
        defaultValue: DEFAULT_TASK_EXECUTION_PROMPTS.continuationAfterApprovalTemplate,
      },
      {
        key: 'resumeFeatureTemplate',
        get label() {
          return translate('Resume Feature Template');
        },
        get description() {
          return translate(
            'Template for resuming interrupted features. Variables: featurePrompt, previousContext'
          );
        },
        defaultValue: DEFAULT_TASK_EXECUTION_PROMPTS.resumeFeatureTemplate,
      },
      {
        key: 'projectAnalysisPrompt',
        get label() {
          return translate('Project Analysis Prompt');
        },
        get description() {
          return translate('Prompt for AI-powered project analysis');
        },
        defaultValue: DEFAULT_TASK_EXECUTION_PROMPTS.projectAnalysisPrompt,
      },
    ],
  },
];
