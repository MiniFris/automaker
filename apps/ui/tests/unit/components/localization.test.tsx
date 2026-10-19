import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { PipelineConfig } from '@automaker/types';
import { ReactFlowProvider } from '@xyflow/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { GraphFilterControls } from '@/components/views/graph-view/components/graph-filter-controls';
import { IssuesFilterControls } from '@/components/views/github-issues-view/components/issues-filter-controls';
import { StatusBadge } from '@/components/views/board-view/components/list-view/status-badge';
import { STEP_TEMPLATES } from '@/components/views/board-view/dialogs/pipeline-step-templates';
import { getColumnsWithPipeline } from '@/components/views/board-view/constants';
import { CLAUDE_MODELS, CURSOR_MODELS } from '@/components/views/board-view/shared/model-constants';
import { BaseModelConfiguration } from '@/components/views/settings-view/providers/shared/base-model-configuration';
import { SubagentCard } from '@/components/views/settings-view/providers/claude-settings-tab/subagent-card';
import { getPipelineStepLabel, getWorkflowStatusLabel } from '@/lib/workflow-labels';
import { formatModelName } from '@/lib/agent-context-parser';
import { useAppStore } from '@/store/app-store';
import { SidebarNavigation } from '@/components/layout/sidebar/components/sidebar-navigation';
import { LanguageSelector } from '@/components/shared/language-selector';
import { ProviderModelTimeoutSettings } from '@/components/shared/model-timeout-settings';
import { SettingsNavigation } from '@/components/views/settings-view/components/settings-navigation';
import { GLOBAL_NAV_ITEMS } from '@/components/views/settings-view/config/navigation';
import { setUiLocale, translate, useLocalizedMemo, useUiLocale } from '@/lib/i18n';

const api = vi.hoisted(() => ({ getProvider: vi.fn(), saveProvider: vi.fn() }));
vi.mock('@/lib/http-api-client', () => ({ getHttpApiClient: () => ({ modelTimeouts: api }) }));
let client: QueryClient;
beforeEach(() => {
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', Observer);
  vi.stubGlobal('IntersectionObserver', Observer);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  setUiLocale('en');
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.getProvider.mockResolvedValue({ success: true, timeouts: { requestTimeoutMs: 120_000 } });
  api.saveProvider.mockImplementation(async (_provider, timeouts) => ({ success: true, timeouts }));
});

async function chooseLanguage(label: string, option: string) {
  const trigger = screen.getByRole('combobox', { name: label });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
afterEach(() => {
  cleanup();
  client.clear();
  setUiLocale('en');
  localStorage.clear();
  vi.unstubAllGlobals();
});

it('switches a real settings form without resetting its draft or collapsed state', async () => {
  render(
    <QueryClientProvider client={client}>
      <LanguageSelector />
      <ProviderModelTimeoutSettings provider="claude" />
    </QueryClientProvider>
  );
  fireEvent.click(screen.getByText('Provider timeouts'));
  const input = await screen.findByLabelText('Request timeout (seconds)');
  fireEvent.change(input, { target: { value: '733' } });
  await chooseLanguage('Interface language', 'Русский');
  expect(screen.getByText('Тайм-ауты провайдера').closest('details')).toHaveAttribute('open');
  expect(screen.getByLabelText('Тайм-аут запроса (сек.)')).toHaveValue(733);
  expect(screen.getByRole('combobox', { name: 'Язык интерфейса' })).toHaveTextContent('Русский');
  expect(document.documentElement.lang).toBe('ru');
  expect(api.getProvider).toHaveBeenCalledTimes(1);
  // Language and labels must never affect provider IDs, setting keys, units or API payloads.
  fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }));
  await waitFor(() =>
    expect(api.saveProvider).toHaveBeenCalledWith('claude', { requestTimeoutMs: 733_000 })
  );
});

it('translates navigation but preserves the route/section identifiers', () => {
  const navigate = vi.fn();
  render(
    <SettingsNavigation
      navItems={GLOBAL_NAV_ITEMS}
      activeSection="appearance"
      currentProject={null}
      onNavigate={navigate}
    />
  );
  act(() => setUiLocale('ru'));
  fireEvent.click(screen.getByRole('button', { name: 'Внешний вид' }));
  expect(navigate).toHaveBeenCalledWith('appearance');
  expect(screen.queryByRole('button', { name: 'Appearance' })).not.toBeInTheDocument();
  act(() => setUiLocale('en'));
  expect(screen.getByRole('button', { name: 'Appearance' })).toBeInTheDocument();
});

