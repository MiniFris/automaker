import { afterEach, expect, it } from 'vitest';
import { act, renderHook, cleanup } from '@testing-library/react';
import { Compartment, EditorState } from '@codemirror/state';
import { useEditorLocalization } from '@/lib/editor-localization';
import { setUiLocale } from '@/lib/i18n';

afterEach(() => {
  cleanup();
  setUiLocale('en');
});

it('reconfigures built-in search UI without touching code or the current selection', () => {
  setUiLocale('en');
  const { result } = renderHook(() => useEditorLocalization());
  const locale = new Compartment();
  let state = EditorState.create({
    doc: 'const name = "Find Save Project";',
    selection: { anchor: 6, head: 10 },
    extensions: [locale.of(result.current)],
  });
  expect(state.phrase('Find')).toBe('Find');
  act(() => setUiLocale('ru'));
  state = state.update({ effects: locale.reconfigure(result.current) }).state;
  expect(state.phrase('Find')).toBe('Найти');
  expect(state.phrase('replace all')).toBe('заменить всё');
  expect(state.phrase('$ unchanged lines', 12)).toBe('Неизменённых строк: 12');
  expect(state.doc.toString()).toBe('const name = "Find Save Project";');
  expect(state.selection.main.anchor).toBe(6);
  expect(state.selection.main.head).toBe(10);
  act(() => setUiLocale('en'));
  state = state.update({ effects: locale.reconfigure(result.current) }).state;
  expect(state.phrase('Find')).toBe('Find');
});
