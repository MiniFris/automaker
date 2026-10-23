import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import crypto from 'node:crypto';
import path from 'node:path';
import { createLogger } from '@automaker/utils';
import * as secureFs from '../../lib/secure-fs.js';
import { RUNTIME_CONFIG, type RuntimeConfig } from '../config/index.js';

export const SESSION_COOKIE_NAME = 'automaker_session';
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const WS_TOKEN_MAX_AGE_MS = 5 * 60 * 1000;
type Session = { createdAt: number; expiresAt: number };
const logger = createLogger('AuthState');

/** One application owns its keys/tokens and serializes writes to its legacy-format store. */
@Injectable()
export class AuthStateRepository implements OnModuleInit, OnApplicationShutdown {
  private apiKey?: string;
  private sessions = new Map<string, Session>();
  private readonly wsTokens = new Map<string, Session>();
  private pendingWrite: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}

  async onModuleInit(): Promise<void> {
    this.apiKey = await this.loadApiKey();
    await this.loadSessions();
  }

  async onApplicationShutdown(): Promise<void> {
    this.closed = true;
    await this.pendingWrite;
    this.sessions.clear();
    this.wsTokens.clear();
    this.apiKey = undefined;
  }

  validateApiKey(candidate: string): boolean {
    if (this.closed || !this.apiKey || typeof candidate !== 'string' || !candidate) return false;
    const expected = Buffer.from(this.apiKey);
    const actual = Buffer.from(candidate);
    if (expected.length !== actual.length) {
      crypto.timingSafeEqual(expected, expected);
      return false;
    }
    return crypto.timingSafeEqual(expected, actual);
  }

  createSession(): Promise<string> {
    return this.enqueue(async () => {
      const token = crypto.randomBytes(32).toString('hex');
      const now = Date.now();
      const next = new Map(this.sessions);
      next.set(token, { createdAt: now, expiresAt: now + SESSION_MAX_AGE_MS });
      await this.writeSessions(next);
      this.sessions = next;
      return token;
    });
  }

  validateSession(token: string): boolean {
    if (this.closed) return false;
    const session = this.sessions.get(token);
    if (!session) return false;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      void this.enqueue(() => this.writeSessions(this.sessions)).catch(() => {
        logger.error('Failed to persist expired authentication session removal.');
      });
      return false;
    }
    return true;
  }

  invalidateSession(token: string): Promise<void> {
    return this.enqueue(async () => {
      const next = new Map(this.sessions);
      next.delete(token);
      await this.writeSessions(next);
      this.sessions = next;
    });
  }

  issueWebSocketToken(): string {
    if (this.closed || !this.apiKey) throw new Error('Authentication store is not available.');
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    this.wsTokens.set(token, { createdAt: now, expiresAt: now + WS_TOKEN_MAX_AGE_MS });
    return token;
  }

  consumeWebSocketToken(token: string): boolean {
    if (this.closed) return false;
    const entry = this.wsTokens.get(token);
    this.wsTokens.delete(token);
    return !!entry && entry.expiresAt > Date.now();
  }

  cleanupExpiredWebSocketTokens(now = Date.now()): void {
    for (const [token, entry] of this.wsTokens) {
      if (entry.expiresAt <= now) this.wsTokens.delete(token);
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed || !this.apiKey)
      return Promise.reject(new Error('Authentication store is not available.'));
    const job = this.pendingWrite.then(operation);
    // An individual failed write must reach its caller without poisoning later writes.
    this.pendingWrite = job.then(
      () => undefined,
      () => undefined
    );
    return job;
  }

  private async loadApiKey(): Promise<string> {
    if (this.config.auth.apiKey) return this.config.auth.apiKey;
    const file = path.join(this.config.storage.dataDirectory, '.api-key');
    try {
      const key = String(await secureFs.readFile(file, 'utf8')).trim();
      if (!key) throw new Error('The saved authentication API key is empty.');
      return key;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await secureFs.mkdir(this.config.storage.dataDirectory, { recursive: true });
    const key = crypto.randomUUID();
    try {
      await secureFs.writeFile(file, key, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      logger.info('Generated authentication API key in DATA_DIR/.api-key.');
      return key;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = String(await secureFs.readFile(file, 'utf8')).trim();
      if (!existing) throw new Error('The saved authentication API key is empty.');
      return existing;
    }
  }

  private async loadSessions(): Promise<void> {
    let entries: unknown;
    try {
      entries = JSON.parse(String(await secureFs.readFile(this.sessionsFile, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      if (error instanceof SyntaxError) {
        logger.warn('Ignoring malformed authentication session store.');
        return;
      }
      throw error;
    }
    if (!Array.isArray(entries)) {
      logger.warn('Ignoring malformed authentication session store.');
      return;
    }
    const now = Date.now();
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [token, session] = entry;
      if (typeof token !== 'string' || !token || !session || typeof session !== 'object') continue;
      if (!Number.isFinite(session.createdAt) || !Number.isFinite(session.expiresAt)) continue;
      if (session.createdAt > session.expiresAt || session.expiresAt <= now) continue;
      this.sessions.set(token, { createdAt: session.createdAt, expiresAt: session.expiresAt });
    }
  }

  private get sessionsFile(): string {
    return path.join(this.config.storage.dataDirectory, '.sessions');
  }

  private async writeSessions(sessions: ReadonlyMap<string, Session>): Promise<void> {
    await secureFs.mkdir(this.config.storage.dataDirectory, { recursive: true });
    const temporary = `${this.sessionsFile}.${crypto.randomUUID()}.tmp`;
    try {
      await secureFs.writeFile(temporary, JSON.stringify([...sessions]), {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      await secureFs.rename(temporary, this.sessionsFile);
    } finally {
      await secureFs.unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT')
          logger.warn('Failed to remove authentication store temp file.');
      });
    }
  }
}
