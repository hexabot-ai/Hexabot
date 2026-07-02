/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  type ApiToken,
  type ApiTokenScope,
  AttachmentResourceRef,
  type IntegrationHealthResponse,
  type McpToken,
  type Workflow,
  type WorkflowImportResult,
} from "@hexabot-ai/types";
import { AxiosInstance, AxiosResponse } from "axios";

import { WorkflowBindingsCatalog } from "@/contexts/workflow-bindings.context";
import { IAction } from "@/types/action.types";
import { ILoginAttributes } from "@/types/auth/login.types";
import { IUserPermissions } from "@/types/auth/permission.types";
import { THook } from "@/types/base.types";
import { ICsrf } from "@/types/csrf.types";
import {
  IMcpServerDiagnostics,
  IMcpToolSummary,
} from "@/types/mcp-server.types";
import { IResetPayload, IResetRequest } from "@/types/reset.types";
import { ISettingSchemasMap } from "@/types/setting.types";
import {
  FailedWorkflowRunsLast24h,
  StatsSummary,
  ThreadSnapshot,
  ThreadSnapshotQuery,
} from "@/types/stat.types";
import { IProfileAttributes, User, UserStub } from "@/types/user.types";
import { applyFullNameDerivedFields } from "@/utils/full-name.utils";

import { EntityType, Format, TCount, TypeByFormat } from "./types";

export type RouteParams = Record<
  string,
  string | number | boolean | null | undefined
>;

export type McpTokenCreatePayload = {
  name: string;
  expiresAt?: string | null;
};

export type McpTokenCreateResponse = {
  token: string;
  record: McpToken;
};

export type ApiTokenCreatePayload = {
  name: string;
  expiresAt?: string | null;
  scopes: ApiTokenScope[];
};

export type ApiTokenCreateResponse = {
  token: string;
  record: ApiToken;
};

export type WorkflowExportFile = {
  blob: Blob;
  filename: string;
};

export const resolveRoute = (route: string, params?: RouteParams) => {
  if (!params) {
    return route;
  }

  return route.replace(/:([A-Za-z0-9_]+)/g, (match, key) => {
    const value = params[key];

    if (value === undefined || value === null) {
      return match;
    }

    return encodeURIComponent(String(value));
  });
};

export const ROUTES = {
  // Misc
  CONFIRM_ACCOUNT: "/user/confirm",
  LOGIN: "/auth/local",
  ME: "/auth/me",
  LOGOUT: "/auth/logout",
  PROFILE: "/user/edit",
  USER_PERMISSIONS: "/user/permissions",
  CSRF: "/csrftoken",
  REFRESH_TRANSLATIONS: "/translation/refresh",
  RESET: "/user/reset",
  CONTENT_IMPORT: "/content/import",
  STATS_SUMMARY: "/stats/summary",
  STATS_THREAD_SNAPSHOT: "/stats/thread-snapshot",
  STATS_FAILED_WORKFLOW_RUNS: "/stats/failed-workflow-runs",
  WORKFLOW_PUBLISH: "/workflow/:id/publish",
  WORKFLOW_UNPUBLISH: "/workflow/:id/unpublish",
  WORKFLOW_EXPORT: "/workflow/:id/export",
  WORKFLOW_IMPORT: "/workflow/import",
  WORKFLOW_BINDINGS: "/workflow/bindings",
  WORKFLOW_ACTIONS: "/workflow/actions/:type",
  MCP_SERVER_TEST: "/mcpserver/:id/test",
  MCP_TOOLS: "/mcpserver/:id/tools",
  API_TOKEN: "/api-token",
  MCP_TOKEN: "/mcp-token",
  INTEGRATION_HEALTH: "/stats/integration-health",
  SETTING_SCHEMAS: "setting/schemas",

  // Entities
  [EntityType.SUBSCRIBER]: "/subscriber",
  [EntityType.LABEL]: "/label",
  [EntityType.LABEL_GROUP]: "/labelgroup",
  [EntityType.ROLE]: "/role",
  [EntityType.USER]: "/user",
  [EntityType.PERMISSION]: "/permission",
  [EntityType.MODEL]: "/model",
  [EntityType.CREDENTIAL]: "/credential",
  [EntityType.MENU]: "/menu",
  [EntityType.MENUTREE]: "/menu/tree",
  [EntityType.CONTENT]: "/content",
  [EntityType.CONTENT_TYPE]: "/contenttype",
  [EntityType.SETTING]: "/setting",
  [EntityType.MESSAGE]: "/message",
  [EntityType.LANGUAGE]: "/language",
  [EntityType.TRANSLATION]: "/translation",
  [EntityType.ATTACHMENT]: "/attachment",
  [EntityType.CHANNEL]: "/channel",
  [EntityType.SOURCE]: "/source",
  [EntityType.HELPER]: "/helper",
  [EntityType.STORAGE_HELPER]: "/helper/storage",
  [EntityType.WORKFLOW]: "/workflow",
  [EntityType.WORKFLOW_VERSION]: "/workflow/:id/versions",
  [EntityType.WORKFLOW_RUN]: "/workflowrun",
  [EntityType.MCP_SERVER]: "/mcpserver",
  [EntityType.MEMORY_DEFINITION]: "/memorydefinition",
  [EntityType.AUDIT_LOG]: "/auditlog",
  [EntityType.THREAD]: "/thread",
} as const;