it('invalidates localized memos while retaining local state and user-provided text', () => {
  const mount = vi.fn();
  function Example() {
    useUiLocale();
    const [draft, setDraft] = useState(() => {
      mount();
      return 'Save';
    });
    const label = useLocalizedMemo(() => translate('Settings'), []);
    return (
      <>
        <h1>{label}</h1>
        <input aria-label="User text" value={draft} onChange={(e) => setDraft(e.target.value)} />
      </>
    );
  }
  render(<Example />);
  fireEvent.change(screen.getByLabelText('User text'), {
    target: { value: 'Project {value1} Docker' },
  });
  act(() => setUiLocale('ru'));
  expect(screen.getByRole('heading', { name: 'Настройки' })).toBeInTheDocument();
  expect(screen.getByLabelText('User text')).toHaveValue('Project {value1} Docker');
  expect(mount).toHaveBeenCalledTimes(1);
});

it('restores the saved selector value on a fresh settings mount', async () => {
  const view = render(<LanguageSelector />);
  await chooseLanguage('Interface language', 'Русский');
  view.unmount();
  render(<LanguageSelector />);
  expect(screen.getByRole('combobox', { name: 'Язык интерфейса' })).toHaveTextContent('Русский');
  expect(localStorage.getItem('automaker-ui-locale')).toBe('ru');
});

it('preserves model, agent and project names even when they match translated UI keys', () => {
  const models = [{ id: 'custom', label: 'Save', description: 'Description' }];
  const labels = [...CLAUDE_MODELS, ...CURSOR_MODELS].map((model) => model.label);
  render(
    <>
      <BaseModelConfiguration
        providerName="Test"
        icon={null}
        iconGradient=""
        iconBorder=""
        models={models}
        enabledModels={['custom']}
        defaultModel="custom"
        isSaving={false}
        onDefaultModelChange={vi.fn()}
        onModelToggle={vi.fn()}
      />
      <SubagentCard
        agent={{
          name: 'Documentation',
          definition: { description: 'My agent', prompt: 'Do not translate', model: 'sonnet' },
          scope: 'project',
          type: 'filesystem',
          source: 'project',
          filePath: '/test/agent.md',
        }}
      />
      <SidebarNavigation
        currentProject={{ id: 'test', name: 'Settings', path: '/test' }}
        sidebarOpen
        sidebarStyle="discord"
        navSections={[]}
        isActiveRoute={() => false}
        navigate={vi.fn()}
      />
    </>
  );
  act(() => setUiLocale('ru'));
  expect(screen.getAllByText('Save').length).toBeGreaterThan(0);
  expect(screen.getByText('Documentation')).toBeInTheDocument();
  expect(screen.getByText('Settings')).toBeInTheDocument();
  expect([...CLAUDE_MODELS, ...CURSOR_MODELS].map((model) => model.label)).toEqual(labels);
  expect(formatModelName('claude-haiku')).toBe('Haiku 4.5');
  expect(formatModelName('claude-opus')).toBe('Opus 4.6');
  expect(models[0].label).toBe('Save');
});

it('translates every built-in pipeline template without rewriting its configuration', () => {
  const pipeline: PipelineConfig = {
    version: 1,
    steps: STEP_TEMPLATES.map((step, order) => ({ ...step, order, createdAt: '', updatedAt: '' })),
  };
  const original = JSON.stringify(pipeline);
  render(<StatusBadge status="pipeline_code-review" pipelineConfig={pipeline} />);
  expect(screen.getByText('Code Review')).toBeInTheDocument();
  act(() => setUiLocale('ru'));
  expect(screen.getByText('Проверка кода')).toBeInTheDocument();
  const expected = [
    'Проверка кода',
    'Проверка безопасности',
    'Пользовательский опыт',
    'Тестирование',
    'Документация',
    'Производительность',
    'Создать коммит',
  ];
  expect(STEP_TEMPLATES.map((step) => getPipelineStepLabel(step.name))).toEqual(expected);
  const columns = getColumnsWithPipeline(pipeline);
  for (const title of expected) expect(columns.some((column) => column.title === title)).toBe(true);
  expect(getPipelineStepLabel('My custom stage')).toBe('My custom stage');
  expect(getWorkflowStatusLabel('waiting_approval')).toBe(translate('Waiting Approval'));
  expect(JSON.stringify(pipeline)).toBe(original);
  act(() => setUiLocale('en'));
  expect(screen.getByText('Code Review')).toBeInTheDocument();
});

