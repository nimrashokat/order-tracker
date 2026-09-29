const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ---------- In-memory data ----------
const catalog = [
  { id: 1, name: 'Wireless Mouse', price: 1500 },
  { id: 2, name: 'Mechanical Keyboard', price: 6500 },
  { id: 3, name: 'USB-C Hub', price: 3200 },
  { id: 4, name: 'Laptop Stand', price: 2400 },
];
const orders = [];
let nextOrderId = 1001;
const STATUSES = ['Placed', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];

// ---------- SSE ----------
const sseClients = new Set();
function pushAlert(message, level = 'info') {
  const payload = JSON.stringify({ message, level, time: new Date().toISOString() });
  for (const res of sseClients) res.write(`event: alert\ndata: ${payload}\n\n`);
}
app.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`event: alert\ndata: ${JSON.stringify({ message: 'Connected to live alerts', level: 'info', time: new Date().toISOString() })}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});
setInterval(() => pushAlert(`System OK. Orders: ${orders.length}. Clients: ${io.engine.clientsCount}`, 'info'), 20000);
setInterval(() => { for (const r of sseClients) r.write(': ping\n\n'); }, 15000);

// ---------- Shared logic ----------
function changeStatus(order, status) {
  order.status = status;
  order.updatedAt = new Date().toISOString();
  io.to(`order:${order.id}`).emit('order:status', { orderId: order.id, status });
  io.to('agents').emit('order:updated', order);
  pushAlert(`Order #${order.id} is now ${status}`, status === 'Cancelled' ? 'warning' : 'info');
}

// ---------- REST /api/v1 ----------
app.get('/', (req, res) => res.json({ ok: true, service: 'Order Tracker API' }));
app.get('/api/v1/catalog', (req, res) => res.json(catalog));
app.get('/api/v1/orders', (req, res) => res.json(orders));
app.get('/api/v1/orders/:id', (req, res) => {
  const o = orders.find(x => x.id === Number(req.params.id));
  return o ? res.json(o) : res.status(404).json({ error: 'Order not found' });
});
app.post('/api/v1/orders', (req, res) => {
  const { customerName, items } = req.body || {};
  if (!customerName || !Array.isArray(items) || !items.length)
    return res.status(400).json({ error: 'customerName and items[] required' });
  const lines = items.map(i => {
    const p = catalog.find(c => c.id === Number(i.productId));
    return p ? { ...p, qty: Number(i.qty) || 1 } : null;
  }).filter(Boolean);
  if (!lines.length) return res.status(400).json({ error: 'No valid products' });
  const order = {
    id: nextOrderId++, customerName, items: lines,
    total: lines.reduce((s, l) => s + l.price * l.qty, 0),
    status: 'Placed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  orders.push(order);
  io.to('agents').emit('order:new', order);
  pushAlert(`New order #${order.id} from ${customerName}`);
  res.status(201).json(order);
});
app.patch('/api/v1/orders/:id/status', (req, res) => {
  const o = orders.find(x => x.id === Number(req.params.id));
  if (!o) return res.status(404).json({ error: 'Order not found' });
  if (!STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status', allowed: STATUSES });
  changeStatus(o, req.body.status);
  res.json(o);
});
app.delete('/api/v1/orders/:id', (req, res) => {
  const i = orders.findIndex(x => x.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Order not found' });
  orders.splice(i, 1);
  res.status(204).end();
});

// ---------- JSON-RPC 2.0 /rpc ----------
const rpcMethods = {
  listOrders: () => orders,
  getOrder: ({ orderId }) => {
    const o = orders.find(x => x.id === Number(orderId));
    if (!o) throw { code: -32001, message: 'Order not found' };
    return o;
  },
  cancelOrder: ({ orderId }) => {
    const o = orders.find(x => x.id === Number(orderId));
    if (!o) throw { code: -32001, message: 'Order not found' };
    if (['Shipped', 'Delivered', 'Cancelled'].includes(o.status))
      throw { code: -32002, message: `Cannot cancel an order that is ${o.status}` };
    changeStatus(o, 'Cancelled');
    return o;
  },
};
function handleRpc(req) {
  const id = req && req.id !== undefined ? req.id : null;
  if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string')
    return { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id };
  const fn = rpcMethods[req.method];
  if (!fn) return { jsonrpc: '2.0', error: { code: -32601, message: 'Method not found' }, id };
  try { return { jsonrpc: '2.0', result: fn(req.params || {}), id }; }
  catch (e) { return { jsonrpc: '2.0', error: { code: e.code || -32603, message: e.message || 'Internal error' }, id }; }
}
app.post('/rpc', (req, res) => {
  if (Array.isArray(req.body)) return res.json(req.body.map(handleRpc));
  res.json(handleRpc(req.body));
});

// ---------- WebSockets (Socket.io) ----------
io.on('connection', socket => {
  socket.on('track:order', orderId => {
    socket.join(`order:${orderId}`);
    const o = orders.find(x => x.id === Number(orderId));
    if (o) socket.emit('order:status', { orderId: o.id, status: o.status });
  });
  socket.on('agent:join', () => {
    socket.join('agents');
    socket.emit('agent:ready', { orders });
  });
  socket.on('chat:join', ({ orderId, name, role }) => {
    socket.data = { orderId, name, role };
    socket.join(`chat:${orderId}`);
    io.to(`chat:${orderId}`).emit('chat:system', { text: `${name} (${role}) joined the chat` });
    if (role === 'customer') io.to('agents').emit('chat:request', { orderId, name });
  });
  socket.on('chat:message', ({ orderId, text }) => {
    const d = socket.data || {};
    if (!text || !orderId) return;
    io.to(`chat:${orderId}`).emit('chat:message', {
      orderId, from: d.name || 'Unknown', role: d.role || 'customer', text, time: new Date().toISOString(),
    });
  });
  socket.on('chat:typing', ({ orderId }) => {
    socket.to(`chat:${orderId}`).emit('chat:typing', { name: (socket.data || {}).name });
  });
  socket.on('disconnect', () => {
    const d = socket.data;
    if (d && d.orderId) io.to(`chat:${d.orderId}`).emit('chat:system', { text: `${d.name} left the chat` });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