export class TranslatableMethods {
  constructor(protected readonly request: AxiosInstance) {}

  async getByPath<TResponse = unknown>(
    path: string,
    params?: Record<string, unknown>,
  ) {
    const { data } = await this.request.get<TResponse>(path, { params });

    return data;
  }

  async getWorkflowBindings() {
    const { data } = await this.request.get<WorkflowBindingsCatalog>(
      ROUTES.WORKFLOW_BINDINGS,
    );

    return data;
  }

  async getSettingSchemas() {
    const { data } = await this.request.get<ISettingSchemasMap>(
      ROUTES.SETTING_SCHEMAS,
    );

    return data;
  }

  async getActions(type: string) {
    const route = resolveRoute(ROUTES.WORKFLOW_ACTIONS, { type });
    const { data } = await this.request.get<IAction[]>(route);

    return data;
  }
}

export class ApiClient extends TranslatableMethods {
  constructor(protected readonly request: AxiosInstance) {
    super(request);
  }

  async getCsrf() {
    const { data } = await this.request.get<ICsrf>(ROUTES.CSRF, {
      withCredentials: true,
    });

    return data;
  }

  async login(payload: ILoginAttributes) {
    const { data } = await this.request.post<
      User,
      AxiosResponse<User>,
      ILoginAttributes
    >(ROUTES.LOGIN, payload);

    return applyFullNameDerivedFields(data);
  }

  async logout() {
    const { data } = await this.request.post<{ status: "ok" }>(ROUTES.LOGOUT);

    return data;
  }

  async getCurrentSession() {
    const { data } = await this.request.get<User>(ROUTES.ME);

    return applyFullNameDerivedFields(data);
  }

