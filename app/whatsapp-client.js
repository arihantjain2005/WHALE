const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const xlsx = require('xlsx');

let client;
let io;

let campaign = {
    isPaused: false,
    isRunning: false,
    contacts: [],
    contactGroup: null,
    template: null,
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
    simulationStyle: 'random',
    simulateReading: false,
    warmUp: {
        enabled: false,
        start: 20,
        increment: 10,
        days: 7,
        currentDay: 1
    },
    report: [],
    reportName: null
};

function startClient() {
    console.log('Initializing new WhatsApp client instance...');
    const sessionPath = path.join(__dirname, 'session');
    client = new Client({
        authStrategy: new LocalAuth({ dataPath: sessionPath }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
    });

    client.on('qr', (qr) => {
        io.emit('qr', qr);
        io.emit('status', 'QR code received. Please scan.');
    });
    client.on('ready', () => {
        io.emit('status', 'WhatsApp client is ready.');
        io.emit('authenticated');
    });
    client.on('authenticated', () => {
        io.emit('status', 'Authentication successful.');
    });
    client.on('auth_failure', msg => {
        io.emit('status', `Authentication failure: ${msg}. Restarting...`);
        setTimeout(startClient, 5000);
    });
    client.on('disconnected', async (reason) => {
        io.emit('status', `Client disconnected: ${reason}. Restarting...`);
        io.emit('show_qr');
        if (campaign.isRunning) {
            campaign.isRunning = false;
            io.emit('log', 'Campaign stopped due to disconnection.');
            io.emit('campaignState', getCampaignState());
        }
        try {
            await client.destroy();
        } catch (e) {
            console.error("Error destroying client: ", e);
        }
        startClient();
    });

    client.initialize().catch(err => console.error('Client initialization error:', err));
}

function initializeWhatsAppClient(socketIo) {
    io = socketIo;
    startClient();
    io.on('connection', (socket) => {
        if (client && client.info) {
             socket.emit('status', 'WhatsApp client is ready.');
             socket.emit('authenticated');
        } else {
             socket.emit('status', 'Initializing client... Waiting for QR code.');
        }
    });
}

function parseContacts(io, filePath, callback) {
    const contacts = [];
    const extension = path.extname(filePath).toLowerCase();
    if(io) io.emit('log', `Attempting to parse contact file: ${path.basename(filePath)}`);
    try {
        if (extension === '.csv') {
            fs.createReadStream(filePath)
                .pipe(csv())
                .on('data', (row) => { if (row.number) contacts.push(row); })
                .on('end', () => callback(null, contacts))
                .on('error', (err) => callback(err, null));
        } else if (extension === '.xlsx' || extension === '.xls') {
            const workbook = xlsx.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const jsonData = xlsx.utils.sheet_to_json(sheet);
            callback(null, jsonData.filter(row => row.number));
        } else {
            throw new Error('Unsupported file type.');
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
        current: campaign.currentIndex
    };
}

function pauseCampaign(io) {
    if (campaign.isRunning) {
        campaign.isPaused = true;
        io.emit('log', 'PAUSED: Campaign has been paused by the user.');
        io.emit('campaignState', getCampaignState());
    }
}

function resumeCampaign(io) {
    if (campaign.isRunning && campaign.isPaused) {
        campaign.isPaused = false;
        io.emit('log', 'RESUMED: Campaign has been resumed by the user.');
        io.emit('campaignState', getCampaignState());
        sendBatch(io);
    }
}

function endCampaign(io) {
    if (campaign.isRunning) {
        io.emit('log', 'STOPPED: Campaign has been ended by the user.');
        campaign.isRunning = false; 
        
        if (campaign.report.length > 0) {
            saveReport();
            updateStats(campaign.sentThisCampaign);
        }
        
        if (campaign.contactGroup) {
            updateContactProgress(campaign.contactGroup, campaign.currentIndex);
            io.emit('log', `Progress for group "${campaign.contactGroup}" saved at contact #${campaign.currentIndex}.`);
        }

        io.emit('campaignState', getCampaignState());
    }
}

function processSpintax(text) {
    if (!text) return '';
    const regex = /\{([^{}]+)\}/g;
    return text.replace(regex, (match, group) => {
        const options = group.split('|');
        return options[Math.floor(Math.random() * options.length)];
    });
}

function startNewCampaign(io, data) {
    if (campaign.isRunning) {
        io.emit('log', 'ERROR: A campaign is already in progress.');
        return;
    }
    
    const isGroup = !!data.contactGroup;
    let contactFilePath = isGroup ? path.join(__dirname, 'contacts', data.contactGroup) : data.contactFile.path;
    
    parseContacts(io, contactFilePath, (err, contacts) => {
        if (err || !contacts || contacts.length === 0) {
            io.emit('log', `ERROR parsing contact file: ${err ? err.message : 'No valid contacts found.'}`);
            io.emit('log', "Ensure file has a column header named 'number'.");
            return;
        }
        io.emit('log', `SUCCESS: Parsed contact file. Found ${contacts.length} contacts.`);

        const progressData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'contact_progress.json')));
        const startIndex = (isGroup && progressData[data.contactGroup]) ? progressData[data.contactGroup] : 0;

        if (isGroup && startIndex > 0) {
            io.emit('log', `Resuming campaign for group "${data.contactGroup}" from contact #${startIndex + 1}.`);
        }

        campaign = { ...campaign, isRunning: true, isPaused: false, currentIndex: startIndex, currentBatchIndex: 0, sentToday: 0, sentThisCampaign: 0, failedThisCampaign: 0, report: [] };
        
        const templates = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'templates.json')));
        campaign.template = templates.find(t => t.id == data.templateId);
        if (!campaign.template) {
            io.emit('log', 'Error: Template not found.');
            campaign.isRunning = false;
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

        // CORRECTED: Report name is now cumulative per group, not per day.
        if (isGroup) {
            campaign.reportName = `report-${data.contactGroup}.csv`;
        } else {
            campaign.reportName = `report-upload-${Date.now()}.csv`;
        }

        io.emit('log', `Campaign started with ${campaign.contacts.length} contacts.`);
        io.emit('campaignState', getCampaignState());
        sendBatch(io);
    });
}

