# VS Code Extensions Are Client/Server Apps (Nobody Told Me Either)

*How a debugging session revealed what the documentation never says.*

---

## The Moment It Clicked

I was debugging an error between the chat UI and `extension.ts`. Something wasn't getting from point A to point B, and I couldn't figure out where the message was dying. So I did what any developer does — I started watching the logs.

Except there were two log streams.

The VS Code **Output** window was showing my extension logs — session lifecycle, SDK events, service calls. And the **Chrome DevTools** console (yes, Chrome DevTools — more on that in a second) was showing my webview logs — UI events, message handlers, render cycles.

Server logs. Browser logs.

I sat there staring at two windows and thought: *wait, this feels familiar.*

I've spent 30 years looking at server logs in one window and browser logs in another. ASP.NET output in the terminal, Angular console in Chrome. Backend trace in Kibana, frontend errors in the browser. Two runtimes, two log streams, one application.

Then I looked at the messaging layer between them. The extension was calling `webview.postMessage()` to send data down. The webview was calling `vscode.postMessage()` to send data up. Serialized JSON payloads over a message boundary.

That's HTTP. That's SignalR. That's WebSockets. That's every client/server transport I've ever used, just without the URL.

**This whole thing is client/server. They just called everything weird names.**

No black box. No extension voodoo. No special VS Code magic. Just a Node.js backend, a browser frontend, and an RPC layer in between.

And then 30 years of experience kicked in, and the architecture fell into place in hours.

---

## What Nobody Tells You

Here's the thing that made my first few versions of this extension a mess: **the VS Code documentation never frames extensions this way.** Not once.

The docs talk about "extensions" like they're plugins — little add-ons that hook into the editor. And for simple extensions (commands, decorations, language features), that's accurate enough. But the moment you add a **webview** — a sidebar panel, a custom editor, anything with a UI — you've crossed a line that the documentation doesn't acknowledge.

You're now building a web application.

You have two separate runtimes:
- The **Extension Host** — a Node.js process with full filesystem access, the VS Code API, and no DOM
- The **Webview** — a browser sandbox with a DOM, CSS, JavaScript, and no access to Node.js or VS Code APIs

They cannot share memory. They cannot import each other's modules. They cannot call each other's functions. The only way they communicate is by **sending serialized messages** across a boundary.

That's a client and a server. Full stop.

But the docs call the server an "extension." They call the client a "webview." They call the transport "message passing." They call the API surface "the VS Code API." And if you don't already know what you're looking at, you'll spend weeks confused about why you can't just `import` your extension code from your webview, or why `document.getElementById` doesn't work in your extension.

I did. And I've been building web apps since ASP classic.

---

## The Rosetta Stone

This is the table I wish someone had given me on day one. If you've built anything with a backend framework and a frontend framework, you already know how VS Code extensions work. You just don't know the vocabulary yet.

| What VS Code Calls It | What It Actually Is |
|---|---|
| Extension Host | **Your backend server** (Node.js process) |
| Webview | **Your frontend app** (browser sandbox) |
| `webview.postMessage()` | **Server → Client push** (like SignalR, WebSocket, SSE) |
| `vscode.postMessage()` | **Client → Server request** (like HTTP POST, WebSocket send) |
| `onDidReceiveMessage` | **API endpoint / route handler** |
| `WebviewViewProvider` | **Controller** (handles view lifecycle + message routing) |
| Extension `activate()` | **Server startup** (`main()`, `Startup.Configure()`, `app.listen()`) |
| `vscode.commands` | **Server-side route registration** |
| `context.subscriptions` | **Dependency injection container / disposal scope** |
| `vscode.workspace` | **Server-side filesystem + config API** |
| `vscode.window` | **Server-side UI API** (dialogs, status bar, notifications) |
| Extension's `package.json` contributes | **Route table / module registration** |
| Webview HTML | **Your SPA** (index.html + scripts + styles) |
| `acquireVsCodeApi()` | **The client-side SDK** (gives you `postMessage`, `getState`, `setState`) |
| CSP (Content Security Policy) | **CORS** (controls what the browser sandbox can load) |
| `getState()` / `setState()` | **Client-side session storage** |
| Extension context `globalState` | **Server-side persistent storage** (like a database or cache) |

Read that table once. Now every pattern from your day job applies.

---

## The Two Runtimes (This Is the Part That Trips Everyone Up)

If you take one thing from this article, take this diagram:

```text
┌──────────────────────────────┐     ┌─────────────────────────────┐
│       EXTENSION HOST         │     │          WEBVIEW            │
│       (Your Server)          │     │       (Your Client)         │
│                              │     │                             │
│  Runtime: Node.js            │     │  Runtime: Browser (Chromium) │
│  Has: filesystem, VS Code    │     │  Has: DOM, CSS, browser APIs │
│        API, network, npm     │     │       localStorage           │
│  No: DOM, window, document   │     │  No: Node.js, fs, VS Code   │
│                              │     │      API, require/import     │
│  Logs: VS Code Output window │     │  Logs: Chrome DevTools       │
│                              │     │                             │
│  ┌─────────────────────┐    │     │    ┌──────────────────────┐ │
│  │  Your Services       │    │     │    │  Your UI Components  │ │
│  │  Your Controllers    │    │     │    │  Your Event Handlers │ │
│  │  Your Business Logic │    │     │    │  Your Rendering Code │ │
│  └─────────────────────┘    │     │    └──────────────────────┘ │
│             │                │     │             │               │
│             ▼                │     │             ▼               │
│    webview.postMessage()  ───┼──►──┼──► onmessage handler       │
│    onDidReceiveMessage  ◄──┼──◄──┼───  vscode.postMessage()    │
│                              │     │                             │
└──────────────────────────────┘     └─────────────────────────────┘
          JSON serialization boundary (like HTTP)
```

