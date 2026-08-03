require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const { google } = require('googleapis');
const fs = require('fs');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());
app.use(cors());

// Define version identifier to guarantee tracking of live deployments
const SERVER_VERSION = 'LIL-IMPERIALS-V2-STRICT-VOTE-LOCK';
console.log(`🚀 STARTING SERVER - VERSION: ${SERVER_VERSION}`);

// IMPORTANT: Trust proxy so Render / reverse proxies correctly pass client IP addresses
app.set('trust proxy', true);

// 1. Connect to MongoDB Atlas
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => console.error('❌ Database connection error:', err));

// Database Schemas
const EntrySchema = new mongoose.Schema({
  childName: String,
  parentEmail: String,
  province: String,
  recipeTitle: String,
  recipeDescription: String,
  youtubeUrl: String,
  status: { type: String, default: 'Pending' },
  votes: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

// Updated VoteLog Schema: Tracks per device/IP globally across the contest to prevent multi-voting
const VoteLogSchema = new mongoose.Schema({
  identifier: { type: String, required: true, unique: true }, // Unique device/IP signature for the whole contest
  createdAt: { type: Date, default: Date.now, expires: '30d' }
});

const Entry = mongoose.model('Entry', EntrySchema);
const VoteLog = mongoose.model('VoteLog', VoteLogSchema);

// Ensure index builds correctly on startup
VoteLog.init().catch(err => console.error("Index creation error:", err));

// Configure Nodemailer explicitly with secure port settings
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.NOTIFY_EMAIL || 'theimperialapron@gmail.com',
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

// Helper Function: Send Email Notification to Admin
async function sendAdminNotification(entry) {
  const mailOptions = {
    from: `"Lil' Imperials Contest" <${process.env.NOTIFY_EMAIL || 'theimperialapron@gmail.com'}>`,
    to: 'theimperialapron@gmail.com',
    subject: `🚀 New Entry Submission: ${entry.recipeTitle}`,
    html: `
      <h2>New Contest Entry Received!</h2>
      <p><strong>Child Chef Name & Age:</strong> ${entry.childName}</p>
      <p><strong>Parent/Guardian Email:</strong> ${entry.parentEmail}</p>
      <p><strong>Province/Territory:</strong> ${entry.province}</p>
      <p><strong>Recipe Title:</strong> ${entry.recipeTitle}</p>
      <p><strong>Description:</strong> ${entry.recipeDescription}</p>
      <p><strong>YouTube Video Embed URL:</strong> <a href="${entry.youtubeUrl}">${entry.youtubeUrl}</a></p>
      <hr>
      <p><em>Please log in to your dashboard to review and set status to 'Approved' to publish to the gallery.</em></p>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Admin notification email sent successfully:', info.response);
  } catch (err) {
    console.error('❌ CRITICAL: Failed to send admin notification email:', err);
  }
}

// Ensure temporary uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ dest: uploadDir });

// 2. YouTube OAuth2 Setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.REDIRECT_URI
);

if (process.env.YOUTUBE_REFRESH_TOKEN) {
  oauth2Client.setCredentials({
    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN
  });
  console.log('✅ YouTube OAuth credentials loaded from environment variables.');
}

// ============================================================================
// ROUTES SECTION (API & ADMIN ROUTES MUST BE DEFINED FIRST)
// ============================================================================

// Version Check Route: Visit https://your-app.onrender.com/api/version to confirm active deployment
app.get('/api/version', (req, res) => {
  res.json({ success: true, version: SERVER_VERSION, message: 'Running latest strict anti-cheat vote server.' });
});

app.get('/admin/auth', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.upload'],
    prompt: 'consent'
  });
  res.redirect(authUrl);
});

app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    console.log('🔑 YOUR REFRESH TOKEN IS:', tokens.refresh_token);
    res.send('<h1>YouTube Authentication Successful!</h1><p>Check your Render logs to copy the refresh token.</p>');
  } catch (error) {
    console.error('Error retrieving access token', error);
    res.status(500).send('Authentication failed');
  }
});

// API Route: Form Submission & Video Upload
app.post('/api/submit', upload.single('video'), async (req, res) => {
  try {
    const { childName, parentEmail, province, recipeTitle, recipeDescription } = req.body;
    const videoFile = req.file;

    if (!videoFile) return res.status(400).json({ error: 'No video uploaded.' });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const ytResponse = await youtube.videos.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title: `Lil' Imperials Entry: ${recipeTitle} by ${childName}`,
          description: recipeDescription,
        },
        status: {
          privacyStatus: 'unlisted',
        },
      },
      media: {
        body: fs.createReadStream(videoFile.path),
      },
    });

    if (fs.existsSync(videoFile.path)) {
      fs.unlinkSync(videoFile.path);
    }

    const videoId = ytResponse.data.id;
    const youtubeUrl = `https://www.youtube.com/embed/${videoId}`;

    const newEntry = new Entry({
      childName,
      parentEmail,
      province,
      recipeTitle,
      recipeDescription,
      youtubeUrl,
      status: 'Pending'
    });

    await newEntry.save();
    await sendAdminNotification(newEntry);

    res.json({ success: true, message: 'Submission received! Pending admin review.' });

  } catch (error) {
    console.error('Upload Error:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Failed to process video submission.' });
  }
});

