const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const apiRoutes = require("./routes");

// CORRECTED: Import from the correct modules
const { initializeWhatsAppClient } = require("./whatsapp/client");
const {
  getCampaignState,
  sendNextBatch,
  pauseCampaign,
  resumeCampaign,
  endCampaign,
} = require("./whatsapp/campaignManager");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Add io to the app object to make it accessible in routes
app.set("socketio", io);

const PORT = 3000;

// --- DIRECTORY SETUP ---
const mediaDir = path.join(__dirname, "media");
const dataDir = path.join(__dirname, "data");
const contactDir = path.join(__dirname, "contacts");
const sessionDir = path.join(__dirname, "session");
const contactUploadDir = path.join(__dirname, "..", "uploads");
[mediaDir, dataDir, contactDir, contactUploadDir, sessionDir].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- INITIAL FILE CREATION ---
if (!fs.existsSync(path.join(dataDir, "templates.json"))) {
  fs.writeFileSync(path.join(dataDir, "templates.json"), "[]");
}
if (!fs.existsSync(path.join(dataDir, "stats.json"))) {
  fs.writeFileSync(
    path.join(dataDir, "stats.json"),
    JSON.stringify({ totalSent: 0, daily: [] })
  );
}
if (!fs.existsSync(path.join(dataDir, "contact_progress.json"))) {
  fs.writeFileSync(path.join(dataDir, "contact_progress.json"), "{}");
}

// --- MIDDLEWARE ---
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../views"));
app.use(express.static(path.join(__dirname, "../public")));
app.use(
  "/media",
  express.static(mediaDir, {
    setHeaders: (res) => res.set("Cache-Control", "no-store"),
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- API ROUTES ---
app.use("/api", apiRoutes);

// --- PAGE ROUTES ---
app.get("/", (req, res) => res.render("dashboard"));
app.get("/templates", (req, res) => res.render("templates"));
app.get("/media", (req, res) => res.render("media"));
app.get("/reports", (req, res) => res.render("reports"));
app.get("/contacts", (req, res) => res.render("contacts"));

// --- WHATSAPP & SOCKET.IO INITIALIZATION ---
initializeWhatsAppClient(io);
io.on("connection", (socket) => {
  socket.emit("campaignState", getCampaignState());
  socket.on("sendNextBatch", () => sendNextBatch(io));
  socket.on("pauseCampaign", () => pauseCampaign(io));
  socket.on("resumeCampaign", () => resumeCampaign(io));
  socket.on("endCampaign", () => endCampaign(io));
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});