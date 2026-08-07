# Hexabot Live Chat Widget

The [Hexabot](https://hexabot.ai/) Live Chat Widget is a React-based embeddable widget that allows users to integrate real-time chat functionality into their websites. It connects to the Hexabot API and facilitates seamless interaction between end-users and chatbots across multiple channels.

[Hexabot](https://hexabot.ai/) is a chatbot / agent solution that allows users to create and manage AI-powered, multi-channel, and multilingual chatbots with ease. If you would like to learn more, please visit the [official github repo](https://github.com/hexabot-ai/Hexabot/).

## Key Features

- **Real-Time Chat:** Engage in real-time conversations with users directly through your website.
- **Customizable:** Easily customize the widget's appearance and behavior to fit your brand and website.
- **Multi-Channel Support:** Integrates with multiple messaging platforms through the Hexabot API.
- **Embeddable:** Simple to embed and integrate into any web page with just a few lines of code.

## Directory Structure

The Hexabot Live Chat Widget is organized into the following directory structure, under `src` we have:

- **src/components:** Reusable React components that make up the chat widget interface, such as message bubbles, input fields, and buttons.
- **src/constants:** Hard coded values that are used like colors.
- **src/hooks:** Custom React hooks for managing widget state and handling side effects like API calls or real-time events.
- **src/providers:** Context providers for managing global state, such as user session, chat messages, and widget configurations.
- **src/test:** Test setup for Vitest and jsdom.
- **src/theme:** Theme contracts, utilities, and CSS variable defaults.
- **src/translations:** Contains translations for widget strings.
- **src/types:** Defines the typescript interfaces, types, and enums used.
- **src/utils:** Utility functions and helpers used throughout the widget, such as formatting, validations, or data transformations.

- **/public:** Contains static files that are publicly accessible. This includes the main HTML template where the widget is embedded for local development.

## Run the Live Chat Widget

### Dev Mode

Start the widget dev server from the repository root:

```bash
pnpm --filter @hexabot-ai/widget run dev
```

The live chat widget will be accessible at http://localhost:5173.

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

Unlike `preview`, this serves the precompressed `.br`/`.gz` files the build
produces alongside the bundle — use it to check what a CDN or self-hosted
deployment will actually send over the wire. Both commands default to port
`5174`, so run only one at a time.

## Embed Chat Widget

Once the widget is built, you can easily embed it into any webpage. Here's an example of how to add it to your website:

The widget bundles its own copy of React, so `hexabot-widget.umd.js` is the
only *script* you need — no separate React/ReactDOM tags to load first. Its
styles still ship as a separate file, so keep the stylesheet link.

```html
<link rel="stylesheet" href="<<WIDGET URL>>/style.css">
<script src="<<WIDGET URL>>/hexabot-widget.umd.js"></script>

<div id="hb-chat-widget"></div>
<script>
  HexabotWidget.config({
    id: 'hb-chat-widget',
    apiUrl: 'https://api.yourdomain.com',
    channel: 'web',
    sourceId: 'your-source-id',
    transport: 'ws', // or "polling"
    primaryColor: '#1ba089',
  });
</script>
```

`config` takes one object: `id` (an element id, a CSS selector, or an element)
plus `css` (a stylesheet URL to load) and `shadowDom` (render in a shadow root),
alongside the regular widget config.

`config` returns a handle with an `unmount()` method if you need to tear the
widget down again.

Replace the values in `apiUrl`, `sourceId`, and `primaryColor` with your configuration details.
`transport` is optional and accepts `ws` (default) or `polling`.

To prevent the website css from conflicting with the chat widget css, we can leverage the shadow dom:

Pass `shadowDom: true` and `config` creates the shadow root, renders inside it, and
loads `css` into that root — a shadow root does not inherit the page's styles,
so the stylesheet has to go in with it. No `<link>` in the page is needed.

```html
<script src="<<WIDGET URL>>/hexabot-widget.umd.js"></script>

<div id="hb-chat-widget"></div>
<script>
  HexabotWidget.config({
    id: 'hb-chat-widget',
    apiUrl: 'https://api.yourdomain.com',
    channel: 'web',
    sourceId: 'your-source-id',
    transport: 'ws', // or "polling"
    primaryColor: '#1ba089',
    css: '<<WIDGET URL>>/style.css',
    shadowDom: true,
  });
</script>
```

For stable releases, pin the major version:
`https://cdn.jsdelivr.net/npm/@hexabot-ai/widget@3/dist/`

> **Note:** the snippets above use `HexabotWidget.config()`, which is only
> available from the major release that bundles React. Pinning `@3` loads the
> older bundle, which instead expects `React` and `ReactDOM` globals to already
> be on the page. Bump this pin when that major is published.

JsDelivr uses the package published in the npm registry: https://www.npmjs.com/package/@hexabot-ai/widget

## Examples

As a proof of concept we developed a Wordpress plugin to embed the chat widget in a Wordpress website : [https://github.com/hexabot-ai/hexabot-wordpress-live-chat-widget](https://github.com/hexabot-ai/hexabot-wordpress-live-chat-widget)

## Customization

You can customize the look and feel of the chat widget by modifying the widget’s scss styles or behavior. The widget allows you to:

- Change colors and fonts to match your website's branding.
- Configure user settings like language and chatbot response preferences.

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
