/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import React from "react";
import ReactDOM from "react-dom/client";

import ChatWidget from "./ChatWidget.tsx";

import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ChatWidget
      {...{
        apiUrl: "http://localhost:3000/api",
        channel: "web",
        sourceId: "7a59d3c3-b84c-40ac-9263-973bbe5843bc",
        language: "en",
        primaryColor: "#1BA089",
      }}
    />
  </React.StrictMode>,
);
