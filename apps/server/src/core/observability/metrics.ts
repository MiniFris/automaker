export interface Metrics {
  increment(name: string, labels?: Readonly<Record<string, string>>): void;
  observe(name: string, value: number, labels?: Readonly<Record<string, string>>): void;
}

export const METRICS = Symbol('METRICS');

export class NoopMetrics implements Metrics {
  increment(_name: string, _labels?: Readonly<Record<string, string>>): void {}
  observe(_name: string, _value: number, _labels?: Readonly<Record<string, string>>): void {}
}