**Everything on the left** is your backend. Node.js. Full access to the machine. No UI.

**Everything on the right** is your frontend. Browser. Full access to the DOM. No machine access.

**The line in the middle** is your API. Serialized JSON messages. One direction at a time. No shared state.

That's it. That's a VS Code extension with a webview.

If you squint, that's ASP.NET MVC + Angular. Or Express + React. Or Django + Vue. Or Rails + whatever.

It's all the same pattern. It's always been the same pattern.

---

## Why It Matters

Once you see extensions as client/server, you stop fighting the framework and start applying what you know:

**Separation of concerns**: Business logic goes in the extension host (server). UI logic goes in the webview (client). You wouldn't put your SQL queries in your Angular component — don't put your SDK calls in your webview.

**Typed contracts**: Define your message types in a shared file. This is your API contract — the same thing as your DTOs, your Swagger spec, your GraphQL schema. Both sides import the same types. TypeScript catches mismatches at compile time.

**Controller pattern**: Your `WebviewViewProvider` is a controller. It receives messages (requests), delegates to services (business logic), and sends responses back to the client. Treat it like one.

**Service layer**: Extract your business logic into services. Your SDK wrapper, your file operations, your session management — these are services that the controller calls. Test them independently.

**Error handling**: Errors in the extension host don't crash the webview. Errors in the webview don't crash the extension. They're separate processes. Handle errors on each side the way you'd handle server errors and client errors — independently, with appropriate user feedback.

**State management**: The extension host is your source of truth (server state). The webview has local state (client state). Sync them over the message boundary, same as you'd sync a Redux store with an API.

**Testing**: You can unit test your extension services without a webview (server-side tests). You can test your webview handlers without an extension host (client-side tests). And you can integration test the message flow between them (API tests).

**Every pattern you've learned in 5, 10, 20, 30 years of building web apps — it all works here.** You just need someone to tell you that's what you're building.

Nobody did. So I'm telling you now.

---

## The Evidence (Try This Right Now)

Don't take my word for it. Prove it to yourself:

### 1. Open your webview's DevTools

In VS Code, open the Command Palette and run:

```text
Developer: Open Webview Developer Tools
```

You'll get Chrome DevTools. Inspect tab. Console tab. Network tab. The same DevTools you use to debug every web app you've ever built.

Your webview IS a browser. Chromium, specifically. Same engine as Chrome and Edge.

### 2. Watch the messages

Add this to your webview code:

```javascript
window.addEventListener('message', event => {
    console.log('[Client] Received from server:', event.data);
});
```

Add this to your extension code:

```typescript
webview.onDidReceiveMessage(message => {
    console.log('[Server] Received from client:', message);
});
```

Now watch the two log streams. Server logs in the Output window. Client logs in DevTools. Messages going back and forth. Serialized JSON.

You're watching HTTP traffic. It's just not using HTTP.

### 3. Look at the process model

Open `Help >> Process Explorer`. Find the VS Code processes. You'll see:

- The main Electron process
- The Extension Host process (your "server")
- A renderer process for each webview (your "client")

Separate processes. Separate memory spaces. Just like a web server and a browser.

---

## Why This Matters Beyond VS Code

This isn't just about VS Code extensions. It's about how we document developer tools.

When you tell a backend developer "build an extension," they hear "plugin." They think: hook into some lifecycle events, maybe register a callback, done. That mental model works for simple extensions.

But when you tell them "build a webview extension," you're actually saying "build a full-stack web app inside VS Code's process model." And if you don't tell them that's what they're doing, they'll waste weeks wondering why they can't access `document` from their extension code, or why `require('fs')` doesn't work in their webview, or why their state keeps disappearing when the sidebar closes.

Every one of those questions has a one-word answer: **boundary.** The same boundary between every client and every server in every web app ever built.

The documentation should just say that.

---

## The Takeaway

If you're a backend developer about to build your first VS Code webview extension, here's what I wish someone had told me:

1. **You already know how to do this.** It's client/server. You've built this before.
2. **Extension host = your backend.** Node.js, full machine access, no DOM.
3. **Webview = your frontend.** Browser sandbox, full DOM, no Node.
4. **postMessage = your transport.** Serialized JSON, same as HTTP bodies.
5. **Two log streams.** Output window for server, DevTools for client. If that feels familiar, you've already figured it out.
6. **Apply your patterns.** Controllers, services, typed contracts, separation of concerns. They all work. They all apply.
7. **The docs won't tell you any of this.** Now someone has.

---

*Steven Molen, Sr. Enterprise Architect*
*GIST written with Claude Opus 4.6 — because sometimes the most useful documentation is the documentation that doesn't exist yet, and I'm too busy writing and reviewing code to not take advantage of a tool that allows me to disseminate what I'm thinking.*

*This is part of a series on building VS Code extensions with AI. See also:*
- *[THE-AI-JOURNEY.md](THE-AI-JOURNEY.md) — How AI is both a help and a hindrance*
- *[HUMAN-CONTEXT-AI-RESPONSE.md](HUMAN-CONTEXT-AI-REPONSE.md) — The raw conversation that started it all*
