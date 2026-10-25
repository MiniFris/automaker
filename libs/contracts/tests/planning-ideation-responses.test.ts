import { expect, it } from 'vitest';
import {
  PlanningAcceptedResponseSchema,
  PlanningSuccessResponseSchema,
  AppSpecStatusResponseSchema,
  BacklogStatusResponseSchema,
  BacklogApplyResponseSchema,
} from '../src/domains/planning-responses.js';
import {
  IdeationSessionStartResponseSchema,
  IdeationSessionReadResponseSchema,
  IdeationIdeaListResponseSchema,
  IdeationIdeaResponseSchema,
  IdeationAnalysisResponseSchema,
  IdeationPromptsResponseSchema,
  IdeationCategoryPromptsResponseSchema,
  IdeationSuggestionsResponseSchema,
  IdeationFeatureResponseSchema,
} from '../src/domains/ideation-responses.js';

it('covers accepted/false planning replies and global/scoped active job metadata', () => {
  for (const value of [
    { success: true, extra: 'kept' },
    { success: false, error: 'Already running', extra: null },
  ])
    expect(PlanningAcceptedResponseSchema.parse(value)).toEqual(value);
  for (const value of [
    { success: true, isRunning: false },
    { success: true, isRunning: true },
    {
      success: true,
      isRunning: true,
      projectPath: '/project',
      type: 'sync',
      startedAt: 'owned timestamp',
    },
  ])
    expect(AppSpecStatusResponseSchema.parse(value)).toEqual(value);
  expect(PlanningSuccessResponseSchema.safeParse({ success: false }).success).toBe(false);
  expect(PlanningAcceptedResponseSchema.safeParse({ success: false }).success).toBe(false);
  expect(AppSpecStatusResponseSchema.safeParse({ success: true, isRunning: 'yes' }).success).toBe(
    false
  );
});

it('preserves minimally guarded saved backlog plans and raw applied labels', () => {
  const savedPlan = {
    savedAt: null,
    prompt: 4,
    model: null,
    extra: ['legacy'],
    result: {
      changes: ['legacy change', { custom: true }],
      summary: null,
      dependencyUpdates: null,
      future: true,
    },
  };
  expect(
    BacklogStatusResponseSchema.parse({ success: true, isRunning: false, savedPlan }).savedPlan
  ).toEqual(savedPlan);
  BacklogStatusResponseSchema.parse({ success: true, isRunning: true, savedPlan: null });
  expect(
    BacklogApplyResponseSchema.parse({
      success: true,
      appliedChanges: ['opaque:[]', 'legacy unprefixed label'],
    }).appliedChanges
  ).toHaveLength(2);
  expect(
    BacklogStatusResponseSchema.safeParse({
      success: true,
      isRunning: false,
      savedPlan: { result: { changes: null } },
    }).success
  ).toBe(false);
});

it('distinguishes owned session creation metadata from extensible legacy session/message data', () => {
  IdeationSessionStartResponseSchema.parse({
    success: true,
    session: {
      id: 'opaque:[]',
      projectPath: '/project',
      status: 'active',
      createdAt: 'timestamp',
      updatedAt: 'timestamp',
      extra: true,
    },
  });
  const messages = [
    { id: 4, role: 'legacy raw role', content: { old: true }, timestamp: null, extra: ['kept'] },
  ];
  const value = {
    success: true,
    session: {
      id: 'opaque',
      isRunning: false,
      status: null,
      createdAt: null,
      updatedAt: 4,
      messages,
      extra: true,
    },
    messages,
  };
  expect(IdeationSessionReadResponseSchema.parse(value)).toEqual(value);
  expect(
    IdeationSessionReadResponseSchema.safeParse({
      success: true,
      session: { isRunning: 'yes', messages: [] },
      messages: [],
    }).success
  ).toBe(false);
});

it('preserves idea/analysis extensions and raw suggestion labels while checking actual envelopes', () => {
  const idea = {
    id: 'opaque',
    title: { legacy: true },
    category: 'raw category',
    status: null,
    createdAt: 4,
    updatedAt: null,
    extra: ['kept'],
  };
  expect(IdeationIdeaResponseSchema.parse({ success: true, idea }).idea).toEqual(idea);
  expect(IdeationIdeaListResponseSchema.parse({ success: true, ideas: [idea] }).ideas).toEqual([
    idea,
  ]);
  for (const result of [null, { analyzedAt: null, custom: true }])
    expect(IdeationAnalysisResponseSchema.parse({ success: true, result }).result).toEqual(result);
  const suggestion = {
    id: 'opaque',
    category: 'raw category',
    title: { legacy: true },
    priority: 'legacy priority',
    relatedFiles: null,
    extra: true,
  };
  expect(
    IdeationSuggestionsResponseSchema.parse({ success: true, suggestions: [suggestion] })
      .suggestions[0]
  ).toEqual(suggestion);
  IdeationFeatureResponseSchema.parse({ success: true, featureId: 'opaque : / []' });
  expect(IdeationIdeaListResponseSchema.safeParse({ success: true, ideas: {} }).success).toBe(
    false
  );
});

it('types owned prompt catalogs without narrowing category labels', () => {
  const prompts = [
    {
      id: 'opaque',
      category: 'future category',
      title: 'Title',
      description: '',
      prompt: 'Text',
      extra: true,
    },
  ];
  IdeationCategoryPromptsResponseSchema.parse({ success: true, prompts });
  const value = {
    success: true,
    prompts,
    categories: [
      { id: 'future category', name: 'Future', icon: 'Icon', description: '', extra: true },
    ],
  };
  expect(IdeationPromptsResponseSchema.parse(value)).toEqual(value);
  expect(
    IdeationPromptsResponseSchema.safeParse({ success: true, prompts: [{}], categories: [] })
      .success
  ).toBe(false);
});
