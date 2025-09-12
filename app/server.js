const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");

const {
  initializeWhatsAppClient,
  startNewCampaign,
  sendNextBatch,
  pauseCampaign,
  resumeCampaign,
  endCampaign,
  getCampaignState,
  parseContacts,
} = require("./whatsapp-client");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// Directories
const mediaDir = path.join(__dirname, "media");
const dataDir = path.join(__dirname, "data");
const contactDir = path.join(__dirname, "contacts");
const sessionDir = path.join(__dirname, "session");
const contactUploadDir = path.join(__dirname, "..", "uploads");
[mediaDir, dataDir, contactDir, contactUploadDir, sessionDir].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Initial files
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

// Helpers
const loadTemplates = () =>
  JSON.parse(fs.readFileSync(path.join(dataDir, "templates.json")));
const saveTemplates = (t) =>
  fs.writeFileSync(
    path.join(dataDir, "templates.json"),
    JSON.stringify(t, null, 2)
  );

// Middleware
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

// Multer storage
const mediaStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, mediaDir),
  filename: (req, file, cb) => cb(null, file.originalname),
});
const contactStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, contactDir),
  filename: (req, file, cb) => cb(null, file.originalname),
});
const tempContactStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, contactUploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const mediaUpload = multer({ storage: mediaStorage });
const contactUpload = multer({ storage: contactStorage });
const tempContactUpload = multer({ storage: tempContactStorage });

// ---- PAGE ROUTES ----
app.get("/", (req, res) => res.render("dashboard"));
app.get("/templates", (req, res) => res.render("templates"));
app.get("/media", (req, res) => res.render("media"));
app.get("/reports", (req, res) => res.render("reports"));
app.get("/contacts", (req, res) => res.render("contacts"));

// ---- API ROUTES ----

// Stats
app.get("/api/stats", (req, res) => {
  const statsPath = path.join(dataDir, "stats.json");
  if (!fs.existsSync(statsPath))
    return res.json({ totalSent: 0, totalCampaigns: 0, daily: [] });
  const stats = JSON.parse(fs.readFileSync(statsPath));
  const reports = fs
    .readdirSync(dataDir)
    .filter((file) => file.startsWith("report-"));
  stats.totalCampaigns = reports.length;
  res.json(stats);
});

app.post("/api/stats/reset", (req, res) => {
  fs.writeFileSync(
    path.join(dataDir, "stats.json"),
    JSON.stringify({ totalSent: 0, daily: [] })
  );
  fs.readdirSync(dataDir)
    .filter((f) => f.startsWith("report-"))
    .forEach((f) => fs.unlinkSync(path.join(dataDir, f)));
  res.json({ success: true });
});

// Media
app.get("/api/media", (req, res) => {
  fs.readdir(mediaDir, (err, files) => {
    if (err)
      return res.status(500).json({ error: "Could not read media directory" });
    const fileData = files.map((file) => ({
      name: file,
      isImage: [".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(
        path.extname(file).toLowerCase()
      ),
    }));
    res.json(fileData);
  });
});
app.post("/api/media/upload", mediaUpload.array("mediaFiles", 10), (req, res) =>
  res.redirect("/media")
);
app.delete("/api/media/:filename", (req, res) => {
  const filePath = path.join(mediaDir, req.params.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ success: true });
});
app.put("/api/media/rename", (req, res) => {
  const { oldName, newName } = req.body;
  const oldPath = path.join(mediaDir, oldName);
  const newPath = path.join(mediaDir, newName);
  if (!oldName || !newName || oldName === newName || !fs.existsSync(oldPath))
    return res.status(400).json({ error: "Invalid filenames" });
  if (fs.existsSync(newPath))
    return res
      .status(400)
      .json({ error: "A file with that name already exists." });

  fs.renameSync(oldPath, newPath);
  let templates = loadTemplates();
  templates.forEach((t) => {
    if (t.filePaths && Array.isArray(t.filePaths)) {
      const index = t.filePaths.indexOf(oldName);
      if (index > -1) t.filePaths[index] = newName;
    }
  });
  saveTemplates(templates);
  res.json({ success: true });
});

