import { fireEvent, screen } from '@testing-library/react';
import { vi } from 'vitest';

export function setupSelectMocks() {
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', Observer);
  HTMLElement.prototype.scrollIntoView = vi.fn();
}

export async function selectOption(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
