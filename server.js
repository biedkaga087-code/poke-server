const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("PokeKoma Relay Server OK");
});

const wss = new WebSocketServer({ server });

// roomCode -> { host: ws | null, guest: ws | null }
const rooms = new Map();

function sendJson(ws, obj) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(obj));
  }
}

function cleanupSocket(ws) {
  const code = ws.roomCode;
  if (!code || !rooms.has(code)) return;
  const room = rooms.get(code);
  if (room.host === ws) room.host = null;
  if (room.guest === ws) room.guest = null;
  ws.roomCode = null;

  if (!room.host && !room.guest) {
    rooms.delete(code);
  } else {
    const other = room.host || room.guest;
    sendJson(other, { type: "room_error", reason: "相手が切断しました" });
  }
}

wss.on("connection", (ws) => {
  ws.roomCode = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (_e) {
      return;
    }
    if (!msg || typeof msg.type !== "string") return;

    const code = String(msg.room || "1000").trim() || "1000";

    if (msg.type === "create_room") {
      cleanupSocket(ws);
      rooms.set(code, { host: ws, guest: null });
      ws.roomCode = code;
      return;
    }

    if (msg.type === "join_room") {
      cleanupSocket(ws);
      let targetCode = code;
      if (!rooms.has(targetCode) || !rooms.get(targetCode).host || rooms.get(targetCode).guest) {
        for (const [k, v] of rooms.entries()) {
          if (v.host && !v.guest) {
            targetCode = k;
            break;
          }
        }
      }

      if (!rooms.has(targetCode) || !rooms.get(targetCode).host) {
        sendJson(ws, { type: "room_error", reason: "待機中の部屋が見つかりません" });
        return;
      }

      const room = rooms.get(targetCode);
      if (room.guest) {
        sendJson(ws, { type: "room_error", reason: "この部屋はすでに満員です" });
        return;
      }

      room.guest = ws;
      ws.roomCode = targetCode;

      sendJson(room.host, { type: "peer_joined", room: targetCode });
      sendJson(room.guest, { type: "peer_joined", room: targetCode });
      return;
    }

    const activeCode = ws.roomCode || code;
    if (!rooms.has(activeCode)) return;
    const room = rooms.get(activeCode);
    const peer = room.host === ws ? room.guest : room.host;
    if (peer) {
      sendJson(peer, msg);
    }
  });

  ws.on("close", () => cleanupSocket(ws));
  ws.on("error", () => cleanupSocket(ws));
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});