// Templates
app.get("/api/templates", (req, res) =>
  res.sendFile(path.join(dataDir, "templates.json"))
);
app.get("/api/templates/:id", (req, res) => {
    const templates = loadTemplates();
    const template = templates.find(t => t.id == req.params.id);
    if (template) {
        res.json(template);
    } else {
        res.status(404).json({ error: "Template not found" });
    }
});
app.post("/api/templates", (req, res) => {
  let templates = loadTemplates();
  const newTemplate = { id: Date.now(), ...req.body };
  templates.push(newTemplate);
  saveTemplates(templates);
  res.json(newTemplate);
});
app.put("/api/templates/:id", (req, res) => {
  let templates = loadTemplates();
  const index = templates.findIndex((t) => t.id == req.params.id);
  if (index === -1)
    return res.status(404).json({ error: "Template not found" });
  templates[index] = { ...templates[index], ...req.body };
  saveTemplates(templates);
  res.json(templates[index]);
});
app.delete("/api/templates/:id", (req, res) => {
  let templates = loadTemplates();
  templates = templates.filter((t) => t.id != req.params.id);
  saveTemplates(templates);
  res.json({ success: true });
});

// Contacts
app.get("/api/contacts", (req, res) => {
  fs.readdir(contactDir, (err, files) => {
    if (err)
      return res
        .status(500)
        .json({ error: "Could not read contacts directory" });
    const progressData = JSON.parse(
      fs.readFileSync(path.join(dataDir, "contact_progress.json"))
    );
    const response = files
      .filter(
        (f) => f.endsWith(".csv") || f.endsWith(".xlsx") || f.endsWith(".xls")
      )
      .map((file) => ({ name: file, progress: progressData[file] || 0 }));
    res.json(response);
  });
});
app.post(
  "/api/contacts/upload",
  contactUpload.single("contactFile"),
  (req, res) => res.redirect("/contacts")
);
app.delete("/api/contacts/:filename", (req, res) => {
  const filePath = path.join(contactDir, req.params.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  const progressData = JSON.parse(
    fs.readFileSync(path.join(dataDir, "contact_progress.json"))
  );
  delete progressData[req.params.filename];
  fs.writeFileSync(
    path.join(dataDir, "contact_progress.json"),
    JSON.stringify(progressData, null, 2)
  );
  res.json({ success: true });
});
app.get("/api/contacts/:filename", (req, res) => {
  const filePath = path.join(contactDir, req.params.filename);
  parseContacts(null, filePath, (err, contacts) => {
    if (err)
      return res.status(500).json({ error: "Could not read contact file." });
    res.json(contacts);
  });
});
app.post("/api/contacts/:filename/reset", (req, res) => {
  const progressData = JSON.parse(
    fs.readFileSync(path.join(dataDir, "contact_progress.json"))
  );
  delete progressData[req.params.filename];
  fs.writeFileSync(
    path.join(dataDir, "contact_progress.json"),
    JSON.stringify(progressData, null, 2)
  );
  res.json({ success: true });
});
app.post("/api/contacts/:filename", (req, res) => {
  const contacts = req.body;
  const filePath = path.join(contactDir, req.params.filename);
  try {
    const worksheet = xlsx.utils.json_to_sheet(contacts);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, "Contacts");
    xlsx.writeFile(workbook, filePath);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to save file." });
  }
});

// Campaign
app.post(
  "/api/campaign/start",
  tempContactUpload.single("contactFile"),
  (req, res) => {
    const raw = req.body.templateIds;
    const asArray = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const templateIds = [...new Set(asArray.map((id) => String(id)))];

    const campaignData = { ...req.body, templateIds, contactFile: req.file };
    startNewCampaign(io, campaignData);
    res.json({ success: true, message: "Campaign started." });
  }
);

// Reports
app.get("/api/reports", (req, res) => {
  fs.readdir(dataDir, (err, files) => {
    if (err)
      return res
        .status(500)
        .json({ error: "Could not read reports directory" });
    const reportFiles = files.filter(
      (file) => file.startsWith("report-") && file.endsWith(".csv")
    );
    res.json(reportFiles);
  });
});
app.get("/api/reports/:filename", (req, res) => {
  const filePath = path.join(dataDir, req.params.filename);
  const results = [];
  fs.createReadStream(filePath)
    .pipe(require("csv-parser")())
    .on("data", (data) => results.push(data))
    .on("end", () => res.json(results))
    .on("error", () =>
      res.status(500).json({ error: "Could not read report file." })
    );
});
app.delete("/api/reports/:filename", (req, res) => {
  const filePath = path.join(dataDir, req.params.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ success: true });
});

// WhatsApp Init + Socket
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

