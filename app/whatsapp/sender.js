const { MessageMedia } = require("whatsapp-web.js");
const path = require("path");
const fs = require("fs");
const { getClient } = require("./client");
const { getCampaign, getCampaignState, updateContactProgress, updateStats, saveReport } = require("./campaignManager");

let campaignShouldStop = false;

function stopSending() {
    campaignShouldStop = true;
}

async function simulateReadingActivity(io) {
    const client = getClient();
    try {
      io.emit("log", "SIMULATING: Pausing for idle activity...");
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 10000 + 5000));
      const chats = await client.getChats();
      if (chats.length > 0) {
        const randomChat = chats[Math.floor(Math.random() * Math.min(chats.length, 10))];
        io.emit("log", `SIMULATING: Opening chat with "${randomChat.name}" to look human...`);
        await randomChat.sendStateTyping();
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await randomChat.clearState();
      }
    } catch (e) {
      io.emit("log", "Could not simulate reading activity.");
    }
}

async function sendBatch(io) {
    const client = getClient();
    let campaign = getCampaign();
    campaignShouldStop = false;

    io.emit("log", `Starting to send batch #${campaign.currentBatchIndex + 1}...`);

    const startingIndexInLoop = campaign.currentIndex;
    const batchEndIndex = Math.min(
        startingIndexInLoop + campaign.batchSize,
        campaign.contacts.length
    );

    for (let i = startingIndexInLoop; i < batchEndIndex; i++) {
        if (campaignShouldStop || !campaign.isRunning || campaign.isPaused) {
            io.emit("log", campaign.isPaused ? `PAUSED: Campaign paused before processing contact #${i + 1}.` : "STOPPED: Campaign stopped mid-batch.");
            return;
        }
        if (campaign.sentToday >= campaign.dailyLimit) {
            io.emit("log", `Daily limit of ${campaign.dailyLimit} reached. Pausing campaign.`);
            io.emit("campaignPaused", "Daily limit reached.");
            return;
        }

        const contact = campaign.contacts[i];
        const name = contact.name || "";
        let number = String(contact.number).replace(/\D/g, "");
        if (number.length === 10 && !number.startsWith("91")) {
            number = "91" + number;
        }
        let formattedNumber = `${number}@c.us`;
        const sentTemplateIdsThisContact = new Set();
        let forcedTypingDoneForThisContact = false;

        try {
            io.emit("log", `[${i + 1}/${campaign.totalContacts}] Processing contact: ${number}`);
            const isRegistered = await client.isRegisteredUser(formattedNumber);
            if (!isRegistered) {
                io.emit("log", `-> Skipping ${number}: Not a WhatsApp number.`);
                campaign.report.push({ number, name, status: "Not on WhatsApp" });
                campaign.failedThisCampaign++;
                continue;
            }

            const chat = await client.getChatById(formattedNumber);
            
            for (let templateIndex = 0; templateIndex < campaign.templates.length; templateIndex++) {
                // ... (The inner loop for sending multiple templates per contact)
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

        const delay = Math.floor(Math.random() * (campaign.maxDelay - campaign.minDelay + 1) + campaign.minDelay) * 1000;
        io.emit("log", `-> Waiting for ${delay / 1000} seconds before next contact...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
    }

    campaign.currentBatchIndex++;
    if (campaign.currentIndex >= campaign.contacts.length) {
        io.emit("log", "Campaign finished!");
        campaign.isRunning = false;
        saveReport(io);
        updateStats(io, campaign.sentThisCampaign);
        io.emit("campaignState", getCampaignState());
    } else {
        if (campaign.simulateReading) await simulateReadingActivity(io);
        io.emit("log", `Batch #${campaign.currentBatchIndex} complete. Waiting for user to start next batch.`);
        io.emit("batchComplete", { nextBatch: campaign.currentBatchIndex + 1 });
    }
}

module.exports = { sendBatch, stopSending };