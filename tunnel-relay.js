#!/usr/bin/env node
/**
 * Localhost Tunnel Relay Server
 * Accepts WebSocket connections from clients, forwards HTTP requests
 */

const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');

const WS_PORT = process.env.WS_PORT || 8080;
const HTTP_PORT = process.env.HTTP_PORT || 8081;
const BASE_DOMAIN = process.env.BASE_DOMAIN || 'tunnel.localhost';

// Active tunnels: subdomain -> { ws, pendingRequests }
const tunnels = new Map();

// Pending HTTP responses: requestId -> { res, timer }
const pendingResponses = new Map();

const REQUEST_TIMEOUT = 30000; // 30s

/**
 * Generate random subdomain
 */
function generateSubdomain() {
  return crypto.randomBytes(6).toString('hex');
}

/**
 * WebSocket Server (for clients)
 */
const wss = new WebSocket.Server({ port: WS_PORT });

wss.on('connection', (ws) => {
  let subdomain = null;
  let pingInterval = null;
  
  console.log('🔌 Client connected');
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      
      switch (msg.type) {
        case 'init':
          handleInit(ws, msg);
          break;
          
        case 'response':
          handleResponse(msg);
          break;
          
        case 'pong':
          // Client is alive
          break;
      }
    } catch (err) {
      console.error('✗ Protocol error:', err.message);
      ws.close();
    }
  });
  
  ws.on('close', () => {
    if (subdomain) {
      console.log(`✗ Tunnel closed: ${subdomain}.${BASE_DOMAIN}`);
      tunnels.delete(subdomain);
      
      // Fail all pending requests for this tunnel
      const pending = pendingResponses.entries();
      for (const [reqId, { res }] of pending) {
        if (reqId.startsWith(subdomain)) {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('Tunnel disconnected');
          pendingResponses.delete(reqId);
        }
      }
    }
    
    if (pingInterval) {
      clearInterval(pingInterval);
    }
    
    console.log('👋 Client disconnected');
  });
  
  ws.on('error', (err) => {
    console.error('✗ WebSocket error:', err.message);
  });
  
  function handleInit(ws, msg) {
    subdomain = generateSubdomain();
    const url = `http://${subdomain}.${BASE_DOMAIN}:${HTTP_PORT}`;
    
    tunnels.set(subdomain, {
      ws: ws,
      localPort: msg.localPort || 3000
    });
    
    ws.send(JSON.stringify({
      type: 'ready',
      url: url,
      subdomain: subdomain
    }));
    
    console.log(`✓ Tunnel established: ${url}`);
    
    // Start keepalive
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }
  
  function handleResponse(msg) {
    const { id, status, headers, body } = msg;
    
    const pending = pendingResponses.get(id);
    if (!pending) {
      console.warn(`⚠️  Response for unknown request: ${id}`);
      return;
    }
    
    clearTimeout(pending.timer);
    pendingResponses.delete(id);
    
    const { res } = pending;
    
    // Forward response to HTTP client
    res.writeHead(status, headers);
    res.end(body);
    
    console.log(`  → ${status} ${body?.length || 0}b`);
  }
});

/**
 * HTTP Server (for public requests)
 */
const httpServer = http.createServer((req, res) => {
  const host = req.headers.host || '';
  const subdomain = host.split('.')[0].split(':')[0];
  
  // Health check endpoint
  if (req.url === '/_health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      active_tunnels: tunnels.size,
      pending_requests: pendingResponses.size
    }));
    return;
  }
  
  const tunnel = tunnels.get(subdomain);
  
  if (!tunnel) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`Tunnel not found: ${subdomain}\n\nActive tunnels: ${tunnels.size}`);
    return;
  }
  
  forwardRequest(tunnel, req, res);
});

function forwardRequest(tunnel, req, res) {
  const { ws } = tunnel;
  
  if (ws.readyState !== WebSocket.OPEN) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('Tunnel unavailable');
    return;
  }
  
  // Generate unique request ID
  const requestId = `${tunnel.ws._socket.remoteAddress}-${Date.now()}-${Math.random()}`;
  
  // Collect request body
  let body = '';
  req.on('data', (chunk) => {
    body += chunk.toString();
  });
  
  req.on('end', () => {
    console.log(`← ${req.method} ${req.url}`);
    
    // Forward request to client
    ws.send(JSON.stringify({
      type: 'request',
      id: requestId,
      method: req.method,
      path: req.url,
      headers: req.headers,
      body: body || undefined
    }));
    
    // Store pending response
    const timer = setTimeout(() => {
      pendingResponses.delete(requestId);
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'text/plain' });
        res.end('Gateway Timeout');
      }
      console.log(`⏱  Request timeout: ${requestId}`);
    }, REQUEST_TIMEOUT);
    
    pendingResponses.set(requestId, { res, timer });
  });
}

httpServer.listen(HTTP_PORT, () => {
  console.log('\n🚇 Tunnel Relay Server');
  console.log(`WebSocket: ws://localhost:${WS_PORT}`);
  console.log(`HTTP:      http://*.${BASE_DOMAIN}:${HTTP_PORT}`);
  console.log(`\nReady for tunnel connections!\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down...');
  wss.close();
  httpServer.close();
  process.exit(0);
});
