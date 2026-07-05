/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  AttachmentAccess,
  AttachmentCreatedByRef,
  AttachmentResourceRef,
  FieldType,
  MemoryScope,
  McpServerTransport,
  MenuType,
  StatsType,
  WorkflowType,
  WorkflowVersionAction,
  auditLogFullSchema,
  auditLogSchema,
  attachmentFullSchema,
  attachmentSchema,
  channelMetadataSchema,
  contentFullSchema,
  contentSchema,
  createWorkflowFullSchema,
  credentialFullSchema,
  credentialSchema,
  dummySchema,
  integrationHealthResponseSchema,
  messageSchema,
  IncomingMessageType,
  labelFullSchema,
  labelSchema,
  mcpTokenSchema,
  mcpServerFullSchema,
  mcpServerSchema,
  memoryRecordFullSchema,
  memoryRecordSchema,
  menuFullSchema,
  menuSchema,
  modelSchema,
  OutgoingMessageType,
  sourceFullSchema,
  sourceSchema,
  stdOutgoingMessageSchema,
  stdIncomingMessageSchema,
  stdOutgoingEnvelopeSchema,
  messageFullSchema,
  permissionFullSchema,
  permissionSchema,
  resolveRunDurationMs,
  settingSchema,
  statsSchema,
  subscriberFullSchema,
  subscriberSchema,
  threadFullSchema,
  userFullSchema,
  userSchema,
  webhookTriggerSchema,
  WebhookAuthType,
  workflowFullSchema,
  workflowExportBundleSchema,
  workflowExportBundleV1Schema,
  workflowImportResultSchema,
  workflowRunFullSchema,
  workflowRunSchema,
  workflowVersionFullSchema,
} from "./index";

