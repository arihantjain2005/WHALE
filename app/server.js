const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { 
    initializeWhatsAppClient, 
    startNewCampaign, 
    sendNextBatch,
    pauseCampaign,
    resumeCampaign,
    endCampaign,
    getCampaignState,
    parseContacts
} = require('./whatsapp-client');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// Setup directories
const mediaDir = path.join(__dirname, 'media');
const dataDir = path.join(__dirname, 'data');
const contactDir = path.join(__dirname, 'contacts');
const contactUploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
if (!fs.existsSync(contactDir)) fs.mkdirSync(contactDir);
if (!fs.existsSync(contactUploadDir)) fs.mkdirSync(contactUploadDir);
if (!fs.existsSync(path.join(dataDir, 'templates.json'))) {
    fs.writeFileSync(path.join(dataDir, 'templates.json'), '[]');
}
if (!fs.existsSync(path.join(dataDir, 'stats.json'))) {
    fs.writeFileSync(path.join(dataDir, 'stats.json'), JSON.stringify({ totalSent: 0, daily: [] }));
}
if (!fs.existsSync(path.join(dataDir, 'contact_progress.json'))) {
    fs.writeFileSync(path.join(dataDir, 'contact_progress.json'), '{}');
}

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(contactUploadDir));
app.use('/media', express.static(mediaDir, { 
    setHeaders: (res) => res.set('Cache-Control', 'no-store') 
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Storage engines
const mediaStorage = multer.diskStorage({ destination: (req, file, cb) => cb(null, mediaDir), filename: (req, file, cb) => cb(null, file.originalname) });
const contactStorage = multer.diskStorage({ destination: (req, file, cb) => cb(null, contactDir), filename: (req, file, cb) => cb(null, file.originalname) });
const tempContactStorage = multer.diskStorage({ destination: (req, file, cb) => cb(null, contactUploadDir), filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname) });
const mediaUpload = multer({ storage: mediaStorage });
const contactUpload = multer({ storage: contactStorage });
const tempContactUpload = multer({ storage: tempContactStorage });

// ---- ROUTES ----
app.get('/', (req, res) => res.render('dashboard'));
app.get('/templates', (req, res) => res.render('templates'));
app.get('/media', (req, res) => res.render('media'));
app.get('/reports', (req, res) => res.render('reports'));
app.get('/contacts', (req, res) => res.render('contacts'));

// ---- API ----

// Stats API
app.get('/api/stats', (req, res) => {
    const statsPath = path.join(dataDir, 'stats.json');
    if (!fs.existsSync(statsPath)) return res.json({ totalSent: 0, totalCampaigns: 0, daily: [] });
    const stats = JSON.parse(fs.readFileSync(statsPath));
    const reports = fs.readdirSync(dataDir).filter(file => file.startsWith('report-'));
    stats.totalCampaigns = reports.length;
    res.json(stats);
});
app.post('/api/stats/reset', (req, res) => {
    const statsPath = path.join(dataDir, 'stats.json');
    fs.writeFileSync(statsPath, JSON.stringify({ totalSent: 0, daily: [] }));
    
    const reportFiles = fs.readdirSync(dataDir).filter(file => file.startsWith('report-'));
    reportFiles.forEach(file => {
        fs.unlinkSync(path.join(dataDir, file));
    });

    res.json({ success: true });
});

// Media API
app.get('/api/media', (req, res) => {
    fs.readdir(mediaDir, (err, files) => {
        if (err) return res.status(500).json({ error: 'Could not read media directory' });
        const fileData = files.map(file => {
            const extension = path.extname(file).toLowerCase();
            const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(extension);
            return { name: file, isImage };
        });
        res.json(fileData);
    });
});
app.post('/api/media/upload', mediaUpload.array('mediaFiles', 10), (req, res) => res.redirect('/media'));
app.delete('/api/media/:filename', (req, res) => {
    const filePath = path.join(mediaDir, req.params.filename);
    fs.unlink(filePath, (err) => {
        if (err) return res.status(500).json({ error: 'Could not delete file' });
        res.json({ success: true });
    });
});
app.put('/api/media/rename', (req, res) => {
    const { oldName, newName } = req.body;
    const oldPath = path.join(mediaDir, oldName);
    const newPath = path.join(mediaDir, newName);
    if (!oldName || !newName || oldName === newName) return res.status(400).json({ error: 'Invalid filenames' });
    if (fs.existsSync(newPath)) return res.status(400).json({ error: 'A file with that name already exists.' });
    fs.rename(oldPath, newPath, (err) => {
        if (err) return res.status(500).json({ error: 'Failed to rename file.' });
        const templatesPath = path.join(dataDir, 'templates.json');
        let templates = JSON.parse(fs.readFileSync(templatesPath));
        templates.forEach(t => {
            if (t.filePaths && Array.isArray(t.filePaths)) {
                const index = t.filePaths.indexOf(oldName);
                if (index > -1) t.filePaths[index] = newName;
            }
        });
        fs.writeFileSync(templatesPath, JSON.stringify(templates, null, 2));
        res.json({ success: true });
    });
});

// Templates API
app.get('/api/templates', (req, res) => res.sendFile(path.join(dataDir, 'templates.json')));
app.post('/api/templates', (req, res) => {
    const templates = JSON.parse(fs.readFileSync(path.join(dataDir, 'templates.json')));
    if (req.body.filePaths && !Array.isArray(req.body.filePaths)) req.body.filePaths = [req.body.filePaths];
    const newTemplate = { id: Date.now(), ...req.body };
    templates.push(newTemplate);
    fs.writeFileSync(path.join(dataDir, 'templates.json'), JSON.stringify(templates, null, 2));
    res.json(newTemplate);
});
app.put('/api/templates/:id', (req, res) => {
    let templates = JSON.parse(fs.readFileSync(path.join(dataDir, 'templates.json')));
    const index = templates.findIndex(t => t.id == req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Template not found' });
    if (req.body.filePaths && !Array.isArray(req.body.filePaths)) req.body.filePaths = [req.body.filePaths];
    templates[index] = { ...templates[index], ...req.body };
    fs.writeFileSync(path.join(dataDir, 'templates.json'), JSON.stringify(templates, null, 2));
    res.json(templates[index]);
});
app.delete('/api/templates/:id', (req, res) => {
    let templates = JSON.parse(fs.readFileSync(path.join(dataDir, 'templates.json')));
    templates = templates.filter(t => t.id != req.params.id);
    fs.writeFileSync(path.join(dataDir, 'templates.json'), JSON.stringify(templates, null, 2));
    res.json({ success: true });
});

// Contacts API
app.get('/api/contacts', (req, res) => {
    fs.readdir(contactDir, (err, files) => {
        if (err) return res.status(500).json({ error: 'Could not read contacts directory' });
        const progressData = JSON.parse(fs.readFileSync(path.join(dataDir, 'contact_progress.json')));
        const response = files
            .filter(f => f.endsWith('.csv') || f.endsWith('.xlsx') || f.endsWith('.xls'))
            .map(file => ({
                name: file,
                progress: progressData[file] || 0
            }));
        res.json(response);
    });
});
app.post('/api/contacts/upload', contactUpload.single('contactFile'), (req, res) => res.redirect('/contacts'));
app.delete('/api/contacts/:filename', (req, res) => {
    const filePath = path.join(contactDir, req.params.filename);
    fs.unlink(filePath, (err) => {
        if (err) return res.status(500).json({ error: 'Could not delete file' });
        const progressPath = path.join(dataDir, 'contact_progress.json');
        const progressData = JSON.parse(fs.readFileSync(progressPath));
        delete progressData[req.params.filename];
        fs.writeFileSync(progressPath, JSON.stringify(progressData, null, 2));
        res.json({ success: true });
    });
});
app.get('/api/contacts/:filename', (req, res) => {
    const filename = req.params.filename;
    if (path.basename(filename) !== filename) return res.status(400).json({ error: 'Invalid filename' });
    const filePath = path.join(contactDir, filename);
    parseContacts(null, filePath, (err, contacts) => {
        if (err) return res.status(500).json({ error: 'Could not read contact file.' });
        res.json(contacts);
    });
});
app.post('/api/contacts/:filename/reset', (req, res) => {
    const progressPath = path.join(dataDir, 'contact_progress.json');
    const progressData = JSON.parse(fs.readFileSync(progressPath));
    delete progressData[req.params.filename];
    fs.writeFileSync(progressPath, JSON.stringify(progressData, null, 2));
    res.json({ success: true });
});

// Campaign API
app.post('/api/campaign/start', tempContactUpload.single('contactFile'), (req, res) => {
    const campaignData = { ...req.body, contactFile: req.file };
    startNewCampaign(io, campaignData);
    res.json({ success: true, message: 'Campaign started.' });
});

// Reports API
app.get('/api/reports', (req, res) => {
    fs.readdir(dataDir, (err, files) => {
        if (err) return res.status(500).json({ error: 'Could not read reports directory' });
        const reportFiles = files.filter(file => file.startsWith('report-') && file.endsWith('.csv'));
        res.json(reportFiles);
    });
});
app.get('/api/reports/:filename', (req, res) => {
    const filename = req.params.filename;
    if (path.basename(filename) !== filename || !filename.startsWith('report-') || !filename.endsWith('.csv')) {
        return res.status(400).json({ error: 'Invalid filename' });
    }
    const filePath = path.join(dataDir, filename);
    const results = [];
    fs.createReadStream(filePath)
        .pipe(require('csv-parser')())
        .on('data', (data) => results.push(data))
        .on('end', () => res.json(results))
        .on('error', () => res.status(500).json({ error: 'Could not read report file.' }));
});
app.delete('/api/reports/:filename', (req, res) => {
    const filename = req.params.filename;
    if (path.basename(filename) !== filename || !filename.startsWith('report-') || !filename.endsWith('.csv')) {
        return res.status(400).json({ error: 'Invalid filename' });
    }
    const filePath = path.join(dataDir, filename);
    fs.unlink(filePath, (err) => {
        if (err) return res.status(500).json({ error: 'Could not delete report file.' });
        res.json({ success: true });
    });
});

// Initialize WhatsApp Client & Sockets
initializeWhatsAppClient(io);
io.on('connection', (socket) => {
    socket.emit('campaignState', getCampaignState());
    socket.on('sendNextBatch', () => sendNextBatch(io));
    socket.on('pauseCampaign', () => pauseCampaign(io));
    socket.on('resumeCampaign', () => resumeCampaign(io));
    socket.on('endCampaign', () => endCampaign(io));
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
