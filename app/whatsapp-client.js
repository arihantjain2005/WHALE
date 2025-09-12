const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const path = require("path");
const fs = require("fs");
const csv = require("csv-parser");
const xlsx = require("xlsx");

let client;
let io;
let isRestarting = false; // Flag to prevent restart loops

let campaign = {
  isPaused: false,
  isRunning: false,
  contacts: [],
  contactGroup: null,
  templates: [],
  currentIndex: 0,
  totalContacts: 0,
  batchSize: 20,
  currentBatchIndex: 0,
  dailyLimit: 100,
  sentToday: 0,
  sentThisCampaign: 0,
  failedThisCampaign: 0,
  minDelay: 30,
  maxDelay: 90,
  minTypingDelay: 5000,
  maxTypingDelay: 10000,
  minAttachDelay: 1000,
  maxAttachDelay: 3000,
  simulationStyle: "random",
  simulateReading: false,
  warmUp: {
    enabled: false,
    start: 20,
    increment: 10,
    days: 7,
    currentDay: 1,
  },
  report: [],
  reportName: null,
  campaignStartIndex: 0,
};

// ... (startClient, handleDisconnect, initializeWhatsAppClient functions remain unchanged) ...

function startClient() {
  console.log("-----------------------------------------");
  console.log("Initializing new WhatsApp client instance...");
  io.emit("status", "Initializing client...");
  const sessionPath = path.join(__dirname, "session");

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: sessionPath }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
    qrTimeout: 60000,
    authTimeoutMs: 60000,
  });

  client.on("loading_screen", (percent, message) => {
    io.emit("status", `Connecting to WhatsApp... (${percent}%)`);
  });

  client.on("qr", (qr) => {
    console.log("QR RECEIVED: A new QR code has been generated. Please scan.");
    io.emit("status", "QR code received. Please scan.");
    io.emit("qr", qr);
  });

  client.on("ready", () => {
    console.log("CLIENT READY: Session is valid. Client is connected.");
    io.emit("status", "Connected");
    io.emit("authenticated");
  });

  client.on("authenticated", () => {
    console.log("AUTHENTICATED: Session file has been created/validated.");
  });

  client.on("auth_failure", (msg) => {
    console.error(`AUTHENTICATION FAILURE: ${msg}`);
    io.emit("status", `Authentication failure: ${msg}. Restarting...`);
    handleDisconnect(`Authentication Failure: ${msg}`);
  });

  client.on("disconnected", (reason) => {
    handleDisconnect(reason);
  });

  io.emit("status", "Launching browser...");
  client.initialize().catch((err) => {
    console.error("Client initialization error:", err);
    io.emit("status", "Initialization failed. Restarting...");
    handleDisconnect("Initialization Timeout");
  });
}

async function handleDisconnect(reason) {
  if (isRestarting) {
    console.log(
      "Restart already in progress. Ignoring additional disconnect event."
    );
    return;
  }
  isRestarting = true;
  console.log(
    `Client disconnected for reason: "${reason}". Starting restart process.`
  );
  io.emit("status", `Client disconnected. Restarting...`);
  io.emit("show_qr");

  if (campaign.isRunning) {
    campaign.isRunning = false;
    io.emit("log", "Campaign stopped due to disconnection.");
    io.emit("campaignState", getCampaignState());
  }

  try {
    if (client) {
      await client.destroy();
      console.log("Old client instance destroyed.");
    }
  } catch (e) {
    console.error("Error during client destruction: ", e);
  }

  console.log("Waiting 5 seconds before attempting to start a new client...");
  setTimeout(() => {
    startClient();
    setTimeout(() => {
      isRestarting = false;
    }, 2000);
  }, 5000);
}

function initializeWhatsAppClient(socketIo) {
  io = socketIo;
  startClient();

  io.on("connection", (socket) => {
    console.log("UI CONNECTED: A user opened the web interface.");
    if (client && client.info) {
      console.log(
        "UI STATUS: Informing user that client is already connected."
      );
      socket.emit("status", "Connected");
      socket.emit("authenticated");
    } else {
      console.log("UI STATUS: Informing user that client is initializing.");
      socket.emit("status", "Initializing client... Please wait.");
    }
  });
}


