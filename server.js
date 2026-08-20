import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import {
  TikTokLiveConnection,
  WebcastEvent,
  ControlEvent
} from "tiktok-live-connector";

const PORT = Number(process.env.PORT || 10000);
const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME || "spiritdrive941";

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      status: "online",
      game: "LOVE vs MONEY",
      tiktok: TIKTOK_USERNAME
    })
  );
});

const wss = new WebSocketServer({ server: httpServer });

const clients = new Set();

let lastTotalLikes = null;

function broadcast(event) {
  const message = JSON.stringify({
    ...event,
    timestamp: Date.now()
  });

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }

  console.log("GAME EVENT:", message);
}

wss.on("connection", (socket) => {
  clients.add(socket);

  console.log("Tablet connected.");

  socket.send(
    JSON.stringify({
      type: "bridge_status",
      status: "connected",
      tiktok: TIKTOK_USERNAME
    })
  );

  socket.on("close", () => {
    clients.delete(socket);
    console.log("Tablet disconnected.");
  });
});

const connection = new TikTokLiveConnection(TIKTOK_USERNAME, {
  enableExtendedGiftInfo: true
});

// -----------------------------
// CONNECT / DISCONNECT
// -----------------------------

connection.on(ControlEvent.CONNECTED, (state) => {
  console.log(`Connected to TikTok LIVE: @${TIKTOK_USERNAME}`);
  console.log(`Room ID: ${state.roomId}`);

  broadcast({
    type: "bridge_status",
    status: "tiktok_connected"
  });
});

connection.on(ControlEvent.DISCONNECTED, ({ code, reason }) => {
  console.log("TikTok disconnected:", code, reason || "");

  broadcast({
    type: "bridge_status",
    status: "tiktok_disconnected"
  });

  setTimeout(connectToTikTok, 5000);
});

connection.on(ControlEvent.ERROR, (error) => {
  console.error("TikTok connection error:", error);
});

// -----------------------------
// COMMENTS
// -----------------------------

connection.on(WebcastEvent.CHAT, (data) => {
  const comment = String(data.comment || "").trim().toLowerCase();
  const username = data.user?.uniqueId || "viewer";

  console.log(`COMMENT: ${username}: ${data.comment}`);

  if (comment === "love") {
    broadcast({
      type: "love",
      points: 1,
      source: "comment",
      user: username
    });
  }

  if (comment === "money") {
    broadcast({
      type: "money",
      points: 1,
      source: "comment",
      user: username
    });
  }
});

// -----------------------------
// LIKES
// Every 10 likes = LOVE +1 and MONEY +1
// -----------------------------

connection.on(WebcastEvent.LIKE, (data) => {
  const totalLikes = Number(data.totalLikeCount || 0);

  console.log(
    `LIKE: ${data.uniqueId || "viewer"} +${data.likeCount || 0} ` +
    `(total: ${totalLikes})`
  );

  // Establish the starting total without awarding points
  // for likes that happened before the bridge connected.
  if (lastTotalLikes === null) {
    lastTotalLikes = totalLikes;
    return;
  }

  const increase = Math.max(0, totalLikes - lastTotalLikes);

  if (increase > 0) {
    const previousMilestone = Math.floor(lastTotalLikes / 10);
    const newMilestone = Math.floor(totalLikes / 10);

    const milestonesReached = newMilestone - previousMilestone;

    if (milestonesReached > 0) {
      broadcast({
        type: "likes_milestone",
        points: milestonesReached,
        lovePoints: milestonesReached,
        moneyPoints: milestonesReached,
        totalLikes
      });
    }

    lastTotalLikes = totalLikes;
  }
});

// -----------------------------
// GIFTS
// Rose = LOVE +10
// Donut = MONEY +10
// -----------------------------

connection.on(WebcastEvent.GIFT, (data) => {
  const giftName = String(
    data.giftDetails?.giftName ||
    data.giftName ||
    ""
  ).trim();

  const normalizedGift = giftName.toLowerCase();

  const username = data.user?.uniqueId || "viewer";
  const repeatCount = Number(data.repeatCount || 1);
  const giftType = data.giftDetails?.giftType;

  console.log(
    `GIFT: ${username} sent ${giftName} x${repeatCount}`
  );

  // Streakable gifts send intermediate events.
  // Only score the completed streak.
  if (giftType === 1 && !data.repeatEnd) {
    return;
  }

  if (normalizedGift.includes("rose")) {
    broadcast({
      type: "rose",
      points: 10 * repeatCount,
      source: "gift",
      gift: giftName,
      count: repeatCount,
      user: username
    });
  }

  if (normalizedGift.includes("donut")) {
    broadcast({
      type: "donut",
      points: 10 * repeatCount,
      source: "gift",
      gift: giftName,
      count: repeatCount,
      user: username
    });
  }
});

// -----------------------------
// CONNECT TO TIKTOK
// -----------------------------

async function connectToTikTok() {
  try {
    console.log(`Connecting to @${TIKTOK_USERNAME}...`);

    await connection.connect();

    console.log("TikTok connection established.");
  } catch (error) {
    console.error("Could not connect to TikTok:", error.message);

    setTimeout(connectToTikTok, 10000);
  }
}

// -----------------------------
// START SERVER
// -----------------------------

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`LOVE vs MONEY bridge running on port ${PORT}`);
  console.log(`TikTok account: @${TIKTOK_USERNAME}`);

  connectToTikTok();
});
