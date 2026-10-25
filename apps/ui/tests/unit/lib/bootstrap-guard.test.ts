import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

const html = readFileSync(new NodeURL('../../../index.html', import.meta.url), 'utf8');
const windows: JSDOM[] = [];
afterEach(() => {
  windows.splice(0).forEach((dom) => dom.window.close());
});

function fixture() {
  const dom = new JSDOM(html, {
    url: 'https://bootstrap.fixture.invalid',
    runScripts: 'outside-only',
  });
  windows.push(dom);
  const { window } = dom;
  window.eval(window.document.getElementById('app-bootstrap-guard')!.textContent!);
  const failure = (target: Element) => target.dispatchEvent(new window.Event('error'));
  const flush = () => window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  const entry = window.document.querySelector('script[type="module"][src]')!;
  const error = () => window.document.querySelector<HTMLElement>('.app-shell-error');
  return { window, document: window.document, failure, flush, entry, error };
}

describe('pre-React bootstrap resource guard', () => {
  it('shows a static error and stops the spinner on module failure without reflecting the resource URL', () => {
    const f = fixture();
    f.window.localStorage.setItem('bootstrap-recovery-fixture', 'original-before-failure');
    f.entry.setAttribute('src', '/private-failed-module.js?token=never-reflect');
    f.failure(f.entry);
    f.failure(f.entry);
    f.flush();
    expect(f.error()?.hidden).toBe(false);
    expect(f.error()?.textContent).toContain('Unable to load Automaker');
    expect(f.error()?.textContent).not.toContain('never-reflect');
    expect(f.document.querySelector<HTMLElement>('.app-shell-spinner')?.hidden).toBe(true);
    expect(f.document.querySelectorAll('.app-shell-error')).toHaveLength(1);
    expect(f.window.localStorage.getItem('bootstrap-recovery-fixture')).toBe(
      'original-before-failure'
    );
  });

  it.each([
    ['en', 'Unable to load'],
    ['ru', 'Не удалось загрузить'],
    ['unsupported', 'Не удалось загрузить'],
  ])(
    'respects supported locale %s and falls back to browser language otherwise',
    (locale, message) => {
      const f = fixture();
      Object.defineProperty(f.window.navigator, 'language', { value: 'ru-RU' });
      f.window.localStorage.setItem('automaker-ui-locale', locale);
      f.failure(f.entry);
      f.flush();
      expect(f.error()?.textContent).toContain(message);
    }
  );

  it('still works when localStorage is unavailable', () => {
    const f = fixture();
    Object.defineProperty(f.window, 'localStorage', {
      get: () => {
        throw new Error('blocked storage');
      },
    });
    Object.defineProperty(f.window.navigator, 'language', { value: 'ru-RU' });
    f.failure(f.entry);
    f.flush();
    expect(f.error()?.hidden).toBe(false);
    expect(f.error()?.textContent).toContain('Не удалось загрузить Automaker');
  });

  it('handles a head module failing before the body exists', () => {
    const f = fixture();
    const body = f.document.body;
    const entry = f.document.createElement('script');
    entry.type = 'module';
    entry.src = '/early-module.js';
    f.document.head.append(entry);
    body.remove();
    f.failure(entry);
    f.document.documentElement.append(body);
    f.flush();
    expect(f.error()?.hidden).toBe(false);
  });

  it('ignores optional resources and classic scripts', () => {
    const f = fixture();
    const image = f.document.createElement('img');
    image.src = '/optional.png';
    f.document.body.append(image);
    const script = f.document.createElement('script');
    script.src = '/optional-classic.js';
    f.document.head.append(script);
    f.failure(image);
    f.failure(script);
    f.flush();
    expect(f.error()?.hidden).toBe(true);
    expect(f.document.querySelector<HTMLElement>('.app-shell-spinner')?.hidden).toBe(false);
  });

  it('does not modify an application already owned by React on a late module failure', () => {
    const f = fixture();
    f.document.getElementById('app')!.innerHTML = '<main data-fixture="react">Ready</main>';
    f.failure(f.entry);
    f.flush();
    expect(f.document.getElementById('app')!.innerHTML).toBe(
      '<main data-fixture="react">Ready</main>'
    );
    expect(f.error()).toBeNull();
  });
});