// ... (parseContacts, getCampaignState, pause/resume/endCampaign, processSpintax, startNewCampaign functions remain unchanged) ...

function parseContacts(io, filePath, callback) {
  const contacts = [];
  const extension = path.extname(filePath).toLowerCase();
  if (io)
    io.emit(
      "log",
      `Attempting to parse contact file: ${path.basename(filePath)}`
    );
  try {
    if (extension === ".csv") {
      fs.createReadStream(filePath)
        .pipe(require("csv-parser")())
        .on("data", (row) => {
          if (row.number) contacts.push(row);
        })
        .on("end", () => callback(null, contacts))
        .on("error", (err) => callback(err, null));
    } else if (extension === ".xlsx" || extension === ".xls") {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const jsonData = xlsx.utils.sheet_to_json(sheet);
      callback(
        null,
        jsonData.filter((row) => row.number)
      );
    } else {
      throw new Error("Unsupported file type.");
    }
  } catch (error) {
    callback(error, null);
  }
}

function getCampaignState() {
  return {
    isRunning: campaign.isRunning,
    isPaused: campaign.isPaused,
    sent: campaign.sentThisCampaign,
    failed: campaign.failedThisCampaign,
    total: campaign.totalContacts,
    current: campaign.currentIndex,
  };
}

function pauseCampaign(io) {
  if (campaign.isRunning) {
    campaign.isPaused = true;
    io.emit("log", "PAUSED: Campaign has been paused by the user.");
    io.emit("campaignState", getCampaignState());
  }
}

function resumeCampaign(io) {
  if (campaign.isRunning && campaign.isPaused) {
    campaign.isPaused = false;
    io.emit("log", "RESUMED: Campaign has been resumed by the user.");
    io.emit("campaignState", getCampaignState());
    sendBatch(io);
  }
}

function endCampaign(io) {
  if (campaign.isRunning) {
    io.emit("log", "STOPPED: Campaign has been ended by the user.");
    campaign.isRunning = false;

    if (campaign.report.length > 0) {
      saveReport();
      updateStats(campaign.sentThisCampaign);
    }

    if (campaign.contactGroup) {
      updateContactProgress(campaign.contactGroup, campaign.currentIndex);
      io.emit(
        "log",
        `Progress for group "${campaign.contactGroup}" saved at contact #${campaign.currentIndex}.`
      );
    }

    io.emit("campaignState", getCampaignState());
  }
}

function processSpintax(text) {
  if (!text) return "";
  const regex = /\{([^{}]+)\}/g;
  return text.replace(regex, (match, group) => {
    const options = group.split("|");
    return options[Math.floor(Math.random() * options.length)];
  });
}

