import { useMemo, useSyncExternalStore, type DependencyList } from 'react';
import ru from '@/locales/ru.json';
import reviewedRu from '@/locales/ru-reviewed.json';

const russian: Record<string, string> = { ...ru, ...reviewedRu };

export type UiLocale = 'en' | 'ru';
export const UI_LOCALE_STORAGE_KEY = 'automaker-ui-locale';
export const UI_LANGUAGES = [
  { value: 'en' as const, label: 'English' },
  { value: 'ru' as const, label: 'Русский' },
];
const listeners = new Set<() => void>();

function detectLocale(): UiLocale {
  try {
    const saved = localStorage.getItem(UI_LOCALE_STORAGE_KEY);
    if (saved === 'en' || saved === 'ru') return saved;
  } catch {
    /* Storage may be disabled. The in-memory choice still works. */
  }
  if (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('ru')) {
    return 'ru';
  }
  return 'en';
}

let locale = detectLocale();

function updateDocument() {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    document.title = translate('Automaker - Autonomous AI Development Studio');
    document.querySelector('.app-shell-spinner')?.setAttribute('aria-label', translate('Loading…'));
  }
}
updateDocument();

export function getUiLocale(): UiLocale {
  return locale;
}
export function getFormattingLocale(): string {
  return locale === 'ru' ? 'ru-RU' : 'en-US';
}

export function setUiLocale(next: UiLocale): void {
  if (next !== 'en' && next !== 'ru') return;
  try {
    localStorage.setItem(UI_LOCALE_STORAGE_KEY, next);
  } catch {
    /* optional storage */
  }
  if (next === locale) return;
  locale = next;
  updateDocument();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe without resetting any component, editor or terminal state. */
export function useUiLocale(): UiLocale {
  return useSyncExternalStore(subscribe, getUiLocale, () => 'en');
}

/** A memo containing UI copy must also invalidate when the language changes. */
export function useLocalizedMemo<T>(factory: () => T, dependencies: DependencyList): T {
  const currentLocale = useUiLocale();
  // The caller owns the ordinary dependencies, exactly as with React.useMemo.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(factory, [currentLocale, ...dependencies]);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== UI_LOCALE_STORAGE_KEY && event.key !== null) return;
    const next = detectLocale();
    if (next !== locale) {
      locale = next;
      updateDocument();
      listeners.forEach((listener) => listener());
    }
  });
}

/** Interpolation is one pass: user values cannot become translation keys/placeholders. */
export function translate(source: string, values?: Record<string, unknown>): string {
  const text = locale === 'ru' && Object.hasOwn(russian, source) ? russian[source] : source;
  return values
    ? text.replace(/\{(\w+)\}/g, (match, key: string) =>
        Object.hasOwn(values, key) ? String(values[key]) : match
      )
    : text;
}

const countNouns: Record<string, [string, string, string]> = {
  feature: ['задача', 'задачи', 'задач'],
  task: ['задача', 'задачи', 'задач'],
  file: ['файл', 'файла', 'файлов'],
  'changed file': ['изменённый файл', 'изменённых файла', 'изменённых файлов'],
  'uncommitted file': ['незакоммиченный файл', 'незакоммиченных файла', 'незакоммиченных файлов'],
  'text file': ['текстовый файл', 'текстовых файла', 'текстовых файлов'],
  'completed feature': ['завершённая задача', 'завершённые задачи', 'завершённых задач'],
  'existing session': ['существующая сессия', 'существующие сессии', 'существующих сессий'],
  'archived session': ['архивная сессия', 'архивные сессии', 'архивных сессий'],
  session: ['сессия', 'сессии', 'сессий'],
  project: ['проект', 'проекта', 'проектов'],
  comment: ['комментарий', 'комментария', 'комментариев'],
  error: ['ошибка', 'ошибки', 'ошибок'],
  image: ['изображение', 'изображения', 'изображений'],
  attachment: ['вложение', 'вложения', 'вложений'],
  agent: ['агент', 'агента', 'агентов'],
  subagent: ['субагент', 'субагента', 'субагентов'],
  tool: ['инструмент', 'инструмента', 'инструментов'],
  event: ['событие', 'события', 'событий'],
  source: ['источник', 'источника', 'источников'],
  provider: ['провайдер', 'провайдера', 'провайдеров'],
  'connected provider': [
    'подключённый провайдер',
    'подключённых провайдера',
    'подключённых провайдеров',
  ],
  'dynamic provider': [
    'динамический провайдер',
    'динамических провайдера',
    'динамических провайдеров',
  ],
  'tool call': ['вызов инструмента', 'вызова инструмента', 'вызовов инструмента'],
  prompt: ['промпт', 'промпта', 'промптов'],
  server: ['сервер', 'сервера', 'серверов'],
  commit: ['коммит', 'коммита', 'коммитов'],
  worktree: ['рабочее дерево', 'рабочих дерева', 'рабочих деревьев'],
  change: ['изменение', 'изменения', 'изменений'],
  minute: ['минута', 'минуты', 'минут'],
  hour: ['час', 'часа', 'часов'],
  day: ['день', 'дня', 'дней'],
  line: ['строка', 'строки', 'строк'],
  item: ['элемент', 'элемента', 'элементов'],
  message: ['сообщение', 'сообщения', 'сообщений'],
  test: ['тест', 'теста', 'тестов'],
  issue: ['обращение', 'обращения', 'обращений'],
  'pull request': ['пул-реквест', 'пул-реквеста', 'пул-реквестов'],
  model: ['модель', 'модели', 'моделей'],
  token: ['токен', 'токена', 'токенов'],
  directory: ['каталог', 'каталога', 'каталогов'],
  branch: ['ветка', 'ветки', 'веток'],
};

/** Russian needs one/few/many (including 11–14), not English's appended "s". */
export function formatCount(count: number, noun: string): string {
  const forms = countNouns[noun.toLowerCase()];
  if (locale !== 'ru' || !forms) return `${count} ${noun}${Math.abs(count) === 1 ? '' : 's'}`;
  const rule = new Intl.PluralRules('ru').select(count);
  return `${new Intl.NumberFormat('ru-RU').format(count)} ${forms[rule === 'one' ? 0 : rule === 'few' || rule === 'other' ? 1 : 2]}`;
}
