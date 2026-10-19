import { EditorState, type Extension } from '@codemirror/state';
import phrases from '@/locales/codemirror-ru.json';
import { useUiLocale } from '@/lib/i18n';

const russian = EditorState.phrases.of(phrases);
const english = EditorState.phrases.of({});

/** Reconfigures editor chrome, never translates or replaces the document. */
export function useEditorLocalization(): Extension {
  return useUiLocale() === 'ru' ? russian : english;
}