function startNewCampaign(io, data) {
    if (campaign.isRunning) {
        io.emit('log', 'ERROR: A campaign is already in progress.');
        return;
    }
    campaign.isRunning = true;
    io.emit('campaignState', getCampaignState());

    const isGroup = !!data.contactGroup;
    let contactFilePath = isGroup ?
        path.join(__dirname, 'contacts', data.contactGroup) :
        data.contactFile.path;

    parseContacts(io, contactFilePath, (err, contacts) => {
        if (err || !contacts || contacts.length === 0) {
            io.emit('log', `ERROR parsing contact file: ${err ? err.message : 'No valid contacts found.'}`);
            io.emit('log', "Ensure file has a column header named 'number'.");
            campaign.isRunning = false;
            io.emit('campaignState', getCampaignState());
            return;
        }
        io.emit('log', `SUCCESS: Parsed contact file. Found ${contacts.length} contacts.`);

        const progressData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'contact_progress.json')));
        const startIndex = (isGroup && progressData[data.contactGroup]) ? progressData[data.contactGroup] : 0;

        if (isGroup && startIndex > 0) {
            io.emit('log', `Resuming campaign for group "${data.contactGroup}" from contact #${startIndex + 1}.`);
        }

        campaign = {
            ...campaign,
            isRunning: true,
            isPaused: false,
            currentIndex: startIndex,
            campaignStartIndex: startIndex,
            currentBatchIndex: 0,
            sentToday: 0,
            sentThisCampaign: 0,
            failedThisCampaign: 0,
            report: [],
        };

        const allTemplates = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'templates.json')));
        const templateIds = Array.isArray(data.templateIds) ? data.templateIds : (data.templateIds ? [data.templateIds] : []);
        const uniqueIds = [...new Set(templateIds.map(id => String(id)))];
        campaign.templates = uniqueIds.map(id => allTemplates.find(t => String(t.id) === id)).filter(Boolean);

        if (campaign.templates.length === 0) {
            io.emit('log', 'Error: No valid templates selected.');
            campaign.isRunning = false;
            io.emit('campaignState', getCampaignState());
            return;
        }
        
        campaign.contacts = contacts;
        campaign.totalContacts = contacts.length;
        campaign.contactGroup = isGroup ? data.contactGroup : null;
        campaign.minDelay = parseInt(data.minDelay, 10);
        campaign.maxDelay = parseInt(data.maxDelay, 10);
        campaign.batchSize = parseInt(data.batchSize, 10);
        campaign.minTypingDelay = parseInt(data.minTypingDelay, 10);
        campaign.maxTypingDelay = parseInt(data.maxTypingDelay, 10);
        campaign.minAttachDelay = parseInt(data.minAttachDelay, 10);
        campaign.maxAttachDelay = parseInt(data.maxAttachDelay, 10);
        campaign.simulationStyle = data.simulationStyle;
        campaign.simulateReading = data.simulateReading === 'on';
        campaign.warmUp.enabled = data.warmUpEnabled === 'on';
        if (campaign.warmUp.enabled) {
            campaign.warmUp.start = parseInt(data.warmUpStart, 10);
            campaign.warmUp.increment = parseInt(data.warmUpIncrement, 10);
            campaign.warmUp.days = parseInt(data.warmUpDays, 10);
            campaign.warmUp.currentDay = 1;
            campaign.dailyLimit = campaign.warmUp.start;
            io.emit('log', `WARM-UP MODE: Daily limit set to ${campaign.dailyLimit} for day 1.`);
        } else {
            campaign.dailyLimit = parseInt(data.dailyLimit, 10);
        }

        if (isGroup) {
            campaign.reportName = `report-${data.contactGroup}.csv`;
        } else {
            campaign.reportName = `report-upload-${Date.now()}.csv`;
        }
        
        io.emit('log', `Campaign started with ${campaign.contacts.length} contacts and ${campaign.templates.length} message(s) per contact.`);
        io.emit('campaignState', getCampaignState());
        sendBatch(io);
    });
}


