import { StringDecoder } from 'node:string_decoder';
import { ExecutionEnvironmentError, type EnvironmentProcessOutput } from './runtime.js';

/** Bounded framing shared by Docker and SSH. CLI output cannot impersonate a worker result. */
export class WorkerStream {
  private readonly decoder = new StringDecoder('utf8');
  private pending = '';
  private result?: string;
  constructor(private readonly output: EnvironmentProcessOutput) {}
  push = (data: Buffer) => {
    this.pending += this.decoder.write(data);
    let end: number;
    while ((end = this.pending.indexOf('\n')) >= 0) {
      const line = this.pending.slice(0, end);
      this.pending = this.pending.slice(end + 1);
      if (line.length > 100_000 || this.result) this.invalid();
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        this.invalid();
      }
      if (frame?.stream === 'stdout' || frame?.stream === 'stderr') {
        if (typeof frame.data !== 'string') this.invalid();
        const bytes = Buffer.from(frame.data, 'base64');
        if (bytes.length > 65_536 || bytes.toString('base64') !== frame.data) this.invalid();
        this.output(frame.stream, bytes);
      } else if (typeof frame?.ok === 'boolean') this.result = line;
      else this.invalid();
    }
    if (this.pending.length > 100_000) this.invalid();
  };
  finish(): string {
    this.pending += this.decoder.end();
    if (this.pending || !this.result) this.invalid();
    return this.result!;
  }
  private invalid(): never {
    throw new ExecutionEnvironmentError(
      'PROCESS_PROTOCOL_INVALID',
      'Invalid remote process stream. Inspect the outcome; no operation was replayed.'
    );
  }
}
