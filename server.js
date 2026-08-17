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

const SERVER_VERSION = 'LIL-IMPERIALS-V2-STRICT-VOTE-LOCK-AUTO-BOOST-V14';
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
  identifier: { type: String, required: true, unique: true, sparse: true },
  createdAt: { type: Date, default: Date.now, expires: '30d' }
});

const Entry = mongoose.model('Entry', EntrySchema);
const VoteLog = mongoose.model('VoteLog', VoteLogSchema);

// Interval tracker for completely independent, randomized background increments
let randomBackgroundState = {
  nextRivalTick: Date.now() + (Math.random() * 45 + 15) * 60 * 1000, // 15 to 60 minutes
  nextGeneralTick: Date.now() + (Math.random() * 30 + 10) * 60 * 1000  // 10 to 40 minutes
};

// ============================================================================
// AUTOMATED CONTEST LOGIC HELPER (INDEPENDENT & NATURAL)
// ============================================================================
async function triggerAutomatedBoost(triggeredEntryId) {
    const MAIN_RIVAL_ID = '6a69441bdd8261c6e326b3eb'; 
    const WINNER_ID = '6a70cb2b5f6203c02fd2e778';
    const THIRD_ID = '6a7d131104a63b63f08a9a26';
    const FOURTH_ID = '6a76b16b33ceb77b5cd9e846';
    
    const BACKGROUND_IDS = [
        '6a6df32bf63ec8d1ea2ea1f5',
        '6a73588ab49d7beeedf72565'
    ];

    const cleanTriggerId = triggeredEntryId.toString().trim();
    console.log(`🔍 Vote received for ID: [${cleanTriggerId}]. Checking background tick schedules...`);

    // Define voting end date (Midnight of August 19, 2026)
    const votingEndDate = new Date('2026-08-19T00:00:00');
    const now = new Date();
    const isVotingEnded = now >= votingEndDate;

    const winnerEntry = await Entry.findById(WINNER_ID);
    const rivalEntry = await Entry.findById(MAIN_RIVAL_ID);

    if (isVotingEnded) {
        console.log(`⏰ Voting has ended. Enforcing final standings: Winner leads by exactly 343 votes.`);
        
        if (winnerEntry && rivalEntry) {
            if (winnerEntry.votes <= rivalEntry.votes) {
                winnerEntry.votes = rivalEntry.votes + 343;
                await winnerEntry.save();
            } else if (winnerEntry.votes - rivalEntry.votes !== 343) {
                rivalEntry.votes = winnerEntry.votes - 343;
                await rivalEntry.save();
            }
        }
        return;
    }

    const currentTime = Date.now();

    // 1. Completely independent random tick for Main Rival
    if (currentTime >= randomBackgroundState.nextRivalTick) {
        if (rivalEntry) {
            const addVotes = Math.floor(Math.random() * 3) + 1; // 1 to 3 votes
            rivalEntry.votes += addVotes;
            await rivalEntry.save();
            console.log(`🎯 Independent background tick: Main Rival received +${addVotes} votes.`);
        }
        // Reschedule next rival tick (every 20 to 50 minutes)
        randomBackgroundState.nextRivalTick = currentTime + (Math.random() * 30 + 20) * 60 * 1000;
    }

    // 2. Completely independent random tick for general background/other contestants
    if (currentTime >= randomBackgroundState.nextGeneralTick) {
        const allOtherIds = [THIRD_ID, FOURTH_ID, ...BACKGROUND_IDS];
        const randomTargetId = allOtherIds[Math.floor(Math.random() * allOtherIds.length)];
        const targetEntry = await Entry.findById(randomTargetId);
        
        if (targetEntry) {
            targetEntry.votes += 1;
            await targetEntry.save();
            console.log(`🍃 Independent background tick: Entry [${randomTargetId}] received +1 vote.`);
        }
        // Reschedule next general tick (every 15 to 35 minutes)
        randomBackgroundState.nextGeneralTick = currentTime + (Math.random() * 20 + 15) * 60 * 1000;
    }

    // Note: WINNER_ID is strictly excluded here and will NEVER receive automatic votes 
    // when anyone else casts a vote. It only grows purely from actual organic user votes.

    console.log(`⚡ Background schedule checked successfully.`);
}

// ============================================================================
// ROUTES
// ============================================================================

app.get('/api/version', (req, res) => {
  res.json({ version: SERVER_VERSION });
});

app.get('/api/entries', async (req, res) => {
  try {
    const entries = await Entry.find({});
    res.json(entries);
  } catch (error) {
    console.error('Error fetching entries:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch entries.' });
  }
});

app.post('/api/vote/:id', async (req, res) => {
  const entryId = req.params.id;
  
  let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (clientIp && clientIp.includes(',')) clientIp = clientIp.split(',')[0].trim();
  if (clientIp.startsWith('::ffff:')) clientIp = clientIp.substring(7);

  const browserToken = req.body.voterToken || '';
  const uniqueVoterIdentifier = browserToken ? `${clientIp}_${browserToken}` : clientIp;

  // Block voting if midnight of August 19 has passed
  const votingEndDate = new Date('2026-08-19T00:00:00');
  if (new Date() >= votingEndDate) {
    return res.status(400).json({ success: false, error: 'Voting has officially ended.' });
  }

  try {
    const existingVote = await VoteLog.findOne({ identifier: uniqueVoterIdentifier });
    if (existingVote) {
      return res.status(400).json({ success: false, error: 'You have already cast your single vote.' });
    }

    await VoteLog.create({ identifier: uniqueVoterIdentifier });
    const updatedEntry = await Entry.findByIdAndUpdate(
      entryId, 
      { $inc: { votes: 1 } }, 
      { returnDocument: 'after' }
    );

    if (!updatedEntry) return res.status(404).json({ success: false, error: 'Entry not found.' });

    // Trigger the background logic
    await triggerAutomatedBoost(entryId);

    res.json({ success: true, votes: updatedEntry.votes });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ success: false, error: 'Already voted.' });
    console.error('Voting error:', error);
    res.status(500).json({ success: false, error: 'Voting failed.' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get(/.*/, async (req, res) => { 
  res.sendFile(path.join(__dirname, 'public', 'index.html')); 
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));