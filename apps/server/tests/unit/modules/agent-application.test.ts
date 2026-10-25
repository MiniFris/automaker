import { describe, expect, it, vi } from 'vitest';

import { AgentApplicationService } from '../../../src/modules/agents/agent-application.service.js';
import { AgentSendSchema } from '../../../src/modules/agents/agent.schemas.js';

const service = () => ({
  startConversation: vi.fn().mockResolvedValue({ success: true }),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  emitSessionError: vi.fn(),
  getHistory: vi.fn().mockResolvedValue([]),
  stopExecution: vi.fn().mockResolvedValue({ success: true }),
  clearSession: vi.fn().mockResolvedValue({ success: true }),
  setSessionModel: vi.fn().mockResolvedValue(true),
  addToQueue: vi.fn().mockResolvedValue({ success: true }),
  getQueue: vi.fn().mockResolvedValue([]),
  removeFromQueue: vi.fn().mockResolvedValue({ success: true }),
  clearQueue: vi.fn().mockResolvedValue({ success: true }),
});

describe('AgentApplicationService', () => {
  it('returns immediately while the long-lived message continues in the background', async () => {
    let finish!: () => void;
    const agents = service();
    agents.sendMessage.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const application = new AgentApplicationService(agents as never);

    expect(application.send({ sessionId: 'session', message: 'hello' })).toEqual({
      success: true,
      message: 'Message sent',
    });
    expect(agents.sendMessage).toHaveBeenCalledOnce();
    finish();
    await Promise.resolve();
  });

  it('publishes background failures through the existing session event contract', async () => {
    const agents = service();
    const failure = new Error('provider failed');
    agents.sendMessage.mockRejectedValue(failure);
    const application = new AgentApplicationService(agents as never);

    application.send({ sessionId: 'session', message: 'hello' });
    await vi.waitFor(() =>
      expect(agents.emitSessionError).toHaveBeenCalledWith('session', 'provider failed', failure)
    );
  });

  it('forwards queue/model operations without creating another AgentService', async () => {
    const agents = service();
    const application = new AgentApplicationService(agents as never);
    await application.queueAdd({
      sessionId: 'session',
      message: 'next',
      imagePaths: ['/tmp/image.png'],
      thinkingLevel: 'adaptive',
    });
    await expect(
      application.model({ sessionId: 'session', model: 'claude-sonnet', providerId: 'provider' })
    ).resolves.toEqual({ success: true });
    expect(agents.addToQueue).toHaveBeenCalledWith('session', {
      message: 'next',
      imagePaths: ['/tmp/image.png'],
      thinkingLevel: 'adaptive',
    });
  });

  it('validates the complete public thinking-level contract and rejects extra fields', () => {
    expect(
      AgentSendSchema.parse({ sessionId: 'session', message: 'hello', thinkingLevel: 'ultrathink' })
    ).toMatchObject({ thinkingLevel: 'ultrathink' });
    expect(() =>
      AgentSendSchema.parse({ sessionId: 'session', message: 'hello', command: 'rm -rf' })
    ).toThrow();
  });
});
