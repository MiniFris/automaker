import { describe, expect, it } from 'vitest';
import {
  TerminalCreateSessionSchema,
  TerminalResizeSchema,
  TerminalSessionIdSchema,
  TerminalSettingsSchema,
} from '../src/domains/terminal.js';

describe('terminal HTTP input contracts', () => {
  it('preserves optional fields, unknown options, empty optional shell/target and array no-op bodies', () => {
    for (const body of [
      {},
      { extra: true },
      { shell: '', environmentTargetId: '' },
      { cwd: ' ', cols: 1, rows: 500 },
      { cols: 1000, rows: 1 },
      [],
      null,
      undefined,
    ]) {
      expect(TerminalCreateSessionSchema.safeParse(body).success).toBe(true);
    }
    expect(TerminalCreateSessionSchema.parse({ extra: true })).toEqual({ extra: true });
    for (const body of [{}, [], { maxSessions: 1, extra: true }, { maxSessions: 1000 }])
      expect(TerminalSettingsSchema.safeParse(body).success).toBe(true);
    expect(TerminalResizeSchema.safeParse({ cols: 1, rows: 500, extra: true }).success).toBe(true);
    for (const id of ['', 'opaque : id', '../kept-as-an-opaque-id']) {
      expect(TerminalSessionIdSchema.parse(id)).toBe(id);
    }
  });
  it('retains all field limits without coercion', () => {
    for (const body of [
      { cwd: '' },
      { cwd: 'a\0b' },
      { cwd: 4 },
      { shell: null },
      { environmentTargetId: 3 },
      { cols: 0 },
      { cols: 1001 },
      { cols: 1.5 },
      { cols: '80' },
      { rows: 0 },
      { rows: 501 },
      { rows: null },
    ])
      expect(TerminalCreateSessionSchema.safeParse(body).success).toBe(false);
    for (const body of [
      {},
      [],
      { cols: 80 },
      { cols: 80, rows: 501 },
      { cols: 1.5, rows: 24 },
      { cols: 80, rows: '24' },
    ])
      expect(TerminalResizeSchema.safeParse(body).success).toBe(false);
    for (const maxSessions of [null, '1', 0, 1001, 1.5, NaN, Infinity])
      expect(TerminalSettingsSchema.safeParse({ maxSessions }).success).toBe(false);
  });
});
