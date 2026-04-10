# MCP App widget — "supersede older instances" demo

## The problem

When Claude calls an MCP tool that renders an [MCP App](https://github.com/modelcontextprotocol/ext-apps) widget more than once in a conversation, each call produces a **separate iframe**. There's currently no host API to unmount or disable earlier instances when a newer one appears — so you can end up with several "live" copies of the same widget, each pushing its own `ui/update-model-context` / `ui/message` calls.

## The workaround this demo shows

All widget iframes for a given connector are served from the **same origin** on `*.claudemcpcontent.com` (the iframe sandbox includes `allow-same-origin`). That means a [`BroadcastChannel`](https://developer.mozilla.org/docs/Web/API/BroadcastChannel) reaches every instance in the conversation.

Each widget:

1. records `bornAt = Date.now()` and an `instanceId` (from `hostContext.toolInfo.id`, falling back to a UUID),
2. opens `new BroadcastChannel('mcp-demo-cart-supersede')`,
3. broadcasts `{type:'born', instanceId, bornAt}` on mount,
4. listens on the channel — any instance that sees a sibling with a **later** `bornAt` flips `superseded = true`, greys itself out, shows *"⬇ Superseded — see the latest cart below"*, disables its buttons, and stops calling `ui/update-model-context` / `ui/message`.

The newest instance stays green/**LIVE**; every older one goes grey/**SUPERSEDED**. No host changes required.

## What's in here

| File | |
|---|---|
| `server.js` | Node MCP server (Streamable HTTP, stateless) exposing one tool `show_cart` with `_meta.ui.resourceUri` pointing at the widget |
| `widget.html` | Self-contained widget: inline JSON-RPC host bridge + `BroadcastChannel` supersede logic. No external CDN deps, so no CSP config needed |
| `package.json` | Deps: `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`, `express`, `zod` |

## Run it

```bash
npm install
npm start
# → MCP server listening on http://localhost:3000/mcp
```

### Add it as a custom connector in Claude.ai

Claude.ai needs a public HTTPS URL. Tunnel your local server with either:

```bash
# ngrok
ngrok http 3000
# → use  https://<id>.ngrok-free.app/mcp

# or cloudflared
cloudflared tunnel --url http://localhost:3000
# → use  https://<id>.trycloudflare.com/mcp
```

Then in Claude.ai: **Settings → Connectors → Add custom connector**, paste the `/mcp` URL, no auth.

## Demo flow

1. In a new conversation: *"Show my cart."* → Claude calls `show_cart` → a **green LIVE** widget appears. Click **+ Add item** a few times.
2. Ask: *"Show my cart again."* → Claude calls `show_cart` a second time → a new green widget appears, and the **first one turns grey / SUPERSEDED** with its buttons disabled.
3. Repeat — only the newest instance is ever LIVE.
4. Optional: click **Tell Claude about my cart** on the live widget to send a `ui/message`; note the superseded widgets' buttons do nothing.

## Where the supersede logic lives

See `widget.html`, the section marked *"Supersede protocol over BroadcastChannel"* (~30 lines). All calls to `ui/update-model-context` and `ui/message` are gated on `!superseded`.

## Notes

- This is a **workaround**, not a spec feature. If/when the host grows an API for widget lifecycle (e.g. `ui/notifications/instance-superseded`), prefer that.
- `BroadcastChannel` is same-origin only — it works here because Claude.ai gives all iframes from a connector the same sandbox origin. Other hosts may differ.
- The widget uses raw `window.postMessage` JSON-RPC for the host bridge to stay dependency-free. A production widget would typically use `@modelcontextprotocol/ext-apps` (`App` / `useApp`) instead.
