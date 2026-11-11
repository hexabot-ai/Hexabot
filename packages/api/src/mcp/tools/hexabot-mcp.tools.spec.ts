/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  MCP_GUARDS_METADATA_KEY,
  MCP_TOOL_METADATA_KEY,
} from '@rekog/mcp-nest';

import {
  MCP_PERMISSION_METADATA_KEY,
  McpPermissionGuard,
} from '../guards/mcp-permission.guard';

import {
  HEXABOT_MCP_TOOL_PROVIDERS,
  HexabotCatalogMcpTools,
  HexabotCmsMcpTools,
  HexabotCredentialMcpTools,
  HexabotMcpServerTools,
  HexabotMemoryDefinitionMcpTools,
  HexabotSettingMcpTools,
  HexabotSourceMcpTools,
  HexabotWorkflowMcpHelper,
  HexabotWorkflowMcpTools,
  HexabotWorkflowRunMcpTools,
  HexabotWorkflowVersionMcpTools,
} from './hexabot-mcp.tools';

describe('HEXABOT_MCP_TOOL_PROVIDERS', () => {
  it('registers every focused MCP tool provider', () => {
    expect(HEXABOT_MCP_TOOL_PROVIDERS).toEqual([
      HexabotWorkflowMcpHelper,
      HexabotWorkflowMcpTools,
      HexabotWorkflowVersionMcpTools,
      HexabotWorkflowRunMcpTools,
      HexabotMemoryDefinitionMcpTools,
      HexabotCatalogMcpTools,
      HexabotCredentialMcpTools,
      HexabotMcpServerTools,
      HexabotSettingMcpTools,
      HexabotSourceMcpTools,
      HexabotCmsMcpTools,
    ]);
  });
});

describe('Hexabot MCP tools', () => {
  const tools = HEXABOT_MCP_TOOL_PROVIDERS.flatMap(({ prototype }) =>
    Object.getOwnPropertyNames(prototype)
      .map((name) => ({ name, method: prototype[name] }))
      .filter(
        ({ method }) =>
          typeof method === 'function' &&
          Reflect.hasMetadata(MCP_TOOL_METADATA_KEY, method),
      )
      .map(({ name, method }) => ({
        tool: Reflect.getMetadata(MCP_TOOL_METADATA_KEY, method).name,
        name,
        permission: Reflect.getMetadata(MCP_PERMISSION_METADATA_KEY, method),
        guards: Reflect.getMetadata(MCP_GUARDS_METADATA_KEY, method),
      })),
  );

  it('are found', () => {
    expect(tools.length).toBeGreaterThan(0);
  });

  it.each(tools)(
    '$tool requires a permission and checks it',
    ({ permission, guards }) => {
      expect(permission).toEqual({
        model: expect.any(String),
        action: expect.any(String),
      });
      expect(guards).toEqual([McpPermissionGuard]);
    },
  );
});