async function sendBatch(io) {
  if (!campaign.isRunning || campaign.isPaused) return;
  io.emit(
    "log",
    `Starting to send batch #${campaign.currentBatchIndex + 1}...`
  );

  const startingIndexInLoop = campaign.currentIndex;
  const batchEndIndex = Math.min(
    startingIndexInLoop + campaign.batchSize,
    campaign.contacts.length
  );

  for (let i = startingIndexInLoop; i < batchEndIndex; i++) {
    if (!campaign.isRunning || campaign.isPaused) {
      io.emit(
        "log",
        campaign.isPaused
          ? `PAUSED: Campaign paused before processing contact #${i + 1}.`
          : "STOPPED: Campaign stopped mid-batch."
      );
      return;
    }
    if (campaign.sentToday >= campaign.dailyLimit) {
      io.emit(
        "log",
        `Daily limit of ${campaign.dailyLimit} reached. Pausing campaign.`
      );
      io.emit("campaignPaused", "Daily limit reached.");
      return;
    }

    const contact = campaign.contacts[i];
    const name = contact.name || "";

    // START OF UPDATED SECTION
    let number = String(contact.number).replace(/\D/g, ""); // Clean all non-digits first
    if (number.length === 10 && !number.startsWith("91")) {
      number = "91" + number;
    }
    let formattedNumber = `${number}@c.us`;
    // END OF UPDATED SECTION

    const sentTemplateIdsThisContact = new Set();
    let forcedTypingDoneForThisContact = false;

    try {
      io.emit(
        "log",
        `[${i + 1}/${campaign.totalContacts}] Processing contact: ${number}`
      );
      const isRegistered = await client.isRegisteredUser(formattedNumber);
      if (!isRegistered) {
        io.emit("log", `-> Skipping ${number}: Not a WhatsApp number.`);
        campaign.report.push({ number, name, status: "Not on WhatsApp" });
        campaign.failedThisCampaign++;
        continue;
      }

      const chat = await client.getChatById(formattedNumber);

      for (
        let templateIndex = 0;
        templateIndex < campaign.templates.length;
        templateIndex++
      ) {
        const template = campaign.templates[templateIndex];

        if (template && template.id != null) {
          if (sentTemplateIdsThisContact.has(template.id)) {
            io.emit("log", "-> Skipping duplicate template for this contact.");
            continue;
          }
          sentTemplateIdsThisContact.add(template.id);
        }

        if (!campaign.isRunning || campaign.isPaused) {
          io.emit(
            "log",
            `PAUSED: Campaign paused while processing templates for ${number}.`
          );
          return;
        }

        let personalizedMessage = processSpintax(template.message);
        if (name)
          personalizedMessage = personalizedMessage.replace(/{name}/g, name);
        else
          personalizedMessage = personalizedMessage
            .replace(/ ?{name},?/g, "")
            .trim();

        let shouldType =
          campaign.simulationStyle === "typing" ||
          (campaign.simulationStyle === "random" && Math.random() > 0.3);

        if (
          i === campaign.campaignStartIndex &&
          !forcedTypingDoneForThisContact
        ) {
          shouldType = true;
          forcedTypingDoneForThisContact = true;
          io.emit(
            "log",
            "-> First contact of campaign, forcing typing simulation."
          );
        }

        if (shouldType) {
          io.emit(
            "log",
            `-> Simulating typing for message: "${personalizedMessage.substring(
              0,
              20
            )}..."`
          );
          const charsPerMs = 0.05;
          const calculatedDelay = personalizedMessage.length / charsPerMs;
          const typingDelay = Math.max(
            campaign.minTypingDelay,
            Math.min(campaign.maxTypingDelay, calculatedDelay)
          );
          await chat.sendStateTyping();
          await new Promise((resolve) => setTimeout(resolve, typingDelay));
          await chat.clearState();
        } else {
          io.emit("log", `-> Simulating copy-paste...`);
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        if (!campaign.isRunning || campaign.isPaused) {
          io.emit(
            "log",
            `PAUSED: Campaign paused after simulation for ${number}.`
          );
          return;
        }

        const filesToSend = template.filePaths || [];
        if (filesToSend.length > 0) {
          const attachDelay = Math.floor(
            Math.random() *
              (campaign.maxAttachDelay - campaign.minAttachDelay + 1) +
              campaign.minAttachDelay
          );
          io.emit(
            "log",
            `-> Simulating file search for ${attachDelay / 1000} seconds...`
          );
          await new Promise((resolve) => setTimeout(resolve, attachDelay));

          if (!campaign.isRunning || campaign.isPaused) {
            io.emit(
              "log",
              `PAUSED: Campaign paused before attaching files for ${number}.`
            );
            return;
          }

          io.emit("log", `-> Attaching ${filesToSend.length} media file(s)...`);

          for (let j = 0; j < filesToSend.length; j++) {
            const filePath = path.join(__dirname, "media", filesToSend[j]);
            if (!fs.existsSync(filePath)) continue;

            const media = MessageMedia.fromFilePath(filePath);
            const caption =
              j === 0 && templateIndex === 0 ? personalizedMessage : "";

            await client.sendMessage(formattedNumber, media, { caption });
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } else {
          io.emit("log", `-> Sending text message...`);
          await client.sendMessage(formattedNumber, personalizedMessage);
        }

        io.emit("log", `-> Message part sent successfully.`);
        if (campaign.templates.length > 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.random() * 2000 + 1000)
          );
        }
      }

      io.emit("log", `-> All messages for ${number} sent successfully.`);
      campaign.report.push({ number, name, status: "Sent" });
      campaign.sentToday++;
      campaign.sentThisCampaign++;
    } catch (err) {
      io.emit("log", `ERROR: Failed to send to ${number}: ${err.message}`);
      campaign.report.push({ number, name, status: `Failed: ${err.message}` });
      campaign.failedThisCampaign++;
    } finally {
      campaign.currentIndex = i + 1;
      if (campaign.contactGroup) {
        updateContactProgress(campaign.contactGroup, campaign.currentIndex);
      }
      io.emit("campaignState", getCampaignState());
    }

    if (!campaign.isRunning) {
      io.emit("log", "STOPPED: Campaign stopped before next contact.");
      return;
    }

    const delay =
      Math.floor(
        Math.random() * (campaign.maxDelay - campaign.minDelay + 1) +
          campaign.minDelay
      ) * 1000;
    io.emit(
      "log",
      `-> Waiting for ${delay / 1000} seconds before next contact...`
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  campaign.currentBatchIndex++;
  if (campaign.currentIndex >= campaign.contacts.length) {
    io.emit("log", "Campaign finished!");
    campaign.isRunning = false;
    saveReport();
    updateStats(campaign.sentThisCampaign);
    io.emit("campaignState", getCampaignState());
  } else {
    if (campaign.simulateReading) await simulateReadingActivity(io);
    io.emit(
      "log",
      `Batch #${campaign.currentBatchIndex} complete. Waiting for user to start next batch.`
    );
    io.emit("batchComplete", { nextBatch: campaign.currentBatchIndex + 1 });
  }
}

// ... (updateContactProgress, simulateReadingActivity, updateStats, sendNextBatch, saveReport functions remain unchanged) ...
function updateContactProgress(groupName, index) {
  const progressPath = path.join(__dirname, "data", "contact_progress.json");
  if (!fs.existsSync(progressPath)) return;
  const progressData = JSON.parse(fs.readFileSync(progressPath));
  progressData[groupName] = index;
  fs.writeFileSync(progressPath, JSON.stringify(progressData, null, 2));
}

async function simulateReadingActivity(io) {
  try {
    io.emit("log", "SIMULATING: Pausing for idle activity...");
    await new Promise((resolve) =>
      setTimeout(resolve, Math.random() * 10000 + 5000)
    );
    const chats = await client.getChats();
    if (chats.length > 0) {
      const randomChat =
        chats[Math.floor(Math.random() * Math.min(chats.length, 10))];
      io.emit(
        "log",
        `SIMULATING: Opening chat with "${randomChat.name}" to look human...`
      );
      await randomChat.sendStateTyping();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await randomChat.clearState();
    }
  } catch (e) {
    io.emit("log", "Could not simulate reading activity.");
  }
}

function updateStats(sentCount) {
  const statsPath = path.join(__dirname, "data", "stats.json");
  let stats = { totalSent: 0, daily: [] };
  if (fs.existsSync(statsPath)) {
    stats = JSON.parse(fs.readFileSync(statsPath));
  }
  const today = new Date().toISOString().split("T")[0];

  stats.totalSent = (stats.totalSent || 0) + sentCount;
  stats.daily = stats.daily || [];

  const todayEntry = stats.daily.find((d) => d.date === today);
  if (todayEntry) {
    todayEntry.sent += sentCount;
  } else {
    stats.daily.push({ date: today, sent: sentCount });
  }

  fs.writeFileSync(statsPath, JSON.stringify(stats));
  io.emit("statsUpdated");
}

function sendNextBatch(io) {
  if (campaign.isRunning) sendBatch(io);
}

function saveReport() {
  if (!campaign.reportName || campaign.report.length === 0) return;
  io.emit(
    "log",
    `SAVING REPORT: ${campaign.reportName} with ${campaign.report.length} entries.`
  );
  const reportPath = path.join(__dirname, "data", campaign.reportName);
  const headers = "number,name,status\n";

  const fileExists = fs.existsSync(reportPath);
  const writeStream = fs.createWriteStream(reportPath, { flags: "a" });

  if (!fileExists) {
    writeStream.write(headers);
  }

  const csvContent = campaign.report
    .map((r) => `${r.number},${r.name || ""},"${r.status.replace(/"/g, '""')}"`)
    .join("\n");
  writeStream.write(csvContent + "\n");
  writeStream.end();

  console.log(`Report data saved to ${reportPath}`);
}


module.exports = {
  initializeWhatsAppClient,
  startNewCampaign,
  sendNextBatch,
  pauseCampaign,
  resumeCampaign,
  endCampaign,
  getCampaignState,
  parseContacts,
};