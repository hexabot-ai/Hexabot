/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import "@xyflow/react/dist/style.css";

import "@hexabot-ai/graph/workflow.css";
import { loader } from "@monaco-editor/react";
import { CssBaseline } from "@mui/material";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import * as monaco from "monaco-editor";
import { SnackbarProvider } from "notistack";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "@/App";
import { SnackbarCloseButton } from "@/app-components/displays/Toast/CloseButton";
import BroadcastChannelProvider from "@/contexts/broadcast-channel.context";
import { ConfigProvider } from "@/contexts/config.context";
import { SettingsProvider } from "@/contexts/setting.context";
import { SocketProvider } from "@/websocket/socket-hooks";

import { DialogsProvider } from "./contexts/dialogs.context";
import AppTheme from "./layout/theme/AppTheme";
import { ApiClientProvider } from "./providers/ApiClientProvider";
import { AuthProvider } from "./providers/AuthProvider";
import { PermissionProvider } from "./providers/PermissionProvider";

import "@/components/visual-editor/v4/components/yaml-editor/styles/yaml-editor.css";
import "@/i18n/config";
import "@/styles/globals.css";
import "@fontsource/roboto/100.css";
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import "@fontsource/roboto/900.css";

loader.config({ monaco });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 2,
      gcTime: 1000 * 60 * 60,
    },
  },
});
const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

ReactDOM.createRoot(rootElement).render(
  <BrowserRouter
    future={{ v7_relativeSplatPath: false, v7_startTransition: false }}
  >
    <ConfigProvider>
      <AppTheme>
        <CssBaseline enableColorScheme />
        <SnackbarProvider
          maxSnack={3}
          anchorOrigin={{ vertical: "top", horizontal: "center" }}
          action={(snackbarKey) => (
            <SnackbarCloseButton snackbarKey={snackbarKey} />
          )}
        >
          <QueryClientProvider client={queryClient}>
            <BroadcastChannelProvider channelName="main-channel">
              <ApiClientProvider>
                <AuthProvider>
                  <PermissionProvider>
                    <SettingsProvider>
                      <DialogsProvider>
                        <SocketProvider>
                          <App />
                        </SocketProvider>
                      </DialogsProvider>
                    </SettingsProvider>
                  </PermissionProvider>
                </AuthProvider>
              </ApiClientProvider>
            </BroadcastChannelProvider>
            <ReactQueryDevtools
              initialIsOpen={false}
              buttonPosition="bottom-left"
            />
          </QueryClientProvider>
        </SnackbarProvider>
      </AppTheme>
    </ConfigProvider>
  </BrowserRouter>,
);
