import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectSettingsView } from '@/components/views/project-settings-view/project-settings-view';

const mocks = vi.hoisted(() => ({
  inspect: vi.fn(),
  section: 'identity',
  currentProject: { id: 'project-a', name: 'Project A', path: '/project-a' } as {
    id: string;
    name: string;
    path: string;
  } | null,
}));
vi.mock('@tanstack/react-router', () => ({ useSearch: () => ({ section: mocks.section }) }));
vi.mock('@/store/app-store', () => ({
  useAppStore: () => ({ currentProject: mocks.currentProject }),
}));
vi.mock('@/lib/http-api-client', () => ({
  getHttpApiClient: () => ({ executionEnvironments: { inspect: mocks.inspect } }),
}));
vi.mock('@/components/views/project-settings-view/project-identity-section', () => ({
  ProjectIdentitySection: () => <p>Project identity</p>,
}));

describe('execution environment in actual Project Settings navigation', () => {
  let client: QueryClient;
  beforeEach(() => {
    mocks.section = 'identity';
    mocks.currentProject = { id: 'project-a', name: 'Project A', path: '/project-a' };
    mocks.inspect.mockResolvedValue({
      success: true,
      settings: { default: { mode: 'local' }, profiles: [] },
      projectOverride: null,
      resolved: {
        selection: { mode: 'local' },
        type: 'local',
        source: 'global',
        runtimeIntegrated: false,
      },
    });
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => {
    cleanup();
    client.clear();
  });
  function open() {
    render(
      <QueryClientProvider client={client}>
        <ProjectSettingsView />
      </QueryClientProvider>
    );
  }
  it('opens the shared editor with the current project path', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Execution Environment' }));
    expect(await screen.findByLabelText('Project execution environment')).toHaveValue('inherit');
    expect(mocks.inspect).toHaveBeenCalledWith('/project-a');
  });
  it('supports a direct link to the environment section', async () => {
    mocks.section = 'execution-environment';
    open();
    expect(await screen.findByLabelText('Project execution environment')).toHaveValue('inherit');
  });
  it('does not query project settings when no project is selected', () => {
    mocks.currentProject = null;
    open();
    expect(screen.getByText('No Project Selected')).toBeInTheDocument();
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
});