  async updateProfile(id: string, payload: Partial<IProfileAttributes>) {
    const { _csrf } = await this.getCsrf();
    const formData = new FormData();

    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined) {
        formData.append(key, value as string | Blob);
      }
    }

    // Append the CSRF token
    formData.append("_csrf", _csrf);

    const { data } = await this.request.patch<
      UserStub,
      AxiosResponse<UserStub>,
      FormData
    >(`${ROUTES.PROFILE}/${id}?_csrf=${_csrf}`, formData);

    return applyFullNameDerivedFields(data);
  }

  async confirmAccount(payload: { token: string }) {
    const { _csrf } = await this.getCsrf();
    const { data } = await this.request.post<
      never,
      AxiosResponse<never>,
      ICsrf
    >(`${ROUTES.CONFIRM_ACCOUNT}`, {
      ...payload,
      _csrf,
    });

    return data;
  }

  async getUserPermissions() {
    const { data } = await this.request.get<IUserPermissions>(
      ROUTES.USER_PERMISSIONS,
    );

    return data;
  }
  async requestResetPassword(payload: IResetRequest) {
    const { data } = await this.request.post<
      IResetRequest,
      AxiosResponse<void>,
      IResetRequest
    >(ROUTES.RESET, payload);

    return data;
  }

  async getStatsSummary() {
    const { data } = await this.request.get<StatsSummary>(ROUTES.STATS_SUMMARY);

    return data;
  }

  async getThreadSnapshot(params?: ThreadSnapshotQuery) {
    const { data } = await this.request.get<ThreadSnapshot>(
      ROUTES.STATS_THREAD_SNAPSHOT,
      { params },
    );

    return data;
  }

  async getFailedWorkflowRunsLast24h(limit = 3) {
    const { data } = await this.request.get<FailedWorkflowRunsLast24h>(
      ROUTES.STATS_FAILED_WORKFLOW_RUNS,
      { params: { limit } },
    );

    return data;
  }

  async getIntegrationHealth() {
    const { data } = await this.request.get<IntegrationHealthResponse>(
      ROUTES.INTEGRATION_HEALTH,
    );

    return data;
  }

  async refreshTranslations() {
    const { _csrf } = await this.getCsrf();
    const { data } = await this.request.post<{
      acknowledged: boolean;
      deletedCount: number;
    }>(ROUTES.REFRESH_TRANSLATIONS, { _csrf });

    return data;
  }

  async resetPassword(token: string, payload: IResetPayload) {
    const { data } = await this.request.post<
      IResetPayload,
      AxiosResponse<void>,
      IResetPayload
    >(`${ROUTES.RESET}/${token}`, payload);

    return data;
  }

  async importContent(contentTypeId: string, attachmentId: string) {
    const { data } = await this.request.get(
      `${ROUTES.CONTENT_IMPORT}/${contentTypeId}/${attachmentId}`,
    );

    return data;
  }

  async testMcpServer(id: string) {
    const { _csrf } = await this.getCsrf();
    const route = resolveRoute(ROUTES.MCP_SERVER_TEST, { id });
    const { data } = await this.request.post<IMcpServerDiagnostics>(route, {
      _csrf,
    });

    return data;
  }

  async getMcpTools(id: string) {
    const route = resolveRoute(ROUTES.MCP_TOOLS, { id });
    const { data } = await this.request.get<IMcpToolSummary[]>(route);

    return data;
  }

  async listApiTokens() {
    const { data } = await this.request.get<ApiToken[]>(ROUTES.API_TOKEN);

    return data;
  }

  async listApiTokenScopes() {
    const { data } = await this.request.get<ApiTokenScope[]>(
      `${ROUTES.API_TOKEN}/scopes`,
    );

    return data;
  }

  async createApiToken(payload: ApiTokenCreatePayload) {
    const { _csrf } = await this.getCsrf();
    const { data } = await this.request.post<
      ApiTokenCreateResponse,
      AxiosResponse<ApiTokenCreateResponse>,
      ApiTokenCreatePayload & ICsrf
    >(ROUTES.API_TOKEN, {
      ...payload,
      _csrf,
    });

    return data;
  }

  async revokeApiToken(id: string) {
    const { _csrf } = await this.getCsrf();
    const { data } = await this.request.post<ApiToken>(
      `${ROUTES.API_TOKEN}/${encodeURIComponent(id)}/revoke`,
      { _csrf },
    );

    return data;
  }

  async listMcpTokens() {
    const { data } = await this.request.get<McpToken[]>(ROUTES.MCP_TOKEN);

    return data;
  }

  async createMcpToken(payload: McpTokenCreatePayload) {
    const { _csrf } = await this.getCsrf();
    const { data } = await this.request.post<
      McpTokenCreateResponse,
      AxiosResponse<McpTokenCreateResponse>,
      McpTokenCreatePayload & ICsrf
    >(ROUTES.MCP_TOKEN, {
      ...payload,
      _csrf,
    });

    return data;
  }

  async revokeMcpToken(id: string) {
    const { _csrf } = await this.getCsrf();
    const { data } = await this.request.post<McpToken>(
      `${ROUTES.MCP_TOKEN}/${encodeURIComponent(id)}/revoke`,
      { _csrf },
    );

    return data;
  }

  async publishWorkflow(id: string) {
    const { _csrf } = await this.getCsrf();
    const route = resolveRoute(ROUTES.WORKFLOW_PUBLISH, { id });
    const { data } = await this.request.post<Workflow>(route, { _csrf });

    return data;
  }

  async exportWorkflow(id: string): Promise<WorkflowExportFile> {
    const route = resolveRoute(ROUTES.WORKFLOW_EXPORT, { id });
    const response = await this.request.get<Blob>(route, {
      responseType: "blob",
    });
    const contentDisposition = response.headers["content-disposition"];
    const filename = this.getFilenameFromContentDisposition(
      typeof contentDisposition === "string" ? contentDisposition : null,
    );

    return {
      blob: response.data,
      filename: filename || "workflow.workflow.yml",
    };
  }

  async importWorkflowBundle(file: File): Promise<WorkflowImportResult> {
    const { _csrf } = await this.getCsrf();
    const formData = new FormData();

    formData.append("file", file);

    const { data } = await this.request.post<
      WorkflowImportResult,
      AxiosResponse<WorkflowImportResult>,
      FormData
    >(ROUTES.WORKFLOW_IMPORT, formData, {
      params: { _csrf },
    });

    return data;
  }

  async unpublishWorkflow(id: string) {
    const { _csrf } = await this.getCsrf();
    const route = resolveRoute(ROUTES.WORKFLOW_UNPUBLISH, { id });
    const { data } = await this.request.post<Workflow>(route, { _csrf });

    return data;
  }

  async publishWorkflowVersion(workflowId: string, versionId: string) {
    const { _csrf } = await this.getCsrf();
    const route = resolveRoute(ROUTES[EntityType.WORKFLOW], {});
    const { data } = await this.request.patch<Workflow>(
      `${route}/${encodeURIComponent(workflowId)}`,
      {
        _csrf,
        publishedVersion: versionId,
      },
    );

    return data;
  }

  private getFilenameFromContentDisposition(
    contentDisposition: string | null,
  ): string | null {
    if (!contentDisposition) {
      return null;
    }

    const utf8Filename = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);

    if (utf8Filename?.[1]) {
      return decodeURIComponent(utf8Filename[1].trim().replace(/^"|"$/g, ""));
    }

    const filename = contentDisposition.match(/filename="?([^";]+)"?/i);

    return filename?.[1]?.trim() ?? null;
  }

  getRequest() {
    return this.request;
  }

  buildEntityClient<TE extends THook["entity"] = never>(
    entity: TE,
    routeParams?: RouteParams,
  ) {
    return EntityApiClient.getInstance(this.request, entity, routeParams);
  }
}