describe("@hexabot-ai/types schemas", () => {
  const now = "2026-01-01T00:00:00.000Z";

  it("never carries inline webhook secrets", () => {
    // Unknown keys (e.g. an inline secret sent by a stale client) are
    // stripped: only credential references are part of the config shape.
    const parsed = webhookTriggerSchema.parse({
      enabled: true,
      authType: WebhookAuthType.jwt,
      jwtSecret: "plaintext-secret",
      jwtSecretCredentialId: "cred-1",
    });

    expect("jwtSecret" in parsed).toBe(false);
    expect(
      (parsed as { jwtSecretCredentialId?: string | null })
        .jwtSecretCredentialId,
    ).toBe("cred-1");
  });

  it("requires credential refs once the webhook is enabled", () => {
    expect(() =>
      webhookTriggerSchema.parse({
        enabled: true,
        authType: WebhookAuthType.basic,
        username: "ada",
        passwordCredentialId: null,
      }),
    ).toThrow();
    expect(() =>
      webhookTriggerSchema.parse({
        enabled: true,
        authType: WebhookAuthType.basic,
        username: "ada",
        passwordCredentialId: "cred-1",
      }),
    ).not.toThrow();
    // Disabled webhooks can be saved without credentials.
    expect(() =>
      webhookTriggerSchema.parse({
        enabled: false,
        authType: WebhookAuthType.jwt,
        jwtSecretCredentialId: null,
      }),
    ).not.toThrow();
  });

  it("maps user aliases and strips unknown keys", () => {
    const parsed = userSchema.parse({
      id: "u_1",
      createdAt: now,
      updatedAt: now,
      firstName: "Ada",
      lastName: "Lovelace",
      language: "en",
      timezone: 1,
      locale: null,
      gender: null,
      country: null,
      foreignId: "foreign-u-1",
      assignedAt: null,
      lastvisit: null,
      retainedFrom: null,
      channel: { name: "web", data: { id: "sub_1" } },
      username: "ada",
      email: "ada@example.com",
      sendEmail: false,
      state: true,
      resetCount: 0,
      resetToken: null,
      provider: { strategy: "local" },
      roleIds: ["r_1", "r_2"],
      avatarId: "a_1",
      shouldDrop: true,
    });

    expect(parsed.roles).toEqual(["r_1", "r_2"]);
    expect(parsed.avatar).toBe("a_1");
    expect("roleIds" in parsed).toBe(false);
    expect("avatarId" in parsed).toBe(false);
    expect("shouldDrop" in parsed).toBe(false);
  });

  it("parses strict nested user full payloads", () => {
    const parsed = userFullSchema.parse({
      id: "u_1",
      createdAt: now,
      updatedAt: now,
      firstName: "Ada",
      lastName: "Lovelace",
      language: "en",
      timezone: 1,
      locale: null,
      gender: null,
      country: null,
      foreignId: "foreign-u-1",
      assignedAt: null,
      lastvisit: null,
      retainedFrom: null,
      channel: { name: "web", data: { id: "sub_1" } },
      username: "ada",
      email: "ada@example.com",
      sendEmail: false,
      state: true,
      resetCount: 0,
      resetToken: null,
      provider: { strategy: "local" },
      roles: [
        {
          id: "r_1",
          createdAt: now,
          updatedAt: now,
          name: "admin",
          active: true,
          shouldDrop: true,
        },
      ],
      avatar: {
        id: "a_1",
        createdAt: now,
        updatedAt: now,
        name: "avatar.png",
        type: "image/png",
        size: 100,
        location: "/tmp/avatar.png",
        resourceRef: AttachmentResourceRef.UserAvatar,
        access: AttachmentAccess.Private,
        createdByRef: AttachmentCreatedByRef.User,
        createdById: "u_1",
        url: "/attachment/download/a_1/avatar.png",
      },
    });

    expect(parsed.roles[0].id).toBe("r_1");
    expect("shouldDrop" in parsed.roles[0]).toBe(false);
    expect(parsed.avatar?.createdBy).toBe("u_1");
  });

  it("does not alias relation id fields into user full relation objects", () => {
    const parsed = userFullSchema.parse({
      id: "u_1",
      createdAt: now,
      updatedAt: now,
      firstName: "Ada",
      lastName: "Lovelace",
      language: "en",
      timezone: 1,
      locale: null,
      gender: null,
      country: null,
      foreignId: "foreign-u-1",
      assignedAt: null,
      lastvisit: null,
      retainedFrom: null,
      channel: { name: "web", data: { id: "sub_1" } },
      username: "ada",
      email: "ada@example.com",
      sendEmail: false,
      state: true,
      resetCount: 0,
      resetToken: null,
      provider: { strategy: "local" },
      roleIds: ["r_1"],
      avatarId: "a_1",
      labelIds: ["l_1"],
      assignedToId: "u_2",
    });

    expect(parsed.roles).toEqual([]);
    expect(parsed.avatar).toBeNull();
    expect(parsed.labels).toEqual([]);
    expect(parsed.assignedTo).toBeNull();
  });

  it("does not alias relation id fields into subscriber full relation objects", () => {
    const parsed = subscriberFullSchema.parse({
      id: "s_1",
      createdAt: now,
      updatedAt: now,
      firstName: "Ada",
      lastName: "Lovelace",
      language: "en",
      timezone: 0,
      locale: null,
      gender: null,
      country: null,
      foreignId: "foreign-s-1",
      assignedAt: null,
      lastvisit: null,
      retainedFrom: null,
      channel: { name: "web", data: null },
      labelIds: ["l_1"],
      assignedToId: "u_1",
      avatarId: "a_1",
    });

    expect(parsed.labels).toEqual([]);
    expect(parsed.assignedTo).toBeNull();
    expect(parsed.avatar).toBeNull();
  });

  it("does not alias relation id fields into other strict full relation objects", () => {
    const assertInvalidRelationField = (
      result:
        | ReturnType<typeof permissionFullSchema.safeParse>
        | ReturnType<typeof contentFullSchema.safeParse>
        | ReturnType<typeof threadFullSchema.safeParse>
        | ReturnType<typeof messageFullSchema.safeParse>
        | ReturnType<typeof workflowVersionFullSchema.safeParse>
        | ReturnType<typeof workflowRunFullSchema.safeParse>,
      relationField: string,
    ) => {
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((issue) => issue.path[0] === relationField),
        ).toBe(true);
      }
    };

    assertInvalidRelationField(
      permissionFullSchema.safeParse({
        id: "p_1",
        createdAt: now,
        updatedAt: now,
        action: "read",
        relation: "role",
        modelId: "m_1",
        roleId: "r_1",
      }),
      "model",
    );

    assertInvalidRelationField(
      contentFullSchema.safeParse({
        id: "c_1",
        createdAt: now,
        updatedAt: now,
        title: "Welcome",
        status: true,
        properties: {},
        searchText: "welcome",
        contentTypeId: "ct_1",
      }),
      "contentType",
    );

    assertInvalidRelationField(
      threadFullSchema.safeParse({
        id: "th_1",
        createdAt: now,
        updatedAt: now,
        status: "open",
        subscriberId: "s_1",
        source: {
          id: "source_1",
          createdAt: now,
          updatedAt: now,
          name: "main-web",
          channel: "web",
          settings: {},
          state: true,
          defaultWorkflow: null,
        },
      }),
      "subscriber",
    );

    assertInvalidRelationField(
      messageFullSchema.safeParse({
        id: "msg_1",
        createdAt: now,
        updatedAt: now,
        message: "hello",
        read: false,
        delivery: false,
        handover: false,
        threadId: "th_1",
      }),
      "thread",
    );

    assertInvalidRelationField(
      workflowVersionFullSchema.safeParse({
        id: "wfv_1",
        createdAt: now,
        updatedAt: now,
        version: 1,
        definitionYml: "defs: {}\nflow: []\noutputs: {}",
        checksum: "sha",
        workflowId: "wf_1",
        parentVersionId: null,
        createdById: "u_1",
      }),
      "workflow",
    );

    assertInvalidRelationField(
      workflowRunFullSchema.safeParse({
        id: "run_1",
        createdAt: now,
        updatedAt: now,
        status: "running",
        context: {},
        workflowId: "wf_1",
        workflowVersionId: null,
        triggeredById: "s_1",
        threadId: "th_1",
      }),
      "workflow",
    );

    expect(() =>
      memoryRecordFullSchema.parse({
        id: "mem_1",
        createdAt: now,
        updatedAt: now,
        value: { counter: 1 },
        definitionId: "def_1",
        ownerId: "u_1",
        workflowId: "wf_1",
        runId: "run_1",
        threadId: "th_1",
      }),
    ).toThrow();
  });

  it("keeps nullable or optional full relation fields when only alias ids are provided", () => {
    const credential = credentialFullSchema.parse({
      id: "cred_1",
      createdAt: now,
      updatedAt: now,
      name: "OPENAI_API_KEY",
      ownerId: "u_1",
    });
    const label = labelFullSchema.parse({
      id: "l_1",
      createdAt: now,
      updatedAt: now,
      title: "VIP",
      name: "vip",
      builtin: false,
      groupId: "g_1",
    });
    const menu = menuFullSchema.parse({
      id: "mn_1",
      createdAt: now,
      updatedAt: now,
      title: "Home",
      type: MenuType.nested,
      parentId: "mn_root",
    });
    const mcp = mcpServerFullSchema.parse({
      id: "mcp_1",
      createdAt: now,
      updatedAt: now,
      name: "Filesystem",
      enabled: true,
      transport: McpServerTransport.stdio,
      credentialId: "cred_1",
    });
    const workflow = workflowFullSchema.parse({
      id: "wf_1",
      createdAt: now,
      updatedAt: now,
      name: "Main",
      description: null,
      type: WorkflowType.conversational,
      schedule: null,
      inputSchema: {},
      builtin: false,
      x: 0,
      y: 0,
      zoom: 1,
      direction: "horizontal",
      currentVersionId: "wfv_1",
      publishedVersionId: "wfv_1",
      createdById: "u_1",
    });

    expect(credential.owner).toBeNull();
    expect(label.group).toBeUndefined();
    expect(menu.parent).toBeUndefined();
    expect(mcp.credential).toBeUndefined();
    expect(workflow.currentVersion).toBeNull();
    expect(workflow.publishedVersion).toBeNull();
    expect(workflow.createdBy).toBeNull();
  });

  it("maps attachment aliases and strips unknown keys", () => {
    const parsed = attachmentSchema.parse({
      id: "a_1",
      createdAt: now,
      updatedAt: now,
      name: "file.png",
      type: "image/png",
      size: 100,
      location: "/tmp/file.png",
      resourceRef: AttachmentResourceRef.MessageAttachment,
      access: AttachmentAccess.Public,
      createdByRef: AttachmentCreatedByRef.Subscriber,
      createdById: "s_1",
      url: "/attachment/download/a_1/file.png",
      shouldDrop: true,
    });

    expect(parsed.createdBy).toBe("s_1");
    expect("createdById" in parsed).toBe(false);
    expect("shouldDrop" in parsed).toBe(false);
  });

  it("supports nullable nested attachment owner in full payloads", () => {
    const parsed = attachmentFullSchema.parse({
      id: "a_1",
      createdAt: now,
      updatedAt: now,
      name: "file.png",
      type: "image/png",
      size: 100,
      location: "/tmp/file.png",
      resourceRef: AttachmentResourceRef.MessageAttachment,
      access: AttachmentAccess.Public,
      createdByRef: AttachmentCreatedByRef.Subscriber,
      createdBy: null,
      url: "/attachment/download/a_1/file.png",
    });

    expect(parsed.createdBy).toBeNull();
  });

  it("preserves alias mapping for chat/cms/user-access plain contracts", () => {
    const label = labelSchema.parse({
      id: "l_1",
      createdAt: now,
      updatedAt: now,
      title: "VIP",
      name: "VIP",
      builtin: false,
      groupId: "g_1",
      users: [{ id: "s_1" }],
    });
    const subscriber = subscriberSchema.parse({
      id: "s_1",
      createdAt: now,
      updatedAt: now,
      firstName: "Ada",
      lastName: "Lovelace",
      language: "en",
      timezone: 0,
      locale: null,
      gender: null,
      country: null,
      foreignId: "foreign-s-1",
      assignedAt: null,
      lastvisit: null,
      retainedFrom: null,
      channel: { name: "web", data: null },
      labelIds: ["l_1"],
      assignedToId: "u_1",
      avatarId: "a_1",
      sourceId: "source_1",
    });
    const content = contentSchema.parse({
      id: "c_1",
      createdAt: now,
      updatedAt: now,
      title: "Welcome",
      status: true,
      properties: { body: "hello" },
      searchText: "Welcome hello",
      contentTypeId: "ct_1",
    });
    const permission = permissionSchema.parse({
      id: "p_1",
      createdAt: now,
      updatedAt: now,
      action: "read",
      relation: "role",
      modelId: "m_1",
      roleId: "r_1",
    });

    expect(label.group).toBe("g_1");
    expect("users" in label).toBe(true);
    expect(subscriber.labels).toEqual(["l_1"]);
    expect(subscriber.assignedTo).toBe("u_1");
    expect(subscriber.avatar).toBe("a_1");
    expect(subscriber.source).toBe("source_1");
    expect(content.contentType).toBe("ct_1");
    expect(permission.model).toBe("m_1");
    expect(permission.role).toBe("r_1");
  });

  it("parses source contracts and supports defaultWorkflowId alias", () => {
    const source = sourceSchema.parse({
      id: "source_1",
      createdAt: now,
      updatedAt: now,
      name: "main-web",
      channel: "web",
      settings: { allowed_domains: "https://example.com" },
      state: true,
      defaultWorkflowId: "wf_1",
    });
    const sourceFull = sourceFullSchema.parse({
      id: "source_1",
      createdAt: now,
      updatedAt: now,
      name: "main-web",
      channel: "web",
      settings: { allowed_domains: "https://example.com" },
      state: true,
      defaultWorkflow: {
        id: "wf_1",
        createdAt: now,
        updatedAt: now,
        name: "default",
        description: null,
        type: WorkflowType.conversational,
        schedule: null,
        inputSchema: {},
        builtin: false,
        x: 0,
        y: 0,
        zoom: 1,
        direction: "horizontal",
        createdBy: null,
        currentVersion: null,
        publishedVersion: null,
      },
    });
    const metadata = channelMetadataSchema.parse({
      name: "web",
      settingsSchema: {
        type: "object",
      },
    });
    const systemMetadata = channelMetadataSchema.parse({
      name: "console",
      visibility: "system",
      settingsSchema: {
        type: "object",
      },
    });

    expect(source.defaultWorkflow).toBe("wf_1");
    expect(sourceFull.defaultWorkflow?.id).toBe("wf_1");
    expect(metadata.name).toBe("web");
    expect(metadata.visibility).toBe("public");
    expect(systemMetadata.visibility).toBe("system");
  });

  it("accepts source and auditlog as valid model identities", () => {
    const model = modelSchema.parse({
      id: "m_source",
      createdAt: now,
      updatedAt: now,
      name: "Source",
      identity: "source",
      attributes: {},
    });

    expect(model.identity).toBe("source");
    expect(
      modelSchema.parse({
        id: "m_auditlog",
        createdAt: now,
        updatedAt: now,
        name: "AuditLog",
        identity: "auditlog",
        attributes: {},
      }).identity,
    ).toBe("auditlog");
  });

  it("parses audit log contracts", () => {
    const auditLog = auditLogSchema.parse({
      id: "audit_1",
      createdAt: now,
      updatedAt: now,
      resourceId: "user_1",
      resourceType: "User",
      resourceLabel: "admin",
      operationId: "typeorm.User.update",
      operationType: "Update",
      operationStatus: "SUCCEEDED",
      actorId: "admin_1",
      actorType: "admin",
      actorLabel: "Admin User (admin)",
      actorIp: "203.0.113.1",
      actorAgent: "browser",
      requestId: "req_1",
      requestMethod: "PATCH",
      requestPath: "/api/user/user_1",
      dataBefore: { email: "old@example.com" },
      dataAfter: { email: "new@example.com" },
      dataDiff: {
        email: {
          before: "old@example.com",
          after: "new@example.com",
        },
      },
      raw: null,
      shouldDrop: true,
    });

    expect(auditLog.resourceType).toBe("User");
    expect(auditLog.resourceLabel).toBe("admin");
    expect(auditLog.actorLabel).toBe("Admin User (admin)");
    expect("shouldDrop" in auditLog).toBe(false);
    expect(auditLogFullSchema.parse(auditLog).dataDiff).toEqual({
      email: {
        before: "old@example.com",
        after: "new@example.com",
      },
    });
  });

  it("normalizes nullable and optional values for setting/menu/mcp", () => {
    const setting = settingSchema.parse({
      id: "st_1",
      createdAt: now,
      updatedAt: now,
      group: "global_settings",
      subgroup: null,
      label: "title",
      value: "Hexabot",
    });
    const menu = menuSchema.parse({
      id: "mn_1",
      createdAt: now,
      updatedAt: now,
      title: "Home",
      type: MenuType.nested,
      parentId: null,
      payload: null,
      url: null,
    });
    const mcp = mcpServerSchema.parse({
      id: "mcp_1",
      createdAt: now,
      updatedAt: now,
      name: "Filesystem",
      enabled: true,
      transport: McpServerTransport.stdio,
      command: "npx",
      args: ["-y", "@mcp/server-filesystem"],
      url: null,
      cwd: "/tmp",
      credentialId: null,
      shouldDrop: true,
    });

    expect(setting.subgroup).toBeNull();
    expect(menu.parent).toBeNull();
    expect(mcp.credential).toBeNull();
    expect("shouldDrop" in mcp).toBe(false);
  });

  it("keeps credential outputs free of secret value fields", () => {
    const credential = credentialSchema.parse({
      id: "cred_1",
      createdAt: now,
      updatedAt: now,
      name: "OPENAI_API_KEY",
      ownerId: "u_1",
      value: "secret",
    });

    expect(credential.name).toBe("OPENAI_API_KEY");
    expect(credential.owner).toBe("u_1");
    expect("value" in credential).toBe(false);
  });

  it("keeps MCP token outputs free of token hashes", () => {
    const token = mcpTokenSchema.parse({
      id: "mt_1",
      createdAt: now,
      updatedAt: now,
      name: "Codex",
      tokenPrefix: "hbt_mcp_abcd",
      tokenHash: "secret-hash",
      ownerId: "u_1",
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
    });

    expect(token.name).toBe("Codex");
    expect(token.owner).toBe("u_1");
    expect("tokenHash" in token).toBe(false);
  });

  it("computes workflow derived fields via parser bridge", () => {
    const parser = jest.fn((yml: string) => ({
      defs: {},
      flow: [],
      outputs: {},
      yml,
    }));
    const parsed = createWorkflowFullSchema({ parseDefinition: parser }).parse({
      id: "wf_1",
      createdAt: now,
      updatedAt: now,
      name: "Main",
      description: null,
      type: WorkflowType.conversational,
      schedule: null,
      inputSchema: {},
      builtin: false,
      x: 0,
      y: 0,
      zoom: 1,
      direction: "horizontal",
      runAfterMs: 0,
      createdBy: {
        id: "u_1",
        createdAt: now,
        updatedAt: now,
        firstName: "Ada",
        lastName: "Lovelace",
        language: "en",
        timezone: 1,
        locale: null,
        gender: null,
        country: null,
        foreignId: "foreign-u-1",
        assignedAt: null,
        lastvisit: null,
        retainedFrom: null,
        channel: { name: "web" },
        username: "ada",
        email: "ada@example.com",
        sendEmail: false,
        state: true,
        resetCount: 0,
        resetToken: null,
        roles: [],
        labels: [],
        assignedTo: null,
        avatar: null,
      },
      currentVersion: {
        id: "wfv_1",
        createdAt: now,
        updatedAt: now,
        version: 1,
        definitionYml: "defs: {}\nflow: []\noutputs: {}",
        checksum: "sha",
        message: null,
        action: WorkflowVersionAction.create,
        workflowId: "wf_1",
        createdById: "u_1",
        parentVersionId: null,
      },
      publishedVersion: null,
    });

    expect(parsed.definitionYml).toContain("defs");
    expect(parsed.definition).toEqual({
      defs: {},
      flow: [],
      outputs: {},
      yml: "defs: {}\nflow: []\noutputs: {}",
    });
    expect(parser).toHaveBeenCalledTimes(1);
  });

  it("parses workflow export bundles without credential secrets", () => {
    const bundle = workflowExportBundleSchema.parse({
      kind: "hexabot.workflow.bundle",
      schemaVersion: 1,
      exportedAt: now,
      workflow: {
        exportId: "wf_1",
        name: "Main",
        description: null,
        type: WorkflowType.conversational,
        schedule: null,
        inputSchema: {},
        layout: {
          x: 0,
          y: 0,
          zoom: 1,
          direction: "horizontal",
        },
      },
      version: {
        number: 3,
        checksum: "sha",
        message: null,
        exportedVersionId: "wfv_1",
      },
      definitionYml: "defs: {}\nflow: []\noutputs: {}",
      resources: {
        memoryDefinitions: [
          {
            exportId: "mem_1",
            name: "Profile",
            slug: "profile",
            scope: MemoryScope.workflow,
            schema: { type: "object" },
            ttlSeconds: null,
          },
        ],
        mcpServers: [
          {
            exportId: "mcp_1",
            name: "Search",
            enabled: true,
            transport: McpServerTransport.http,
            url: "https://mcp.example.com",
            command: null,
            args: null,
            cwd: null,
            credentialExportId: "cred_1",
          },
        ],
        credentials: [
          {
            exportId: "cred_1",
            name: "Search API",
            exportedOwnerId: "u_1",
          },
        ],
        contentTypes: [
          {
            exportId: "ct_1",
            name: "Article",
            schema: { type: "object" },
          },
        ],
        labelGroups: [
          {
            exportId: "lg_1",
            name: "Status",
          },
        ],
        labels: [
          {
            exportId: "label_1",
            title: "Qualified",
            name: "QUALIFIED",
            description: null,
            groupExportId: "lg_1",
          },
        ],
        workflows: [
          {
            exportId: "wf_child",
            workflow: {
              name: "Child",
              description: "Called child workflow",
              type: WorkflowType.conversational,
              schedule: null,
              inputSchema: {},
              layout: {
                x: 10,
                y: 20,
                zoom: 1,
                direction: "horizontal",
              },
            },
            version: {
              number: 2,
              checksum: "child-sha",
              message: "Child version",
              exportedVersionId: "wfv_child",
            },
            definitionYml: "defs: {}\nflow: []\noutputs: {}",
          },
        ],
        knowledgeBases: [
          {
            exportId: "kb_1",
            name: "Docs",
            config: { index: "docs" },
          },
        ],
      },
    });

    expect(bundle.resources.credentials[0]).toEqual({
      exportId: "cred_1",
      name: "Search API",
      exportedOwnerId: "u_1",
    });
    expect(bundle.workflow.exportId).toBe("wf_1");
    expect(bundle.resources.contentTypes[0]?.name).toBe("Article");
    expect(bundle.resources.labelGroups[0]?.name).toBe("Status");
    expect(bundle.resources.labels[0]).toMatchObject({
      exportId: "label_1",
      groupExportId: "lg_1",
    });
    expect(bundle.resources.workflows[0]).toMatchObject({
      exportId: "wf_child",
      workflow: { name: "Child" },
      version: { exportedVersionId: "wfv_child" },
    });
    expect(bundle.resources.knowledgeBases).toEqual([
      {
        exportId: "kb_1",
        name: "Docs",
        config: { index: "docs" },
      },
    ]);
  });

  it("defaults new workflow bundle resource arrays for older bundles", () => {
    const bundle = workflowExportBundleSchema.parse({
      kind: "hexabot.workflow.bundle",
      schemaVersion: 1,
      exportedAt: now,
      workflow: {
        name: "Main",
        description: null,
        type: WorkflowType.conversational,
        schedule: null,
        inputSchema: {},
        layout: {
          x: 0,
          y: 0,
          zoom: 1,
          direction: "horizontal",
        },
      },
      version: {
        number: 1,
        checksum: "sha",
        message: null,
        exportedVersionId: "wfv_1",
      },
      definitionYml: "defs: {}\nflow: []\noutputs: {}",
      resources: {
        memoryDefinitions: [],
        mcpServers: [],
        credentials: [],
      },
    });

    expect(bundle.resources.contentTypes).toEqual([]);
    expect(bundle.resources.labelGroups).toEqual([]);
    expect(bundle.resources.labels).toEqual([]);
    expect(bundle.resources.workflows).toEqual([]);
  });

  it("rejects non-array custom workflow bundle resource buckets", () => {
    expect(() =>
      workflowExportBundleV1Schema.parse({
        kind: "hexabot.workflow.bundle",
        schemaVersion: 1,
        exportedAt: now,
        workflow: {
          name: "Main",
          description: null,
          type: WorkflowType.conversational,
          schedule: null,
          inputSchema: {},
          layout: {
            x: 0,
            y: 0,
            zoom: 1,
            direction: "horizontal",
          },
        },
        version: {
          number: 1,
          checksum: "sha",
          message: null,
          exportedVersionId: "wfv_1",
        },
        definitionYml: "defs: {}\nflow: []\noutputs: {}",
        resources: {
          memoryDefinitions: [],
          mcpServers: [],
          credentials: [],
          knowledgeBases: {
            exportId: "kb_1",
          },
        },
      }),
    ).toThrow();
  });

  it("rejects credential values in workflow export bundles", () => {
    expect(() =>
      workflowExportBundleV1Schema.parse({
        kind: "hexabot.workflow.bundle",
        schemaVersion: 1,
        exportedAt: now,
        workflow: {
          name: "Main",
          description: null,
          type: WorkflowType.conversational,
          schedule: null,
          inputSchema: {},
          layout: {
            x: 0,
            y: 0,
            zoom: 1,
            direction: "horizontal",
          },
        },
        version: {
          number: 1,
          checksum: "sha",
          message: null,
          exportedVersionId: "wfv_1",
        },
        definitionYml: "defs: {}\nflow: []\noutputs: {}",
        resources: {
          memoryDefinitions: [],
          mcpServers: [],
          credentials: [
            {
              exportId: "cred_1",
              name: "Search API",
              value: "secret",
            },
          ],
        },
      }),
    ).toThrow();
  });

  it("parses workflow import results", () => {
    const result = workflowImportResultSchema.parse({
      workflow: {
        id: "wf_1",
        createdAt: now,
        updatedAt: now,
        name: "Imported",
        description: null,
        type: WorkflowType.conversational,
        schedule: null,
        inputSchema: {},
        builtin: false,
        x: 0,
        y: 0,
        zoom: 1,
        direction: "horizontal",
        currentVersion: "wfv_1",
        publishedVersion: null,
        createdBy: "u_1",
        runAfterMs: 0,
      },
      resources: [
        {
          kind: "knowledgeBase",
          exportId: "kb_1",
          localId: "kb_local",
          name: "Docs",
          action: "reused",
        },
      ],
      warnings: ["Credential placeholder created."],
    });

    expect(result.resources[0]?.action).toBe("reused");
    expect(result.resources[0]?.kind).toBe("knowledgeBase");
  });

  it("computes workflow run duration and mixed triggeredBy coercion", () => {
    const run = workflowRunSchema.parse({
      id: "run_1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z",
      status: "finished",
      context: {},
      workflowId: "wf_1",
      workflowVersionId: "wfv_1",
      triggeredById: "s_1",
      threadId: "t_1",
      parentRun: "parent_run_1",
      finishedAt: "2026-01-01T00:02:00.000Z",
    });
    const full = workflowRunFullSchema.parse({
      id: "run_1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z",
      status: "running",
      context: {},
      workflow: {
        id: "wf_1",
        createdAt: now,
        updatedAt: now,
        name: "Main",
        description: null,
        type: WorkflowType.conversational,
        schedule: null,
        inputSchema: {},
        builtin: false,
        x: 0,
        y: 0,
        zoom: 1,
        direction: "horizontal",
        currentVersion: null,
        publishedVersion: null,
        createdBy: "u_1",
        runAfterMs: 0,
      },
      workflowVersion: null,
      triggeredBy: {
        id: "s_1",
        createdAt: now,
        updatedAt: now,
        firstName: "Sub",
        lastName: "User",
        language: "en",
        timezone: 0,
        locale: null,
        gender: null,
        country: null,
        foreignId: "foreign-s-1",
        assignedAt: null,
        lastvisit: null,
        retainedFrom: null,
        channel: { name: "web", data: {} },
        labels: [],
        assignedTo: null,
        avatar: null,
      },
      thread: null,
      parentRun: {
        id: "parent_run_1",
        createdAt: now,
        updatedAt: now,
        status: "suspended",
        context: {},
        workflowId: "parent_wf_1",
        workflowVersionId: null,
        triggeredById: null,
        parentRun: null,
      },
    });

    expect(run.duration).toBe(120000);
    expect(run.parentRun).toBe("parent_run_1");
    expect(full.triggeredBy?.id).toBe("s_1");
    expect(full.parentRun?.workflow).toBe("parent_wf_1");
    expect(typeof resolveRunDurationMs(run)).toBe("number");
  });

  it("falls back to subscriber parsing when user keys exist but are undefined", () => {
    const subscriberWithUndefinedUserFields = {
      id: "s_2",
      createdAt: now,
      updatedAt: now,
      firstName: "Sub",
      lastName: "User",
      language: "en",
      timezone: 0,
      locale: null,
      gender: null,
      country: null,
      foreignId: "foreign-s-2",
      assignedAt: null,
      lastvisit: null,
      retainedFrom: null,
      channel: { name: "web", data: {} },
      labels: [],
      assignedTo: null,
      avatar: null,
      type: "SubscriberOrmEntity",
      username: undefined,
      email: undefined,
      sendEmail: undefined,
      resetCount: undefined,
    };
    const run = workflowRunFullSchema.parse({
      id: "run_2",
      createdAt: now,
      updatedAt: now,
      status: "running",
      context: {},
      workflow: {
        id: "wf_2",
        createdAt: now,
        updatedAt: now,
        name: "Main",
        description: null,
        type: WorkflowType.conversational,
        schedule: null,
        inputSchema: {},
        builtin: false,
        x: 0,
        y: 0,
        zoom: 1,
        direction: "horizontal",
        currentVersion: null,
        publishedVersion: null,
        createdBy: "u_1",
        runAfterMs: 0,
      },
      workflowVersion: null,
      triggeredBy: subscriberWithUndefinedUserFields,
      thread: null,
    });
    const memoryRecord = memoryRecordFullSchema.parse({
      id: "mem_2",
      createdAt: now,
      updatedAt: now,
      value: { counter: 2 },
      definition: {
        id: "def_2",
        createdAt: now,
        updatedAt: now,
        name: "Session",
        slug: "session",
        scope: MemoryScope.workflow,
        schema: {},
      },
      owner: subscriberWithUndefinedUserFields,
      workflow: null,
      run: null,
      thread: null,
    });

    expect(run.triggeredBy?.id).toBe("s_2");
    expect(
      Object.prototype.hasOwnProperty.call(run.triggeredBy ?? {}, "username"),
    ).toBe(false);
    expect(memoryRecord.owner.id).toBe("s_2");
    expect(
      Object.prototype.hasOwnProperty.call(memoryRecord.owner, "username"),
    ).toBe(false);
  });

  it("coerces workflow memory aliases and test dummy fixtures", () => {
    const record = memoryRecordSchema.parse({
      id: "mem_1",
      createdAt: now,
      updatedAt: now,
      value: { counter: 1 },
      ttlSeconds: 60,
      expiresAt: null,
      definitionId: "def_1",
      ownerId: "u_1",
      workflowId: "wf_1",
      runId: "run_1",
      threadId: "th_1",
    });
    const dummy = dummySchema.parse({
      id: "d_1",
      createdAt: now,
      updatedAt: now,
      dummy: "ok",
      dynamicField: { field: FieldType.text },
      shouldDrop: true,
    });

    expect(record.definition).toBe("def_1");
    expect(record.owner).toBe("u_1");
    expect(record.workflow).toBe("wf_1");
    expect(record.run).toBe("run_1");
    expect(record.thread).toBe("th_1");
    expect(dummy.dynamicField).toEqual({ field: FieldType.text });
    expect("shouldDrop" in dummy).toBe(false);
  });

  it("supports analytics enums in stats payloads", () => {
    const stats = statsSchema.parse({
      id: "st_1",
      createdAt: now,
      updatedAt: now,
      type: StatsType.new_threads,
      day: now,
      value: 15,
      name: "New Threads",
    });

    expect(stats.type).toBe(StatsType.new_threads);
    expect(
      statsSchema.parse({
        ...stats,
        type: StatsType.handoffs,
        name: "Handoffs",
      }).type,
    ).toBe(StatsType.handoffs);
  });

  it("parses integration health payload contracts", () => {
    const health = integrationHealthResponseSchema.parse({
      checkedAt: now,
      integrations: [
        {
          id: "channel:web",
          kind: "channel",
          name: "Web",
          status: "healthy",
          checkedAt: now,
          reason: "channel.active_sources",
          message: "1 active source",
          details: {
            activeSources: 1,
            inactiveSources: 0,
          },
          shouldDrop: true,
        },
        {
          id: "service:smtp",
          kind: "service",
          name: "Email (SMTP)",
          status: "disabled",
          checkedAt: now,
        },
      ],
    });

    expect(health.integrations[0].status).toBe("healthy");
    expect(health.integrations[1].kind).toBe("service");
    expect("shouldDrop" in health.integrations[0]).toBe(false);
  });

  it("supports memory scope enum values", () => {
    expect(MemoryScope.workflow).toBe("workflow");
  });

  it("parses shared incoming and outgoing message payload contracts", () => {
    const expectedQuickReplies = [{ title: "Yes", payload: "yes" }];
    const outgoing = stdOutgoingMessageSchema.parse({
      type: OutgoingMessageType.quickReply,
      data: {
        text: "Hello from bot",
        quickReplies: expectedQuickReplies,
      },
    });
    const incoming = stdIncomingMessageSchema.parse({
      type: IncomingMessageType.location,
      data: {
        coordinates: { lat: 36.8, lon: 10.2 },
      },
    });

    expect(outgoing).toEqual({
      type: OutgoingMessageType.quickReply,
      data: {
        text: "Hello from bot",
        quickReplies: expectedQuickReplies,
      },
    });
    expect(incoming).toEqual({
      type: IncomingMessageType.location,
      data: {
        coordinates: { lat: 36.8, lon: 10.2 },
      },
    });
  });

  it("parses shared outgoing message envelopes including system type", () => {
    const textEnvelope = stdOutgoingEnvelopeSchema.parse({
      type: OutgoingMessageType.text,
      data: { text: "Hi" },
    });
    const systemEnvelope = stdOutgoingEnvelopeSchema.parse({
      type: OutgoingMessageType.system,
      data: { outcome: "ok", data: { source: "test" } },
    });

    expect(textEnvelope.type).toBe(OutgoingMessageType.text);
    expect(systemEnvelope.type).toBe(OutgoingMessageType.system);
    expect(stdOutgoingMessageSchema.safeParse(systemEnvelope).success).toBe(
      false,
    );
  });

  it("keeps outgoing quick replies and buttons in parsed message entities", () => {
    const base = {
      id: "msg_1",
      createdAt: now,
      updatedAt: now,
      read: false,
      delivery: false,
      handover: false,
      threadId: "th_1",
    };
    const quickRepliesMessage = messageSchema.parse({
      ...base,
      message: {
        type: OutgoingMessageType.quickReply,
        data: {
          text: "Choose one",
          quickReplies: [
            { title: "Yes", payload: "yes" },
            { title: "No", payload: "no" },
          ],
        },
      },
    });
    const buttonsMessage = messageSchema.parse({
      ...base,
      id: "msg_2",
      message: {
        type: OutgoingMessageType.buttons,
        data: {
          text: "Click one",
          buttons: [
            { type: "postback", title: "About", payload: "about" },
            { type: "web_url", title: "Website", url: "https://hexabot.ai" },
          ],
        },
      },
    });

    expect(quickRepliesMessage.message).toEqual({
      type: OutgoingMessageType.quickReply,
      data: {
        text: "Choose one",
        quickReplies: [
          { title: "Yes", payload: "yes" },
          { title: "No", payload: "no" },
        ],
      },
    });
    expect(buttonsMessage.message).toEqual({
      type: OutgoingMessageType.buttons,
      data: {
        text: "Click one",
        buttons: [
          { type: "postback", title: "About", payload: "about" },
          { type: "web_url", title: "Website", url: "https://hexabot.ai" },
        ],
      },
    });
  });

  it("keeps incoming postback payloads when parsing message entities", () => {
    const parsed = messageSchema.parse({
      id: "msg_postback",
      createdAt: now,
      updatedAt: now,
      read: false,
      delivery: false,
      handover: false,
      threadId: "th_1",
      message: {
        type: IncomingMessageType.postback,
        data: { text: "Clicked", payload: "about" },
      },
    });

    expect(parsed.message).toEqual({
      type: IncomingMessageType.postback,
      data: { text: "Clicked", payload: "about" },
    });
  });

  it("rejects legacy flat payloads and envelope aliases", () => {
    const legacyOutgoing = stdOutgoingMessageSchema.safeParse({
      text: "Hello from bot",
    });
    const legacyOutgoingFormatKey = stdOutgoingMessageSchema.safeParse({
      format: OutgoingMessageType.text,
      data: { text: "Hello from bot" },
    });
    const legacyIncomingTextValue = stdIncomingMessageSchema.safeParse({
      type: "message",
      data: { text: "Hello from user" },
    });
    const legacyIncomingQuickReplyValue = stdIncomingMessageSchema.safeParse({
      type: "quick_reply",
      data: { text: "Reply", payload: "yes" },
    });
    const legacyIncomingAttachmentValue = stdIncomingMessageSchema.safeParse({
      type: "attachments",
      data: {
        serializedText: "attachment:image:file.jpg",
        attachment: {
          type: "image",
          payload: { id: null, url: "https://example.com/file.jpg" },
        },
      },
    });
    const legacyIncomingSerializedTextKey = stdIncomingMessageSchema.safeParse({
      type: IncomingMessageType.attachment,
      data: {
        serialized_text: "attachment:image:file.jpg",
        attachment: {
          type: "image",
          payload: { id: null, url: "https://example.com/file.jpg" },
        },
      },
    });
    const legacyIncoming = stdIncomingMessageSchema.safeParse({
      type: IncomingMessageType.location,
      coordinates: { lat: 36.8, lon: 10.2 },
    });
    const legacyQuickRepliesAlias = stdOutgoingMessageSchema.safeParse({
      type: OutgoingMessageType.quickReply,
      data: {
        text: "Choose one",
        quick_replies: [{ title: "Yes", payload: "yes" }],
      },
    });
    const legacyEnvelopeShape = stdOutgoingEnvelopeSchema.safeParse({
      type: OutgoingMessageType.text,
      message: { text: "Hi" },
    });

    expect(legacyOutgoing.success).toBe(false);
    expect(legacyOutgoingFormatKey.success).toBe(false);
    expect(legacyIncomingTextValue.success).toBe(false);
    expect(legacyIncomingQuickReplyValue.success).toBe(false);
    expect(legacyIncomingAttachmentValue.success).toBe(false);
    expect(legacyIncomingSerializedTextKey.success).toBe(false);
    expect(legacyIncoming.success).toBe(false);
    expect(legacyQuickRepliesAlias.success).toBe(false);
    expect(legacyEnvelopeShape.success).toBe(false);
  });

  it("rejects plain-string message payloads in strict message schema", () => {
    const base = {
      id: "msg_1",
      createdAt: now,
      updatedAt: now,
      read: false,
      delivery: false,
      handover: false,
      threadId: "th_1",
    };
    const valid = messageSchema.safeParse({
      ...base,
      message: {
        type: OutgoingMessageType.text,
        data: { text: "Hello there" },
      },
    });
    const invalid = messageSchema.safeParse({
      ...base,
      message: "legacy-string-payload",
    });

    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
  });

  it("uses sender/recipient direction to validate ambiguous message types", () => {
    const base = {
      id: "msg_direction",
      createdAt: now,
      updatedAt: now,
      read: false,
      delivery: false,
      handover: false,
      threadId: "th_1",
    };
    const outgoingText = messageSchema.safeParse({
      ...base,
      recipient: "sub_1",
      message: {
        type: OutgoingMessageType.text,
        data: { text: "Bot text" },
      },
    });
    const incomingText = messageSchema.safeParse({
      ...base,
      sender: "sub_1",
      message: {
        type: IncomingMessageType.text,
        data: { text: "User text" },
      },
    });
    const invalidOutgoingAsIncoming = messageSchema.safeParse({
      ...base,
      recipient: "sub_1",
      message: {
        type: IncomingMessageType.postback,
        data: { text: "Clicked", payload: "go" },
      },
    });
    const invalidIncomingAsOutgoing = messageSchema.safeParse({
      ...base,
      sender: "sub_1",
      message: {
        type: OutgoingMessageType.buttons,
        data: {
          text: "Choose",
          buttons: [{ type: "postback", title: "Go", payload: "go" }],
        },
      },
    });

    expect(outgoingText.success).toBe(true);
    expect(incomingText.success).toBe(true);
    expect(invalidOutgoingAsIncoming.success).toBe(false);
    expect(invalidIncomingAsOutgoing.success).toBe(false);
  });
});