async function sendBatch(io) {
    if (!campaign.isRunning || campaign.isPaused) return;
    io.emit('log', `Starting to send batch #${campaign.currentBatchIndex + 1}...`);
    
    const startingIndexInLoop = campaign.currentIndex;
    const batchEndIndex = Math.min(startingIndexInLoop + campaign.batchSize, campaign.contacts.length);

    for (let i = startingIndexInLoop; i < batchEndIndex; i++) {
        if (!campaign.isRunning || campaign.isPaused) {
            io.emit('log', campaign.isPaused ? 'Campaign paused mid-batch.' : 'Campaign stopped mid-batch.');
            return;
        }
        if (campaign.sentToday >= campaign.dailyLimit) {
            io.emit('log', `Daily limit of ${campaign.dailyLimit} reached. Pausing campaign.`);
            io.emit('campaignPaused', 'Daily limit reached.');
            return;
        }
        
        const contact = campaign.contacts[i];
        const number = String(contact.number);
        const name = contact.name || '';
        let formattedNumber = `${number.replace(/\D/g, '')}@c.us`;

        try {
            io.emit('log', `[${i+1}/${campaign.totalContacts}] Checking number: ${number}`);
            const isRegistered = await client.isRegisteredUser(formattedNumber);
            if (!isRegistered) {
                io.emit('log', `-> Skipping ${number}: Not a WhatsApp number.`);
                campaign.report.push({ number, name, status: 'Not on WhatsApp' });
                campaign.failedThisCampaign++;
                continue;
            }
            let personalizedMessage = processSpintax(campaign.template.message);
            if (name) personalizedMessage = personalizedMessage.replace(/{name}/g, name);
            else personalizedMessage = personalizedMessage.replace(/ ?{name},?/g, '').trim();

            io.emit('log', `-> Opening chat with ${number}`);
            const chat = await client.getChatById(formattedNumber);
            
            const shouldType = campaign.simulationStyle === 'typing' || (campaign.simulationStyle === 'random' && Math.random() > 0.3);
            if (shouldType) {
                io.emit('log', `-> Simulating typing...`);
                const charsPerMs = 0.05;
                const calculatedDelay = personalizedMessage.length / charsPerMs;
                const typingDelay = Math.max(campaign.minTypingDelay, Math.min(campaign.maxTypingDelay, calculatedDelay));
                await chat.sendStateTyping();
                await new Promise(resolve => setTimeout(resolve, typingDelay));
                await chat.clearState();
            } else {
                io.emit('log', `-> Simulating copy-paste...`);
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            const filesToSend = campaign.template.filePaths || [];
            if (filesToSend.length > 0) {
                io.emit('log', `-> Attaching ${filesToSend.length} media file(s)...`);
                const firstFilePath = path.join(__dirname, 'media', filesToSend[0]);
                if (fs.existsSync(firstFilePath)) {
                    const firstMedia = MessageMedia.fromFilePath(firstFilePath);
                    await client.sendMessage(formattedNumber, firstMedia, { caption: personalizedMessage });
                }
                for(let j = 1; j < filesToSend.length; j++) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    const subsequentFilePath = path.join(__dirname, 'media', filesToSend[j]);
                     if (fs.existsSync(subsequentFilePath)) {
                        const subsequentMedia = MessageMedia.fromFilePath(subsequentFilePath);
                        await client.sendMessage(formattedNumber, subsequentMedia);
                    }
                }
            } else {
                io.emit('log', `-> Sending text message...`);
                await client.sendMessage(formattedNumber, personalizedMessage);
            }
            io.emit('log', `SUCCESS: Message sent to ${number}`);
            campaign.report.push({ number, name, status: 'Sent' });
            campaign.sentToday++;
            campaign.sentThisCampaign++;
        } catch (err) {
            io.emit('log', `ERROR: Failed to send to ${number}: ${err.message}`);
            campaign.report.push({ number, name, status: `Failed: ${err.message}` });
            campaign.failedThisCampaign++;
        } finally {
            campaign.currentIndex = i + 1;
            if (campaign.contactGroup) {
                updateContactProgress(campaign.contactGroup, campaign.currentIndex);
            }
            io.emit('campaignState', getCampaignState());
        }
        
        const delay = Math.floor(Math.random() * (campaign.maxDelay - campaign.minDelay + 1) + campaign.minDelay) * 1000;
        io.emit('log', `-> Waiting for ${delay / 1000} seconds before next message...`);
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    campaign.currentBatchIndex++;
    if (campaign.currentIndex >= campaign.contacts.length) {
        io.emit('log', 'Campaign finished!');
        campaign.isRunning = false;
        saveReport();
        updateStats(campaign.sentThisCampaign);
        io.emit('campaignState', getCampaignState());
    } else {
        if (campaign.simulateReading) await simulateReadingActivity(io);
        io.emit('log', `Batch #${campaign.currentBatchIndex} complete. Waiting for user to start next batch.`);
        io.emit('batchComplete', { nextBatch: campaign.currentBatchIndex + 1 });
    }
}

function updateContactProgress(groupName, index) {
    const progressPath = path.join(__dirname, 'data', 'contact_progress.json');
    const progressData = JSON.parse(fs.readFileSync(progressPath));
    progressData[groupName] = index;
    fs.writeFileSync(progressPath, JSON.stringify(progressData, null, 2));
}

async function simulateReadingActivity(io) {
    try {
        io.emit('log', 'SIMULATING: Pausing for idle activity...');
        await new Promise(resolve => setTimeout(resolve, Math.random() * 10000 + 5000));
        const chats = await client.getChats();
        if (chats.length > 0) {
            const randomChat = chats[Math.floor(Math.random() * Math.min(chats.length, 10))];
            io.emit('log', `SIMULATING: Opening chat with "${randomChat.name}" to look human...`);
            await randomChat.sendStateTyping();
            await new Promise(resolve => setTimeout(resolve, 2000));
            await randomChat.clearState();
        }
    } catch (e) {
        io.emit('log', 'Could not simulate reading activity.');
    }
}

function updateStats(sentCount) {
    const statsPath = path.join(__dirname, 'data', 'stats.json');
    let stats = { totalSent: 0, daily: [] };
    if (fs.existsSync(statsPath)) {
        stats = JSON.parse(fs.readFileSync(statsPath));
    }
    const today = new Date().toISOString().split('T')[0];

    stats.totalSent = (stats.totalSent || 0) + sentCount;
    stats.daily = stats.daily || [];
    
    const todayEntry = stats.daily.find(d => d.date === today);
    if (todayEntry) {
        todayEntry.sent += sentCount;
    } else {
        stats.daily.push({ date: today, sent: sentCount });
    }

    fs.writeFileSync(statsPath, JSON.stringify(stats));
    io.emit('statsUpdated');
}

function sendNextBatch(io) {
    if (campaign.isRunning) sendBatch(io);
}

function saveReport() {
    if (!campaign.reportName || campaign.report.length === 0) return;
    io.emit('log', `SAVING REPORT: ${campaign.reportName} with ${campaign.report.length} entries.`);
    const reportPath = path.join(__dirname, 'data', campaign.reportName);
    const headers = 'number,name,status\n';
    
    // CORRECTED: More robust logic to append or create the report file.
    const fileExists = fs.existsSync(reportPath);
    const writeStream = fs.createWriteStream(reportPath, { flags: 'a' }); // Always append

    if (!fileExists) {
        writeStream.write(headers); // Write headers only if the file is new
    }

    const csvContent = campaign.report.map(r => `${r.number},${r.name || ''},"${r.status}"`).join('\n');
    writeStream.write(csvContent + '\n');
    writeStream.end();

    console.log(`Report data saved to ${reportPath}`);
}

module.exports = { initializeWhatsAppClient, startNewCampaign, sendNextBatch, pauseCampaign, resumeCampaign, endCampaign, getCampaignState, parseContacts };
