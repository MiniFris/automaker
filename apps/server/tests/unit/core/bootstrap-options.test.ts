import { expect, it, vi } from 'vitest';
import { assertNoLegacyServiceOverrides } from '../../../src/core/config/bootstrap-options.js';
import { AppModule } from '../../../src/app.module.js';
import { LegacyModule } from '../../../src/legacy/legacy.module.js';

it.each([
  { name: 'undefined', options: { services: undefined } },
  { name: 'empty', options: { services: {} } },
  { name: 'unknown', options: { services: { unknown: {} } } },
  { name: 'inherited', options: Object.create({ services: {} }) as object },
])(
  'rejects a removed $name service override container without silently using defaults',
  ({ options }) => {
    expect(() => assertNoLegacyServiceOverrides(options)).toThrow(
      'Legacy service overrides are not supported.'
    );
  }
);

it('rejects an accessor without evaluating it', () => {
  const read = vi.fn(() => {
    throw new Error('must not read retired options');
  });
  const options = Object.defineProperty({}, 'services', { get: read });
  expect(() => assertNoLegacyServiceOverrides(options)).toThrow(
    'Legacy service overrides are not supported.'
  );
  expect(read).not.toHaveBeenCalled();
});

it('accepts native bootstrap options without a service override seam', () => {
  expect(() =>
    assertNoLegacyServiceOverrides({ providerRegistrations: [], runStartupTasks: false })
  ).not.toThrow();
});

it('rejects direct AppModule composition before resolving config or creating modules', () => {
  expect(() =>
    AppModule.register({} as never, '/unused-bootstrap-fixture', { services: {} } as never)
  ).toThrow('Legacy service overrides are not supported.');
});

it('rejects direct legacy lifecycle module composition before constructing anything', () => {
  expect(() =>
    LegacyModule.register({ services: {} } as never, '/unused-bootstrap-fixture')
  ).toThrow('Legacy service overrides are not supported.');
});
