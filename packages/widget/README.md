# Hexabot Live Chat Widget

The [Hexabot](https://hexabot.ai/) Live Chat Widget is a React-based embeddable widget that allows users to integrate real-time chat functionality into their websites. It connects to the Hexabot API and facilitates seamless interaction between end-users and chatbots across multiple channels.

[Hexabot](https://hexabot.ai/) is a chatbot / agent solution that allows users to create and manage AI-powered, multi-channel, and multilingual chatbots with ease. If you would like to learn more, please visit the [official GitHub repository](https://github.com/hexabot-ai/Hexabot/).

## Key Features

- **Real-Time Chat:** Engage in real-time conversations with users directly through your website.
- **Customizable:** Easily customize the widget's appearance and behavior to fit your brand and website.
- **Multi-Channel Support:** Integrates with multiple messaging platforms through the Hexabot API.
- **Embeddable:** Simple to embed and integrate into any web page with just a few lines of code.

## Directory Structure

The Hexabot Live Chat Widget is organized into the following directory structure, under `src` we have:

- **src/index.tsx:** Public npm and library entry point.
- **src/components:** Reusable React components that make up the chat widget interface, such as message bubbles, input fields, and buttons.
- **src/constants:** Hard-coded values such as default colors.
- **src/hooks:** Custom React hooks for managing widget state and handling side effects like API calls or real-time events.
- **src/providers:** Context providers for managing global state, such as user session, chat messages, and widget configurations.
- **src/test:** Test setup for Vitest and jsdom.
- **src/theme:** Theme contracts, utilities, and CSS variable defaults.
- **src/translations:** Contains translations for widget strings.
- **src/types:** Defines the TypeScript interfaces, types, and enums used.
- **src/utils:** Utility functions and helpers used throughout the widget, such as formatting, validations, or data transformations.
- **/public:** Contains static files that are publicly accessible. This includes the main HTML template where the widget is embedded for local development.

## Run the Live Chat Widget

### Dev Mode

Start the widget dev server from the repository root:

```bash
pnpm --filter @hexabot-ai/widget run dev
```

The live chat widget will be accessible at <http://localhost:5173>.

### Build for Production

Compile the distributable bundle:

```bash
pnpm --filter @hexabot-ai/widget run build
```

This will generate a production-ready build in the dist folder.

### Preview the Bundle

```bash
pnpm --filter @hexabot-ai/widget run preview
```

The preview server is helpful for validating the compiled assets before publishing.

### Serve the Bundle

```bash
pnpm --filter @hexabot-ai/widget run serve
```

Unlike `preview`, this serves `dist` through a plain static file server
instead of Vite's dev-oriented middleware — use it to check what a CDN or
self-hosted deployment will actually send over the wire. Both commands
default to port `5174`, so run only one at a time.

## React Package Usage

Install `@hexabot-ai/widget` alongside React 18 or React 19, then import the
component and stylesheet from the package root:

```tsx
import { ChatWidget } from "@hexabot-ai/widget";
import "@hexabot-ai/widget/style.css";

export function SupportChat() {
  return (
    <ChatWidget
      apiUrl="http://localhost:3000"
      channel="web"
      sourceId="replace-with-source-id"
      primaryColor="#29998e"
      language="en"
      transport="ws"
    />
  );
}
```

The default export is the same component. `UiChatWidget` is also available as a
named export for applications that need custom launchers, headers, avatars, or
pre-chat screens (`PreChat`). It renders its `children` inside the widget's
providers, after the launcher.
Component integration renders directly in the application's DOM, so
`shadowDom` and `css` are exclusive to the imperative API.

### Known Visitors

When the host application already knows the visitor, pass their name as
`profile`. The widget then subscribes them without showing the name form:

```tsx
<ChatWidget
  apiUrl="http://localhost:3000"
  channel="web"
  sourceId="replace-with-source-id"
  profile={{ firstName: "Ada", lastName: "Lovelace" }}
/>
```

`profile` is ignored once the browser session has a subscriber. Unlike the
name form's "Get started" button, it sends no `GET_STARTED` postback, so the
conversation workflow does not run until the visitor writes. The imperative
`config()` API accepts `profile` too.

### Custom Composer and Chat API

`useChat()` gives components rendered inside `UiChatWidget` the conversation
and the actions that drive it. Use it in a `CustomComposer`, which replaces the
input area under the messages (quick replies included), or in `PreChat`,
`CustomHeader`, `CustomLauncher`, and `children`:

```tsx
import { UiChatWidget, useChat } from "@hexabot-ai/widget";
import { useState } from "react";

function Composer() {
  const { sendText, suggestions, sendQuickReply } = useChat();
  const [text, setText] = useState("");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        sendText(text);
        setText("");
      }}
    >
      {suggestions.map((suggestion) => (
        <button
          key={suggestion.payload}
          type="button"
          onClick={() => sendQuickReply(suggestion)}
        >
          {suggestion.text}
        </button>
      ))}
      <input value={text} onChange={(event) => setText(event.target.value)} />
    </form>
  );
}

export function SupportChat() {
  return (
    <UiChatWidget
      config={{
        apiUrl: "http://localhost:3000",
        channel: "web",
        sourceId: "replace-with-source-id",
      }}
      CustomComposer={Composer}
    />
  );
}
```

`useChat()` returns:

- `messages`, `connectionState`, `profile`, `suggestions`, `menu`, and
  `isOpen`, with `open()` and `close()` for the window.
- `subscribe(profile?)`, which subscribes like the name form but sends no
  `GET_STARTED` postback.
- `sendText(text)`, `sendFile(file)`, `sendPostback(payload, title)`, and
  `sendQuickReply(suggestion)`.

`menu` holds the source's persistent menu even when the source's "Persistent
menu" setting is off. That setting only hides the widget's menu button, so a
host can render the menu its own way and send items with `sendPostback`.

Sends resolve once the server acknowledges the message. A failed send does not
reject: it moves `connectionState` to `ConnectionState.error`. `sendFile`
rejects, without sending, a file that the source's allowed upload types or
`maxUploadSize` refuse. A `CustomComposer` that returns `null` removes the
input area, for example to render the composer as a `children` element outside
the chat window.

### Callbacks

`onMessage` and `onConnectionChange` work with every integration, the
imperative `config()` API included:

```js
const embed = HexabotWidget.config({
  id: "hexabot-chat-widget",
  apiUrl: "http://localhost:3000",
  channel: "web",
  sourceId: "replace-with-source-id",
  onMessage: (message) => console.log(message.direction, message),
  onConnectionChange: (state) => {
    if (state === HexabotWidget.ConnectionState.error) {
      console.warn("Chat unavailable");
    }
  },
});
```

`onMessage` receives each message the socket delivers, sent or received. It
does not replay the history loaded on connect, which `useChat().messages`
holds. `onConnectionChange` receives a `ConnectionState` on mount and on every
change.

## Embed Chat Widget

React and ReactDOM are peer dependencies and are not bundled with the widget.
Choose one of the following embed integrations.

### Script-Tag Integrations

#### Legacy ReactDOM Render

This preserves the original browser integration. It uses React 18 because
`ReactDOM.render()` is not available in React 19 and React 19 does not publish
official UMD browser bundles.

```html
<script
  crossorigin
  src="https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js"
></script>
<script
  crossorigin
  src="https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.production.min.js"
></script>
<link rel="stylesheet" href="<<WIDGET URL>>/style.css" />
<script src="<<WIDGET URL>>/hexabot-widget.umd.js"></script>

<div id="hexabot-chat-widget"></div>
<script>
  ReactDOM.render(
    React.createElement(HexabotWidget, {
      apiUrl: "http://localhost:3000",
      channel: "web",
      sourceId: "replace-with-source-id",
      primaryColor: "#29998e",
      language: "en",
      transport: "ws",
    }),
    document.getElementById("hexabot-chat-widget"),
  );
</script>
```

#### Imperative Embed API

`config()` returns a handle containing exactly `show()`, `hide()`, and
`destroy()`.

The HTML version uses the React 18 UMD globals:

```html
<script
  crossorigin
  src="https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js"
></script>
<script
  crossorigin
  src="https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.production.min.js"
></script>
<link rel="stylesheet" href="<<WIDGET URL>>/style.css" />
<script src="<<WIDGET URL>>/hexabot-widget.umd.js"></script>

<div id="hexabot-chat-widget"></div>
<script>
  const embed = HexabotWidget.config({
    id: "hexabot-chat-widget",
    apiUrl: "http://localhost:3000",
    channel: "web",
    sourceId: "replace-with-source-id",
    primaryColor: "#29998e",
    language: "en",
    transport: "ws",
  });

  embed.show();

  // Call when needed:
  // embed.hide();
  // embed.destroy();
</script>
```

### Module Import Integrations

#### Imperative API in a React Component

The component wrapper supports React 18 and React 19 through a bundler. It
creates the imperative widget after its container mounts and destroys it during
cleanup:

```tsx
import HexabotWidget from "@hexabot-ai/widget";
import "@hexabot-ai/widget/style.css";
import { useEffect, useRef } from "react";

export function ImperativeChatWidget() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const embed = HexabotWidget.config({
      id: containerRef.current,
      apiUrl: "http://localhost:3000",
      channel: "web",
      sourceId: "replace-with-source-id",
      primaryColor: "#29998e",
      language: "en",
      transport: "ws",
    });

    embed.show();

    return () => embed.destroy();
  }, []);

  return <div ref={containerRef} />;
}
```

`show()` makes the widget visible, preserving its existing state after a
`hide()`. `destroy()` permanently unmounts the widget and releases its React
root. A destroyed handle cannot be shown again.

`config()` accepts an element ID, CSS selector, or `Element` as `id`.

To isolate the widget from host-page CSS, pass `shadowDom: true` and provide the
stylesheet URL through `css`:

```js
const embed = HexabotWidget.config({
  id: "hexabot-chat-widget",
  css: "<<WIDGET URL>>/style.css",
  shadowDom: true,
  apiUrl: "http://localhost:3000",
  channel: "web",
  sourceId: "replace-with-source-id",
});

embed.show();
```

Replace `apiUrl`, `sourceId`, and the other example values with the deployment's
widget configuration. `transport` is optional and accepts `ws` (default) or
`polling`.

For stable releases, pin the major version:
`https://cdn.jsdelivr.net/npm/@hexabot-ai/widget@3/dist/`

jsDelivr uses the package published in the npm registry:
<https://www.npmjs.com/package/@hexabot-ai/widget>

## Examples

As a proof of concept, we developed a WordPress plugin to embed the chat widget
in a WordPress website:
[hexabot-wordpress-live-chat-widget](https://github.com/hexabot-ai/hexabot-wordpress-live-chat-widget).

## Customization

You can customize the look and feel of the chat widget by modifying the widget’s scss styles or behavior. The widget allows you to:

- Change colors and fonts to match your website's branding.
- Configure user settings like language and chatbot response preferences.

The launcher (`.hb-launcher`) and the chat window (`.hb-chat-window`) are fixed
to the bottom-right corner, and the window fills the screen at widths of 450px
and below. The stock stylesheet styles nothing outside the widget (its
normalize.css reset is scoped to `.hb-theme-root`) and declares nothing
`!important`, so plain CSS overrides it. Prefix selectors with
`.hb-theme-root` to win regardless of stylesheet order, and keep window
offsets out of the phone layout:

```css
/* Clear a 64px sticky footer */
.hb-theme-root .hb-launcher {
  bottom: 84px;
}

@media (min-width: 451px) {
  .hb-theme-root .hb-chat-window {
    bottom: 164px;
  }
}
```

## Contributing

We welcome contributions from the community! Whether you want to report a bug, suggest new features, or submit a pull request, your input is valuable to us.

Feel free to join us on [Discord](https://discord.gg/rNb9t2MFkG)

## License

Copyright (c) 2025 Hexastack.

This project is licensed under the **Fair Core License, Version 1.0**, with **Apache License 2.0** as the future license (abbrev. **FCL-1.0-ALv2**).

**Change date.** For each version of the software, the Fair Core License converts to Apache-2.0 on the **second anniversary** of the date that version is made available.

**Commercial features & license keys.** Certain features of Hexabot are protected by license-key checks. You **must not** remove, modify, disable, or circumvent those checks, nor enable access to protected functionality without a valid license key.

**Competing uses (non-compete).** Use that competes with Hexastack’s business—for example, offering Hexabot (or a substantially similar service) as a hosted or commercial product—is not permitted until the conversion to Apache-2.0 for the applicable version.

**Redistribution.** If you distribute copies, modifications, or derivatives, you must include this license and not remove copyright or proprietary notices.

**Patents.** A limited patent license is granted for permitted uses and terminates on patent aggression.

**Trademarks.** “Hexabot” and “Hexastack” are trademarks. Except to identify Hexastack as the origin of the software, no trademark rights are granted.

**Disclaimer.** The software is provided “AS IS,” without warranties or conditions of any kind, and Hexastack will not be liable for any damages arising from its use.