app.get('/api/entries', async (req, res) => {
  try {
    const entries = await Entry.find({ status: 'Approved' }).sort({ createdAt: -1 });
    res.json(entries);
  } catch (error) {
    res.status(500).json({ error: 'Could not fetch entries.' });
  }
});

// ADMIN API Route: Manually add custom votes to a preferred winner entry
app.post('/api/admin/boost/:id', async (req, res) => {
  const entryId = req.params.id;
  const { secretKey, voteAmount } = req.body;

  if (!process.env.ADMIN_SECRET || secretKey !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized. Invalid admin secret key.' });
  }

  const addVotes = parseInt(voteAmount, 10) || 1;

  try {
    const updatedEntry = await Entry.findByIdAndUpdate(
      entryId, 
      { $inc: { votes: addVotes } }, 
      { new: true }
    );

    if (!updatedEntry) {
      return res.status(404).json({ success: false, error: 'Entry not found.' });
    }

    console.log(`⚡ Admin boosted entry "${updatedEntry.recipeTitle}" by +${addVotes} votes. New total: ${updatedEntry.votes}`);
    res.json({ success: true, votes: updatedEntry.votes, message: `Successfully added ${addVotes} votes!` });
  } catch (error) {
    console.error('Boost error:', error);
    res.status(500).json({ success: false, error: 'Failed to add votes.' });
  }
});

// API Route: Standard Voting (Global strict lock: 1 vote per device/IP for the entire contest)
app.post('/api/vote/:id', async (req, res) => {
  const entryId = req.params.id;
  
  let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (clientIp && clientIp.includes(',')) {
    clientIp = clientIp.split(',')[0].trim();
  }
  if (clientIp.startsWith('::ffff:')) {
    clientIp = clientIp.substring(7);
  }

  const browserToken = req.body.voterToken || '';
  const uniqueVoterIdentifier = browserToken ? `${clientIp}_${browserToken}` : clientIp;

  try {
    const existingVote = await VoteLog.findOne({ identifier: uniqueVoterIdentifier });
    if (existingVote) {
      return res.status(400).json({ success: false, error: 'You have already cast your single vote for this contest from this device.' });
    }

    await VoteLog.create({ identifier: uniqueVoterIdentifier });
    const updatedEntry = await Entry.findByIdAndUpdate(entryId, { $inc: { votes: 1 } }, { new: true });

    if (!updatedEntry) {
      return res.status(404).json({ success: false, error: 'Entry not found.' });
    }

    res.json({ success: true, votes: updatedEntry.votes });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, error: 'You have already cast your single vote for this contest from this device.' });
    }
    console.error('Voting error:', error);
    res.status(500).json({ success: false, error: 'Voting failed due to server error.' });
  }
});


// ============================================================================
// STATIC FILES & SPA FALLBACK (MUST BE PLACED AFTER ALL API ROUTES)
// ============================================================================

app.use(express.static(path.join(__dirname, 'public')));

// Dynamic Social Preview & SPA Catch-All Route
app.get(/.*/, async (req, res) => {
  const entryId = req.query.entry;
  const filePath = path.join(__dirname, 'public', 'index.html');

  if (entryId && mongoose.Types.ObjectId.isValid(entryId)) {
    try {
      const entry = await Entry.findById(entryId);
      if (entry) {
        let html = fs.readFileSync(filePath, 'utf8');
        
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = entry.youtubeUrl ? entry.youtubeUrl.match(regExp) : null;
        const videoId = (match && match[2].length === 11) ? match[2] : null;
        const thumbnailUrl = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : 'https://theimperialapron.ca/images/events/lil-imperials.webp';

        const safeTitle = `Vote for Chef ${entry.childName}: ${entry.recipeTitle}`;
        const safeDesc = `${entry.recipeDescription} - Click to watch and cast your vote in the Lil' Imperials Challenge!`;

        html = html.replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${safeTitle}">`);
        html = html.replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${safeDesc}">`);
        html = html.replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${thumbnailUrl}">`);
        html = html.replace(/<title>[^<]*<\/title>/, `<title>${safeTitle} | Lil' Imperials Contest</title>`);

        return res.send(html);
      }
    } catch (err) {
      console.error('Error generating dynamic meta tags:', err);
    }
  }

  res.sendFile(filePath);
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));