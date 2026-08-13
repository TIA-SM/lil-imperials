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

const SERVER_VERSION = 'LIL-IMPERIALS-V2-STRICT-VOTE-LOCK-AUTO-BOOST-QQQ';
console.log(`🚀 STARTING SERVER - VERSION: ${SERVER_VERSION}`);

app.set('trust proxy', true);

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => console.error('❌ Database connection error:', err));

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
  identifier: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now, expires: '30d' }
});

const Entry = mongoose.model('Entry', EntrySchema);
const VoteLog = mongoose.model('VoteLog', VoteLogSchema);

// ============================================================================
// AUTOMATED CONTEST LOGIC HELPER
// ============================================================================
async function triggerAutomatedBoost(triggeredEntryId) {
    const WATCHED_IDS = [
        '6a69441bdd8261c6e326b3eb', 
        '6a76b16b33ceb77b5cd9e846'
    ].map(id => id.toString().trim());

    const WINNER_ID = '6a70cb2b5f6203c02fd2e778';
    const cleanTriggerId = triggeredEntryId.toString().trim();

    console.log(`🔍 Vote received for ID: [${cleanTriggerId}]. Checking watched list...`);

    if (WATCHED_IDS.includes(cleanTriggerId)) {
        console.log(`🎯 Matched a watched entry! Applying random boost to others...`);
        
        // Use $nin with both string and ObjectID evaluation safely by mapping or querying properly
        const otherEntries = await Entry.find({ 
            _id: { $nin: WATCHED_IDS } 
        });
        
        for (let entry of otherEntries) {
            const randomBoost = Math.floor(Math.random() * (349 - 138 + 1)) + 138;
            entry.votes += randomBoost;
            
            // Ensure winner stays ahead
            if (entry._id.toString() === WINNER_ID) {
                entry.votes += 500; 
            }
            await entry.save();
        }
        console.log(`⚡ Automated boost successfully applied to other entries.`);
    } else {
        console.log(`ℹ️ Entry [${cleanTriggerId}] is not in the watched list.`);
    }
}

// ============================================================================
// ROUTES
// ============================================================================

app.post('/api/vote/:id', async (req, res) => {
  const entryId = req.params.id;
  
  let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (clientIp && clientIp.includes(',')) clientIp = clientIp.split(',')[0].trim();
  if (clientIp.startsWith('::ffff:')) clientIp = clientIp.substring(7);

  const browserToken = req.body.voterToken || '';
  const uniqueVoterIdentifier = browserToken ? `${clientIp}_${browserToken}` : clientIp;

  try {
    const existingVote = await VoteLog.findOne({ identifier: uniqueVoterIdentifier });
    if (existingVote) {
      return res.status(400).json({ success: false, error: 'You have already cast your single vote.' });
    }

    await VoteLog.create({ identifier: uniqueVoterIdentifier });
    const updatedEntry = await Entry.findByIdAndUpdate(entryId, { $inc: { votes: 1 } }, { new: true });

    if (!updatedEntry) return res.status(404).json({ success: false, error: 'Entry not found.' });

    // Trigger the background logic
    await triggerAutomatedBoost(entryId);

    res.json({ success: true, votes: updatedEntry.votes });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ success: false, error: 'Already voted.' });
    res.status(500).json({ success: false, error: 'Voting failed.' });
  }
});

// ... (KEEP ALL YOUR EXISTING ROUTES: /api/submit, /api/entries, /admin/boost, etc., below here)

app.use(express.static(path.join(__dirname, 'public')));
app.get(/.*/, async (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));