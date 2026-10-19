/**
 * Maintainer-only catalog preparation. Never used by the application.
 * Sends only the extracted English interface keys, not source files or user data.
 * Requires explicit --allow-external-translation (user approval is also required).
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

if (!process.argv.includes('--allow-external-translation')) {
  throw new Error('External translation must be explicitly approved.');
}
const keys = JSON.parse(
  execFileSync(process.execPath, ['scripts/check-ui-localization.mjs', '--keys'], {
    maxBuffer: 10_000_000,
  })
);
const output = 'apps/ui/src/locales/ru.json';
const catalog = JSON.parse(fs.readFileSync(output, 'utf8'));
const pending = keys.filter((key) => !Object.hasOwn(catalog, key));
const placeholders = (text) =>
  [...text.matchAll(/\{\w+\}/g)]
    .map((m) => m[0])
    .sort()
    .join(',');
const save = () =>
  fs.writeFileSync(
    output,
    JSON.stringify(
      Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b, 'en'))),
      null,
      2
    ) + '\n'
  );
let done = 0;

async function translateBatch(batch) {
  const text = batch
    .map((s, i) => `[${String(i).padStart(5, '0')}] ${s.replace(/\n/g, ' ZXQLINEQXZ ')}`)
    .join('\n');
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  for (const [key, value] of Object.entries({
    client: 'gtx',
    sl: 'en',
    tl: 'ru',
    dt: 't',
    q: text,
  }))
    url.searchParams.set(key, value);
  let translated;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Translation HTTP ${response.status}`);
      const data = await response.json();
      translated = data[0].map((row) => row[0] ?? '').join('');
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  const matches = [...translated.matchAll(/\[(\d{5})\]\s*/g)];
  const results = new Map();
  matches.forEach((match, i) => {
    const end = matches[i + 1]?.index ?? translated.length;
    results.set(
      Number(match[1]),
      translated
        .slice(match.index + match[0].length, end)
        .trim()
        .replace(/\s*ZXQLINEQXZ\s*/g, '\n')
    );
  });
  for (let i = 0; i < batch.length; i++) {
    const key = batch[i];
    const value = results.get(i);
    if (!value || placeholders(value) !== placeholders(key)) {
      if (batch.length > 1) {
        await translateBatch([key]);
        continue;
      }
      console.warn('Needs manual translation:', JSON.stringify(key));
      continue;
    }
    const leading = key.match(/^\s*/)[0];
    const trailing = key.match(/\s*$/)[0];
    catalog[key] = leading + value + trailing;
    done++;
  }
  save();
  console.log(`Translated ${done}/${pending.length} messages`);
}

const batches = [];
let batch = [],
  length = 0;
for (const key of pending) {
  if (length + key.length > 2000 || batch.length >= 50) {
    batches.push(batch);
    batch = [];
    length = 0;
  }
  batch.push(key);
  length += key.length + 12;
}
if (batch.length) batches.push(batch);
// Sequential requests keep the public service load low. Each completed batch is saved.
for (const group of batches) {
  await translateBatch(group);
  await new Promise((resolve) => setTimeout(resolve, 250));
}
console.log(`Catalog contains ${Object.keys(catalog).length} messages.`);
