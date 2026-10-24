import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CliInstallationCard } from '@/components/views/setup-view/components/cli-installation-card';

afterEach(cleanup);
it('labels the action as guidance and keeps instructions visible after loading', () => {
  const onInstall = vi.fn();
  const props = { cliName: 'Codex', description: 'CLI setup', commands: [], onInstall };
  const { rerender } = render(
    <CliInstallationCard {...props} isInstalling={true} installProgress={{ output: [] }} />
  );
  expect(screen.getByRole('button', { name: 'Loading instructions...' })).toBeDisabled();
  rerender(
    <CliInstallationCard
      {...props}
      isInstalling={false}
      installProgress={{ output: ['No installer was run.', 'npm install -g @openai/codex'] }}
    />
  );
  expect(screen.getByText('No installer was run.')).toBeVisible();
  expect(screen.getByText('npm install -g @openai/codex')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Show installation instructions' }));
  expect(onInstall).toHaveBeenCalledOnce();
  expect(screen.queryByText('Auto Install')).not.toBeInTheDocument();
});