it('localizes graph filter controls while preserving category names and status IDs', () => {
  const onStatusesChange = vi.fn();
  const props = {
    filterState: {
      selectedCategories: [] as string[],
      selectedStatuses: [] as string[],
      isNegativeFilter: false,
    },
    availableCategories: ['Save'],
    hasActiveFilter: false,
    searchQuery: '',
    onSearchQueryChange: vi.fn(),
    onCategoriesChange: vi.fn(),
    onStatusesChange,
    onNegativeFilterChange: vi.fn(),
    onClearFilters: vi.fn(),
  };
  const view = (filterState = props.filterState) => (
    <ReactFlowProvider>
      <TooltipProvider>
        <GraphFilterControls {...props} filterState={filterState} />
      </TooltipProvider>
    </ReactFlowProvider>
  );
  const { rerender } = render(view());
  act(() => setUiLocale('ru'));
  expect(screen.getByText('Все категории')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Все статусы'));
  fireEvent.click(screen.getByText(translate('Running')));
  expect(onStatusesChange).toHaveBeenCalledWith(['running']);
  rerender(
    view({
      selectedCategories: ['Save'],
      selectedStatuses: ['running', 'paused'],
      isNegativeFilter: false,
    })
  );
  expect(screen.getByText('Save')).toBeInTheDocument();
  expect(screen.getByText('Статусов: 2')).toBeInTheDocument();
  act(() => setUiLocale('en'));
  expect(screen.getByText('Statuses: 2')).toBeInTheDocument();
});

it('uses status-specific issue filter labels and preserves API values', async () => {
  const change = vi.fn();
  render(
    <IssuesFilterControls
      stateFilter="open"
      selectedLabels={[]}
      availableLabels={[]}
      onStateFilterChange={change}
      onLabelsChange={vi.fn()}
    />
  );
  act(() => setUiLocale('ru'));
  const trigger = screen.getByRole('combobox');
  expect(trigger).toHaveTextContent('Открытые');
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: 'Закрытые' }));
  expect(change).toHaveBeenCalledWith('closed');
});

it('uses the shared Select for compact and normal controls with independent labels', async () => {
  render(
    <>
      <LanguageSelector />
      <LanguageSelector compact />
    </>
  );
  const triggers = screen.getAllByRole('combobox', { name: 'Interface language' });
  expect(triggers).toHaveLength(2);
  expect(triggers[0].tagName).toBe('BUTTON');
  expect(triggers[1].tagName).toBe('BUTTON');
  expect(triggers[0].id).not.toBe(triggers[1].id);
  fireEvent.keyDown(triggers[1], { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: 'Русский' }));
  for (const trigger of screen.getAllByRole('combobox', { name: 'Язык интерфейса' })) {
    expect(trigger).toHaveTextContent('Русский');
  }
  fireEvent.keyDown(triggers[0], { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: 'English' }));
  expect(localStorage.getItem('automaker-ui-locale')).toBe('en');
});

it('translates sidebar group headings without changing persisted collapse keys', () => {
  const previous = useAppStore.getState().collapsedNavSections;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  try {
    useAppStore.setState({ collapsedNavSections: { Project: false, Tools: false } });
    render(
      <SidebarNavigation
        currentProject={{ id: 'test', name: 'Save', path: '/test' }}
        sidebarOpen
        sidebarStyle="unified"
        navSections={[
          { label: 'Project', collapsible: true, items: [] },
          { label: 'Tools', collapsible: true, items: [] },
        ]}
        isActiveRoute={() => false}
        navigate={vi.fn()}
      />
    );
    act(() => setUiLocale('ru'));
    expect(screen.getByRole('button', { name: 'Проект' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Инструменты' }));
    expect(useAppStore.getState().collapsedNavSections).toEqual({ Project: false, Tools: true });
    act(() => setUiLocale('en'));
    expect(screen.getByRole('button', { name: 'Tools' })).toBeInTheDocument();
  } finally {
    cleanup();
    useAppStore.setState({ collapsedNavSections: previous });
    vi.unstubAllGlobals();
  }
});
