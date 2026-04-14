# MCP App widget — "supersede older instances" demo

## The problem

When Claude calls an MCP tool that renders an [MCP App](https://github.com/modelcontextprotocol/ext-apps) widget more than once in a conversation, each call produces a **separate iframe**. There's currently no host API to unmount or disable earlier instances when a newer one appears — so you can end up with several "live" copies of the same widget, each pushing its own `ui/update-model-context` / `ui/message` calls.

## How it works

All widget iframes for a given connector are served from the **same origin** on `*.claudemcpcontent.com` (the iframe sandbox includes `allow-same-origin`). That means a [`BroadcastChannel`](https://developer.mozilla.org/docs/Web/API/BroadcastChannel) reaches every instance in the conversation.

On every `show_cart` call the **server** stamps the tool result's `structuredContent` with `{createdAt, seq}` — a wall-clock timestamp plus a per-process counter. That result is stored in the conversation transcript, so every device / every remount sees the same value.

Each widget:

1. reads its `instanceId` from `hostContext.toolInfo.id` and its election key `{orderKey: createdAt, seq}` from the `ui/notifications/tool-result` payload,
2. opens `new BroadcastChannel('mcp-demo-cart-supersede')` and broadcasts `{type:'born', instanceId, orderKey, seq}`,
3. listens on the channel — any instance that sees a sibling with a **later** `orderKey` (tie-broken by `seq`, then `instanceId`) flips `superseded = true`, greys itself out, shows *"⬇ Superseded — see the latest cart below"*, disables its buttons, and stops calling `ui/update-model-context` / `ui/message`.

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

- `BroadcastChannel` is same-origin only — it works here because Claude.ai gives all iframes from a connector the same sandbox origin. Other hosts may differ.
- **Channel scope & `ui.domain`:** with no `_meta.ui.domain` set (as in this demo), Claude.ai derives the iframe origin from *conversation + connector*, so the broadcast is scoped to one conversation. If you set a fixed `ui.domain` (common for OAuth callbacks), the origin becomes **per-connector across all conversations and tabs** — a fixed channel name would then let a cart in one conversation supersede a cart in another. In that case, namespace the channel (e.g. by tool name and a conversation-scoped value if one is available) or accept "newest across all tabs" semantics.
- **Why the election key is server-minted, not client `Date.now()`:** client mount time does *not* reflect tool-call order. On iOS, a rehydrated conversation is bottom-anchored and lazy-mounts older cells as you scroll up — so older widgets mount *later* and a client timestamp would hand them "live." Opening the same chat on a second device has the same problem (fresh `localStorage`, fresh clocks). The server's `{createdAt, seq}` travels with the tool result in the transcript and is identical everywhere. The widget waits (up to 1s) for `ui/notifications/tool-result` before announcing, then re-announces if the authoritative value arrives late. A production server would source the key from something durable (DB row id, cart version, logical clock) rather than an in-process counter.
- **The `localStorage` cache is a web-only optimization.** On Claude.ai web, `hostContext.toolInfo.id` is the stable tool-use id, so the resolved key can be cached per-instance and reused on remount without waiting for `tool-result`. On **iOS**, `toolInfo.id` is `undefined` when a stored conversation is rehydrated, so there's no stable per-instance cache key — the widget detects this (`hasStableId === false`) and skips `localStorage` entirely, relying solely on the server key from `tool-result`. Don't depend on the cache for correctness.
- The inline host bridge is deliberately minimal: it handles responses and notifications but does **not** reply to host→view *requests* (`ping`, `ui/resource-teardown`). Claude.ai web doesn't currently send either to views; Claude iOS sends `ui/resource-teardown` only when navigating away from the conversation (not on scroll / cell reuse). So ignoring them is harmless for this demo. A production widget should use `@modelcontextprotocol/ext-apps` (`App` / `useApp`), which handles the full request surface.
