/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action } from "@hexabot-ai/types";
import {
  Activity,
  BookOpen,
  BrainCircuit,
  ClipboardCheck,
  Flag,
  GitBranch,
  Home,
  Images,
  KeyRound,
  Languages,
  Library,
  Menu,
  MessagesSquare,
  Plug,
  PlugZap,
  ScrollText,
  Settings,
  ShieldCheck,
  Tag,
  UserRound,
  Users,
  Webhook,
  Workflow,
} from "lucide-react";

import { TMenu } from "@/app-components/menus/DashboardSidebar/types/sidebar.types";
import { PendingApprovalsBadge } from "@/components/workflow-approvals/PendingApprovalsBadge";
import { EntityType } from "@/services/types";

export const getMenuItems = (ssoEnabled: boolean): TMenu[] => [
  {
    text: "menu.dashboard",
    href: "/",
    Icon: Home,
  },
  {
    text: "menu.inbox",
    href: "/inbox/threads",
    Icon: MessagesSquare,
    requires: {
      [EntityType.MESSAGE]: [Action.READ],
    },
  },
  {
    text: "menu.workflows",
    Icon: GitBranch,
    submenuItems: [
      {
        text: "menu.workflow_builder",
        href: "/workflow-editor",
        Icon: Workflow,
        requires: {
          [EntityType.WORKFLOW]: [Action.READ],
        },
      },
      {
        text: "menu.runs",
        href: "/workflow/runs",
        Icon: Activity,
        requires: {
          [EntityType.WORKFLOW_RUN]: [Action.READ],
        },
      },
      {
        text: "menu.approvals",
        href: "/workflow/approvals",
        Icon: ClipboardCheck,
        Badge: PendingApprovalsBadge,
        requires: {
          [EntityType.WORKFLOW_RUN]: [Action.READ],
        },
      },
      {
        text: "menu.memory",
        href: "/workflow/memory-definitions",
        Icon: BrainCircuit,
        requires: {
          [EntityType.MEMORY_DEFINITION]: [Action.READ],
        },
      },
    ],
  },
  {
    text: "menu.content",
    Icon: Library,
    submenuItems: [
      {
        text: "menu.content_types",
        href: "/content-types",
        Icon: BookOpen,
        requires: {
          [EntityType.CONTENT_TYPE]: [Action.READ],
        },
      },
      {
        text: "menu.persistent_menu",
        href: "/content/persistent-menu",
        Icon: Menu,
        requires: {
          [EntityType.MENU]: [Action.READ],
        },
      },
      {
        text: "menu.media_library",
        href: "/content/media-library",
        Icon: Images,
        requires: {
          [EntityType.ATTACHMENT]: [Action.READ],
        },
      },
    ],
  },
  {
    text: "menu.audience",
    Icon: UserRound,
    submenuItems: [
      {
        text: "menu.subscribers",
        href: "/subscribers",
        Icon: UserRound,
        requires: {
          [EntityType.SUBSCRIBER]: [Action.READ],
        },
      },
      {
        text: "menu.labels",
        href: "/subscribers/labels",
        Icon: Tag,
        requires: {
          [EntityType.LABEL]: [Action.READ],
        },
      },

      // {
      //   text: 'menu.broadcast',
      //   href: "/subscribers/broadcast",
      //   Icon: faBullhorn,
      // },
    ],
  },
  {
    text: "menu.integrations",
    Icon: Plug,
    submenuItems: [
      {
        text: "menu.channels",
        href: "/settings/sources",
        Icon: Webhook,
        requires: {
          [EntityType.SOURCE]: [Action.READ],
        },
      },
      {
        text: "menu.mcp_servers",
        href: "/workflow/mcp-servers",
        Icon: PlugZap,
        requires: {
          [EntityType.MCP_SERVER]: [Action.READ],
        },
      },
      {
        text: "menu.credentials",
        href: "/credentials",
        Icon: KeyRound,
        requires: {
          [EntityType.CREDENTIAL]: [Action.READ],
        },
      },
    ],
  },
  {
    text: "menu.administration",
    Icon: ShieldCheck,
    submenuItems: [
      {
        text: "menu.users",
        href: "/users",
        Icon: Users,
        requires: {
          [EntityType.USER]: [Action.READ],
        },
      },
      ...(!ssoEnabled
        ? [
            {
              text: "menu.roles",
              href: "/roles",
              Icon: ShieldCheck,
              requires: {
                [EntityType.ROLE]: [Action.READ],
              },
            } satisfies TMenu,
          ]
        : []),
      {
        text: "menu.languages",
        href: "/localization/languages",
        Icon: Flag,
        requires: {
          [EntityType.LANGUAGE]: [Action.READ],
        },
      },
      {
        text: "menu.translations",
        href: "/localization/translations",
        Icon: Languages,
        requires: {
          [EntityType.TRANSLATION]: [Action.READ],
        },
      },
      {
        text: "menu.audit_trail",
        href: "/audit",
        Icon: ScrollText,
        requires: {
          [EntityType.AUDIT_LOG]: [Action.READ],
        },
      },
      {
        text: "menu.settings",
        href: "/settings",
        Icon: Settings,
        requires: {
          [EntityType.SETTING]: [Action.READ, Action.UPDATE],
        },
      },
    ],
  },
];
