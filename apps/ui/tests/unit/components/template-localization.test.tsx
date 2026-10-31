import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_FEATURE_TEMPLATES } from '@automaker/types';
import { TemplatesSection } from '@/components/views/settings-view/templates/templates-section';
import { getUiLocale, setUiLocale } from '@/lib/i18n';

vi.mock('@/store/app-store', () => ({
  useAppStore: (select: (value: unknown) => unknown) =>
    select({ defaultFeatureModel: { model: 'claude-opus' } }),
}));
vi.mock('@/components/views/settings-view/model-defaults/phase-model-selector', () => ({
  PhaseModelSelector: ({ onChange }: { onChange: (value: { model: string }) => void }) => (
    <button onClick={() => onChange({ model: 'claude-sonnet' })}>Change model</button>
  ),
}));
const originalLocale = getUiLocale();
beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
);
afterEach(() => {
  setUiLocale(originalLocale);
  vi.unstubAllGlobals();
});

it('shows localized defaults in the editor while preserving original text when only the model changes', async () => {
  setUiLocale('ru');
  const original = DEFAULT_FEATURE_TEMPLATES[0];
  const update = vi.fn().mockResolvedValue(undefined);
  render(
    <TemplatesSection
      templates={[original]}
      onAddTemplate={vi.fn()}
      onUpdateTemplate={update}
      onDeleteTemplate={vi.fn()}
      onReorderTemplates={vi.fn()}
    />
  );
  const user = userEvent.setup();
  await user.click(screen.getByTestId(`template-actions-${original.id}`));
  await user.click(screen.getByTestId(`template-edit-${original.id}`));
  expect(screen.getByTestId('template-name-input')).toHaveValue(
    'Запустить тесты, линтер и форматирование'
  );
  expect(screen.getByTestId('template-prompt-input')).not.toHaveValue(original.prompt);
  await user.click(screen.getByRole('button', { name: 'Change model' }));
  await user.click(screen.getByRole('button', { name: 'Сохранить изменения' }));
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith(original.id, {
      name: original.name,
      prompt: original.prompt,
      model: { model: 'claude-sonnet' },
    })
  );
});

it('saves an explicitly edited localized prompt without converting the unedited default name into an override', async () => {
  setUiLocale('ru');
  const original = DEFAULT_FEATURE_TEMPLATES[0];
  const update = vi.fn().mockResolvedValue(undefined);
  render(
    <TemplatesSection
      templates={[original]}
      onAddTemplate={vi.fn()}
      onUpdateTemplate={update}
      onDeleteTemplate={vi.fn()}
      onReorderTemplates={vi.fn()}
    />
  );
  const user = userEvent.setup();
  await user.click(screen.getByTestId(`template-actions-${original.id}`));
  await user.click(screen.getByTestId(`template-edit-${original.id}`));
  fireEvent.change(screen.getByTestId('template-prompt-input'), {
    target: { value: 'Мои собственные инструкции' },
  });
  await user.click(screen.getByRole('button', { name: 'Сохранить изменения' }));
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith(original.id, {
      name: original.name,
      prompt: 'Мои собственные инструкции',
      model: undefined,
    })
  );
});
