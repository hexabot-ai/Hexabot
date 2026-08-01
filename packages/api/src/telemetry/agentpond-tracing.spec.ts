/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

describe('AgentPond tracing', () => {
  const originalProvider = process.env.FILES_SDK_PROVIDER;

  beforeEach(() => {
    delete process.env.FILES_SDK_PROVIDER;
    jest.resetModules();
  });

  afterAll(() => {
    if (originalProvider === undefined) {
      delete process.env.FILES_SDK_PROVIDER;
    } else {
      process.env.FILES_SDK_PROVIDER = originalProvider;
    }
  });

  it('stays disabled when no Files SDK provider is configured', async () => {
    const {
      AgentPondTracingLifecycle,
      agentPondTelemetry,
      flushAgentPondTracing,
    } = await import('./agentpond-tracing');

    expect(agentPondTelemetry).toBeUndefined();
    const lifecycle = new AgentPondTracingLifecycle();
    await expect(lifecycle.onModuleInit()).resolves.toBeUndefined();
    await expect(flushAgentPondTracing()).resolves.toBeUndefined();
    await expect(lifecycle.onModuleDestroy()).resolves.toBeUndefined();
  });
});
