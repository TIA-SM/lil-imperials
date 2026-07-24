require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const { google } = require('googleapis');
const fs = require('fs');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

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

const VoteLogSchema = new mongoose.Schema({
  entryId: mongoose.Schema.Types.ObjectId,
  ipAddress: String
});

const Entry = mongoose.model('Entry', EntrySchema);
const VoteLog = mongoose.model('VoteLog', VoteLogSchema);

// Multer setup for temp uploads
const upload = multer({ dest: 'uploads/' });

// 2. YouTube OAuth2 Setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// Admin Auth Route - Visit once to grant YouTube permissions
app.get('/admin/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/youtube.upload']
  });
  res.redirect(url);
});

// OAuth Callback Route
app.get('/oauth2callback', async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    
    console.log('✅ YouTube Authorized Successfully!');
    res.send('<h2>YouTube Authentication Successful!</h2><p>Your server can now accept video uploads to YouTube.</p>');
  } catch (err) {
    console.error('OAuth Callback Error:', err);
    res.status(500).send('Authentication failed.');
  }
});

// 3. API Route: Form Submission & Video Upload
app.post('/api/submit', upload.single('video'), async (req, res) => {
  try {
    const { childName, parentEmail, province, recipeTitle, recipeDescription } = req.body;
    const videoFile = req.file;

    if (!videoFile) return res.status(400).json({ error: 'No video uploaded.' });

    // Upload to YouTube as Unlisted
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

    // Clean up temporary local file
    fs.unlinkSync(videoFile.path);

    const videoId = ytResponse.data.id;
    const youtubeUrl = `https://www.youtube.com/embed/${videoId}`;

    // Save to MongoDB
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
    res.json({ success: true, message: 'Submission received! Pending admin review.' });

  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: 'Failed to process video submission.' });
  }
});

// 4. API Route: Fetch Approved Gallery Entries
app.get('/api/entries', async (req, res) => {
  try {
    const entries = await Entry.find({ status: 'Approved' }).sort({ createdAt: -1 });
    res.json(entries);
  } catch (error) {
    res.status(500).json({ error: 'Could not fetch entries.' });
  }
});

// 5. API Route: Secure Server-side Voting
app.post('/api/vote/:id', async (req, res) => {
  const entryId = req.params.id;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  try {
    const existingVote = await VoteLog.findOne({ entryId, ipAddress: clientIp });
    if (existingVote) {
      return res.status(400).json({ error: 'You have already voted for this entry from this network.' });
    }

    await VoteLog.create({ entryId, ipAddress: clientIp });
    const updatedEntry = await Entry.findByIdAndUpdate(entryId, { $inc: { votes: 1 } }, { new: true });

    res.json({ success: true, votes: updatedEntry.votes });
  } catch (error) {
    res.status(500).json({ error: 'Voting failed.' });
  }
});

// Start Server
const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));