# Localhost Tunnel 🚇

Simple WebSocket-based tunnel to expose your localhost to the internet. Alternative to ngrok/localtunnel.

## Features

- ✅ WebSocket-based protocol (fast, bidirectional)
- ✅ Random subdomain generation
- ✅ Auto-reconnect with exponential backoff
- ✅ Request/response logging
- ✅ Graceful error handling
- ✅ Zero configuration needed

## Quick Start

### 1. Install

```bash
npm install
```

### 2. Start the Relay Server

```bash
npm run relay
```

This starts:
- WebSocket server on `ws://localhost:8080` (for clients)
- HTTP server on `http://localhost:8081` (for public requests)

### 3. Connect Your Local Service

In another terminal:

```bash
# Tunnel localhost:3000
node tunnel-client.js 3000

# Or use the RELAY_URL env var to connect to a remote relay
RELAY_URL=ws://tunnel.example.com ./tunnel-client.js 3000
```

You'll see output like:

```
🚇 Tunnel Client
Local: localhost:3000
🔌 Connecting to relay: ws://localhost:8080
✓ Connected to relay server

✓ Tunnel established
📡 http://a1b2c3.tunnel.localhost:8081 → localhost:3000

👁  Waiting for requests...
```

### 4. Test It

```bash
# From another terminal or machine:
curl http://a1b2c3.tunnel.localhost:8081/

# Or visit in your browser
open http://a1b2c3.tunnel.localhost:8081
```

## Protocol

Simple JSON-over-WebSocket protocol:

**Client → Server:**
```json
{"type": "init", "localPort": 3000}
{"type": "response", "id": "req-123", "status": 200, "headers": {}, "body": "..."}
{"type": "pong"}
```

**Server → Client:**
```json
{"type": "ready", "url": "http://abc123.tunnel.localhost:8081"}
{"type": "request", "id": "req-123", "method": "GET", "path": "/", "headers": {}, "body": "..."}
{"type": "ping"}
```

## Environment Variables

**Relay Server:**
- `WS_PORT` - WebSocket port (default: 8080)
- `HTTP_PORT` - HTTP port (default: 8081)
- `BASE_DOMAIN` - Base domain for tunnels (default: tunnel.localhost)

**Client:**
- `RELAY_URL` - Relay WebSocket URL (default: ws://localhost:8080)

## Architecture

```
┌─────────────┐      WebSocket       ┌──────────────┐      HTTP        ┌────────────┐
│   Client    │ ←─────────────────→ │ Relay Server │ ←───────────────→ │   Public   │
│             │   tunnel protocol    │              │  abc123.domain   │  Internet  │
│ localhost:  │                      │              │                   │            │
│    3000     │                      │              │                   │            │
└─────────────┘                      └──────────────┘                   └────────────┘
```

**Flow:**
1. Client connects to relay via WebSocket
2. Relay assigns random subdomain (e.g., `abc123`)
3. HTTP requests to `abc123.tunnel.localhost:8081` arrive at relay
4. Relay forwards request through WebSocket to client
5. Client sends request to `localhost:3000`
6. Client sends response back through WebSocket
7. Relay returns response to HTTP client

## Production Deployment

For production use:

1. **Set up DNS wildcard:** `*.tunnel.yourdomain.com → your-server-ip`
2. **HTTPS termination:** Use Caddy or nginx for automatic HTTPS
3. **Environment variables:**
   ```bash
   BASE_DOMAIN=tunnel.yourdomain.com
   WS_PORT=8080
   HTTP_PORT=8081
   ```

## Next Steps

- [ ] Authentication tokens for tunnel creation
- [ ] Custom subdomain support (with auth)
- [ ] Rate limiting per tunnel
- [ ] Request inspection dashboard
- [ ] WebSocket tunnel support (not just HTTP)
- [ ] Client CLI improvements (better status display)

## License

MIT
