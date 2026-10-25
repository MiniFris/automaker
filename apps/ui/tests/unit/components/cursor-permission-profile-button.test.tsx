import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CursorPermissionProfileButton } from '@/components/views/settings-view/providers/cursor-permission-profile-button';

const api = vi.hoisted(() => ({ getCursorPermissionsTarget: vi.fn() }));
vi.mock('@/lib/http-api-client', () => ({ getHttpApiClient: () => ({ setup: api }) }));
const target = {
  kind: 'host-cursor-permissions',
  provider: 'cursor',
  scope: 'global',
  configPath: '/backend/profile/cli-config.json',
  instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
  workingDirectory: '/backend',
} as const;
beforeEach(() => {
  api.getCursorPermissionsTarget.mockResolvedValue({ success: true, protocolVersion: 1, target });
});
afterEach(cleanup);

it('shows the actual file and instance; cancellation never applies a profile', async () => {
  const apply = vi.fn();
  render(
    <CursorPermissionProfileButton
      profileId="strict"
      scope="global"
      disabled={false}
      onApply={apply}
    />
  );
  expect(api.getCursorPermissionsTarget).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Apply Globally' }));
  await screen.findByRole('dialog');
  expect(screen.getByTestId('cursor-permissions-target')).toHaveTextContent(target.configPath);
  expect(screen.getByTestId('cursor-permissions-target')).toHaveTextContent(target.instanceId);
  expect(screen.getByText(/not on an SSH or Docker target/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(apply).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('only applies after explicit confirmation and guards repeated confirms', async () => {
  let finish!: () => void;
  const apply = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  render(
    <CursorPermissionProfileButton
      profileId="development"
      scope="global"
      disabled={false}
      onApply={apply}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Apply Globally' }));
  const confirm = await screen.findByRole('button', { name: 'Confirm permission change' });
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(apply).toHaveBeenCalledOnce();
  expect(apply).toHaveBeenCalledWith({ confirmed: true, profileId: 'development', target });
  expect(confirm).toBeDisabled();
  await act(async () => {
    finish();
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('keeps failed confirmation open without silently retrying or changing target', async () => {
  const apply = vi.fn().mockRejectedValue(new Error('target changed'));
  render(
    <CursorPermissionProfileButton
      profileId="strict"
      scope="global"
      disabled={false}
      onApply={apply}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Apply Globally' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm permission change' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Confirm permission change' })).toBeEnabled()
  );
  expect(screen.getByTestId('cursor-permissions-target')).toHaveTextContent(target.configPath);
  expect(apply).toHaveBeenCalledOnce();
});
it('does not apply on failed inspection or accept a preview for another scope', async () => {
  api.getCursorPermissionsTarget.mockResolvedValue({
    success: true,
    target: { ...target, scope: 'project', projectPath: '/wrong' },
  });
  const apply = vi.fn();
  render(
    <CursorPermissionProfileButton
      profileId="strict"
      scope="global"
      disabled={false}
      onApply={apply}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Apply Globally' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Apply Globally' })).toBeEnabled());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(apply).not.toHaveBeenCalled();
});
it('ignores a late preview after the project selection unmounts the button', async () => {
  let finish!: (value: unknown) => void;
  api.getCursorPermissionsTarget.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const apply = vi.fn();
  const { unmount } = render(
    <CursorPermissionProfileButton
      profileId="strict"
      scope="project"
      projectPath="/project"
      disabled={false}
      onApply={apply}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Apply to Project' }));
  unmount();
  await act(async () => {
    finish({ success: true, target: { ...target, scope: 'project', projectPath: '/project' } });
  });
  expect(apply).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
