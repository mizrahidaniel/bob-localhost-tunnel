#!/usr/bin/env node
/**
 * Localhost Tunnel Client
 * Connects to relay server, forwards HTTP requests to local port
 */

const WebSocket = require('ws');
const http = require('http');

const RELAY_URL = process.env.RELAY_URL || 'ws://localhost:8080';
const localPort = process.argv[2] || 3000;

let ws;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;

function connect() {
  console.log(`🔌 Connecting to relay: ${RELAY_URL}`);
  
  ws = new WebSocket(RELAY_URL);
  
  ws.on('open', () => {
    console.log('✓ Connected to relay server');
    reconnectAttempts = 0;
    
    // Send handshake
    ws.send(JSON.stringify({
      type: 'init',
      localPort: localPort
    }));
  });
  
  ws.on('message', async (data) => {
    const msg = JSON.parse(data);
    
    switch (msg.type) {
      case 'ready':
        console.log(`\n✓ Tunnel established`);
        console.log(`📡 ${msg.url} → localhost:${localPort}`);
        console.log(`\n👁  Waiting for requests...\n`);
        break;
        
      case 'request':
        await handleRequest(msg);
        break;
        
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
    }
  });
  
  ws.on('close', () => {
    console.log('✗ Disconnected from relay');
    reconnect();
  });
  
  ws.on('error', (err) => {
    console.error('✗ Connection error:', err.message);
  });
}

async function handleRequest(msg) {
  const { id, method, path, headers, body } = msg;
  
  console.log(`← ${method} ${path}`);
  
  try {
    const response = await forwardToLocalhost(method, path, headers, body);
    
    ws.send(JSON.stringify({
      type: 'response',
      id: id,
      status: response.status,
      headers: response.headers,
      body: response.body
    }));
    
    console.log(`→ ${response.status} (${response.body?.length || 0} bytes)`);
  } catch (err) {
    console.error(`✗ Error forwarding request:`, err.message);
    
    ws.send(JSON.stringify({
      type: 'response',
      id: id,
      status: 502,
      headers: { 'Content-Type': 'text/plain' },
      body: `Tunnel Error: ${err.message}`
    }));
  }
}

function forwardToLocalhost(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: localPort,
      path: path,
      method: method,
      headers: {
        ...headers,
        'host': `localhost:${localPort}`,
        'x-forwarded-proto': 'https'
      }
    };
    
    const req = http.request(options, (res) => {
      let chunks = [];
      
      res.on('data', (chunk) => chunks.push(chunk));
      
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString();
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: responseBody
        });
      });
    });
    
    req.on('error', (err) => {
      reject(err);
    });
    
    if (body) {
      req.write(body);
    }
    
    req.end();
  });
}

function reconnect() {
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
  reconnectAttempts++;
  
  console.log(`🔄 Reconnecting in ${delay / 1000}s...`);
  
  setTimeout(connect, delay);
}

// Handle shutdown gracefully
process.on('SIGINT', () => {
  console.log('\n\n👋 Closing tunnel...');
  if (ws) ws.close();
  process.exit(0);
});

// Start
console.log(`🚇 Tunnel Client`);
console.log(`Local: localhost:${localPort}`);
connect();