export class EntityApiClient<
  TE extends THook["entity"],
  TBasic = THook<{ entity: TE }>["basic"],
  TFull = THook<{ entity: TE }>["full"],
  TAttr = THook<{ entity: TE }>["attributes"],
  TFilters = THook<{ entity: TE }>["filters"],
> extends ApiClient {
  constructor(
    request: AxiosInstance,
    private readonly type: TE,
    private readonly routeParams?: RouteParams,
  ) {
    super(request);
  }

  static getInstance<TE extends THook["entity"]>(
    request: AxiosInstance,
    entity: TE,
    routeParams?: RouteParams,
  ) {
    return new EntityApiClient<TE>(request, entity, routeParams);
  }

  private getRoute(routeParams?: RouteParams) {
    return resolveRoute(ROUTES[this.type], routeParams ?? this.routeParams);
  }

  /**
   * Create an entry to the given entity type.
   */
  async create(payload: TAttr, routeParams?: RouteParams) {
    const { _csrf } = await this.getCsrf();
    const { data } = await this.request.post<
      TBasic,
      AxiosResponse<TBasic>,
      TAttr
    >(this.getRoute(routeParams), { ...payload, _csrf });

    return data;
  }

  async import<T = TBasic>(
    file: File,
    params?: any,
    routeParams?: RouteParams,
  ) {
    const { _csrf } = await this.getCsrf();
    const formData = new FormData();

    formData.append("file", file);

    const { data } = await this.request.post<T[], AxiosResponse<T[]>, FormData>(
      `${this.getRoute(routeParams)}/import`,
      formData,
      {
        params: { _csrf, ...params },
      },
    );

    return data;
  }

  async upload(
    file: File,
    resourceRef?: AttachmentResourceRef,
    routeParams?: RouteParams,
  ) {
    const { _csrf } = await this.getCsrf();
    const formData = new FormData();

    formData.append("file", file);

    const { data } = await this.request.post<
      TBasic[],
      AxiosResponse<TBasic[]>,
      FormData
    >(
      `${this.getRoute(routeParams)}/upload?_csrf=${_csrf}${
        resourceRef ? `&resourceRef=${resourceRef}` : ""
      }`,
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      },
    );

    return data[0];
  }

  private serializePopulate<P = string[] | undefined>(populate: P) {
    return ((populate || []) as string[]).join(",");
  }

  async get<
    P = string[] | undefined,
    F extends Format = P extends undefined ? Format.BASIC : Format.FULL,
    T = TypeByFormat<F, TBasic, TFull>,
  >(id?: string, populate?: P, routeParams?: RouteParams) {
    const { data } = await this.request.get<T>(
      `${this.getRoute(routeParams)}${id ? `/${id}` : ""}`,
      {
        params: {
          ...(Array.isArray(populate) &&
            populate.length && { populate: this.serializePopulate(populate) }),
        },
      },
    );

    return data;
  }

  async find<
    P = string[] | undefined,
    F extends Format = P extends undefined ? Format.BASIC : Format.FULL,
    T = TypeByFormat<F, TBasic, TFull>,
  >(params: any, populate: P, routeParams?: RouteParams) {
    const { data } = await this.request.get<T[]>(this.getRoute(routeParams), {
      params: {
        ...params,
        ...(Array.isArray(populate) &&
          populate.length && { populate: this.serializePopulate(populate) }),
      },
    });

    return data;
  }

  /**
   * Update an entry in a entity type.
   */
  async update(id: string, payload: Partial<TAttr>, routeParams?: RouteParams) {
    const { _csrf } = await this.getCsrf();
    const { data } = await this.request.patch<TBasic>(
      `${this.getRoute(routeParams)}/${id}`,
      {
        ...payload,
        _csrf,
      },
    );

    return data;
  }

  /**
   * Bulk Update entries.
   */
  async updateMany(
    ids: string[],
    payload: Partial<TAttr>,
    routeParams?: RouteParams,
  ) {
    const { _csrf } = await this.getCsrf();
    const { data } = await this.request.patch<string>(
      `${this.getRoute(routeParams)}/bulk`,
      {
        _csrf,
        ids,
        payload,
      },
    );

    return data;
  }

  /**
   * Delete an entry.
   */
  async delete(id: string, routeParams?: RouteParams) {
    const { _csrf } = await this.getCsrf();
    const { data } = await this.request.delete<string>(
      `${this.getRoute(routeParams)}/${id}`,
      {
        data: { _csrf },
      },
    );

    return data;
  }

  /**
   * Bulk Delete entries.
   */
  async deleteMany(ids: string[], routeParams?: RouteParams) {
    const { _csrf } = await this.getCsrf();
    const { data } = await this.request.delete<string>(
      this.getRoute(routeParams),
      {
        data: {
          _csrf,
          ids,
        },
      },
    );

    return data;
  }

  /**
   * Count elements.
   */
  async count(params: { where?: TFilters }, routeParams?: RouteParams) {
    const { data } = await this.request.get<TCount>(
      `${this.getRoute(routeParams)}/count`,
      {
        params,
      },
    );

    return { count: data.count };
  }
}
