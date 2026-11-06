/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { HexabotCatalogMcpTools } from './catalog-mcp.tools';
import { HexabotCmsMcpTools } from './cms-mcp.tools';
import { HexabotCredentialMcpTools } from './credential-mcp.tools';
import { HexabotMcpServerTools } from './mcp-server-mcp.tools';
import { HexabotMemoryDefinitionMcpTools } from './memory-definition-mcp.tools';
import { HexabotSettingMcpTools } from './setting-mcp.tools';
import { HexabotSourceMcpTools } from './source-mcp.tools';
import { HexabotWorkflowMcpHelper } from './workflow-mcp.helper';
import { HexabotWorkflowMcpTools } from './workflow-mcp.tools';
import { HexabotWorkflowRunMcpTools } from './workflow-run-mcp.tools';
import { HexabotWorkflowVersionMcpTools } from './workflow-version-mcp.tools';

export * from './catalog-mcp.tools';

export * from './cms-mcp.tools';

export * from './credential-mcp.tools';

export * from './hexabot-mcp-tool.base';

export * from './hexabot-mcp.schemas';

export * from './hexabot-mcp.utils';

export * from './memory-definition-mcp.tools';

export * from './mcp-server-mcp.tools';

export * from './setting-mcp.tools';

export * from './source-mcp.tools';

export * from './workflow-mcp.helper';

export * from './workflow-mcp.tools';

export * from './workflow-run-mcp.tools';

export * from './workflow-version-mcp.tools';

export const HEXABOT_MCP_TOOL_PROVIDERS = [
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
];
