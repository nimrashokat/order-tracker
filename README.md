# Real-Time Order Tracker & Live Support System (CSC337 Lab 04)

Full-stack app demonstrating REST, WebSockets (Socket.io), JSON-RPC 2.0 and Server-Sent Events.

- **Backend:** Node.js + Express + Socket.io (`/backend`) - deploy on Render
- **Frontend:** plain HTML/JS (`/frontend`) - deploy on Netlify/Vercel

## Live URLs
- Frontend: `PASTE_FRONTEND_URL`
- Backend: `PASTE_BACKEND_URL`

## Run locally
```bash
cd backend
npm install
npm start          # http://localhost:3000
```
In a second terminal:
```bash
cd frontend
npx serve .        # open the printed URL
```
`frontend/config.js` holds `window.API_URL` (backend URL).

## REST API (`/api/v1`)
| Method | Path | Purpose |
|---|---|---|
| GET | /api/v1/catalog | list products |
| GET | /api/v1/orders | list orders |
| GET | /api/v1/orders/:id | one order |
| POST | /api/v1/orders | create order `{customerName, items:[{productId, qty}]}` |
| PATCH | /api/v1/orders/:id/status | update status `{status}` |
| DELETE | /api/v1/orders/:id | delete order |

## JSON-RPC 2.0 (`POST /rpc`)
Methods: `listOrders`, `getOrder {orderId}`, `cancelOrder {orderId}`
```json
{"jsonrpc":"2.0","method":"cancelOrder","params":{"orderId":1001},"id":1}
```

## Server-Sent Events (`GET /events`)
Event `alert` with `{message, level, time}`: new orders, status changes, cancellations, and a system heartbeat every 20s.

## WebSocket events (Socket.io)
| Direction | Event | Payload | Meaning |
|---|---|---|---|
| client -> server | `track:order` | orderId | subscribe to live status of an order |
| client -> server | `agent:join` | - | support agent goes online |
| client -> server | `chat:join` | `{orderId, name, role}` | join the 1-on-1 chat room for that order |
| client -> server | `chat:message` | `{orderId, text}` | send chat message |
| client -> server | `chat:typing` | `{orderId}` | typing indicator |
| server -> client | `order:status` | `{orderId, status}` | live status update for tracked order |
| server -> client | `order:new` / `order:updated` | order | sent to agents |
| server -> client | `agent:ready` | `{orders}` | initial data for agent |
| server -> client | `chat:message` | `{orderId, from, role, text, time}` | new chat message |
| server -> client | `chat:system` | `{text}` | join/leave notices |
| server -> client | `chat:typing` | `{name}` | other side is typing |
| server -> client | `chat:request` | `{orderId, name}` | customer opened chat (to agents) |
