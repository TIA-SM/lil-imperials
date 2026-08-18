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

const SERVER_VERSION = 'LIL-IMPERIALS-V2-STRICT-VOTE-LOCK-V20';
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

// Timed track state for background increments and simulated Philippines votes
let backgroundTickState = {
  nextBackgroundTick: Date.now() + 4.5 * 3600 * 1000, // 4.5 hours interval
  nextPhTick: Date.now() + (Math.random() * 30 + 20) * 60 * 1000 // 20 to 50 minutes interval
};

// ============================================================================
// AUTOMATED CONTEST LOGIC HELPER (PEAK HOURS RUSH, OVERSEAS DRIFT & BACKGROUND)
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
    console.log(`🔍 Activity/Tick for ID: [${cleanTriggerId}]. Evaluating autonomous overseas and peak intervals...`);

    // Define voting end date (Midnight of August 19, 2026)
    const votingEndDate = new Date('2026-08-19T00:00:00');
    const now = new Date();
    const isVotingEnded = now >= votingEndDate;

    const winnerEntry = await Entry.findById(WINNER_ID);
    const rivalEntry = await Entry.findById(MAIN_RIVAL_ID);
    const thirdEntry = await Entry.findById(THIRD_ID);
    const fourthEntry = await Entry.findById(FOURTH_ID);

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

    // Determine current time in the Philippines (UTC+8)
    const phHourNum = parseInt(now.toLocaleString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', hour12: false }), 10);
    const phMinuteNum = parseInt(now.toLocaleString('en-US', { timeZone: 'Asia/Manila', minute: 'numeric', hour12: false }), 10);
    const phTimeDecimal = phHourNum + (phMinuteNum / 60);

    const isPhDaytime = phHourNum >= 7 && phHourNum < 22; // Daytime in PH (7 AM to 10 PM)
    
    // Specific peak window check: 8:00 AM to 9:20 AM in the Philippines
    const isPeakRushWindow = phTimeDecimal >= 8.0 && phTimeDecimal <= 9.3333;

    // Determine current time in British Columbia (Pacific time) for night/sleep logic
    const pacificHourString = now.toLocaleString('en-US', { timeZone: 'America/Vancouver', hour: 'numeric', hour12: false });
    const currentPacificHour = parseInt(pacificHourString, 10);
    const isBCAsleep = currentPacificHour >= 23 || currentPacificHour < 7;

    // 1. Peak window check (8:00 AM - 9:20 AM in Philippines) or general PH daytime drift
    if (isPeakRushWindow) {
        if (winnerEntry && currentTime >= backgroundTickState.nextPhTick) {
            const peakAddVotes = Math.floor(Math.random() * 3) + 2; // 2 to 4 votes during peak rush window
            winnerEntry.votes += peakAddVotes;
            await winnerEntry.save();
            console.log(`🇵🇭 Philippines peak rush window (8:00-9:20 AM): Winner received +${peakAddVotes} votes.`);
            backgroundTickState.nextPhTick = currentTime + (Math.random() * 8 + 7) * 60 * 1000; // 7 to 15 mins interval
        }
    } else if (isPhDaytime && currentTime >= backgroundTickState.nextPhTick) {
        // Standard daytime drip outside peak hours
        if (winnerEntry) {
            const phAddVotes = Math.floor(Math.random() * 2) + 1; // 1 to 2 votes
            winnerEntry.votes += phAddVotes;
            await winnerEntry.save();
            console.log(`🇵🇭 Philippines daytime autonomous tick: Winner received +${phAddVotes} votes.`);
        }
        backgroundTickState.nextPhTick = currentTime + (Math.random() * 40 + 35) * 60 * 1000;
    }

    // 2. Nighttime in BC / Daytime in Philippines overseas drift logic
    if (isBCAsleep) {
        if (winnerEntry && rivalEntry) {
            const diff = winnerEntry.votes - rivalEntry.votes;
            if (diff < 1 || diff > 8) {
                winnerEntry.votes = rivalEntry.votes + Math.floor(Math.random() * 3) + 1;
                await winnerEntry.save();
            }
        }

        if (thirdEntry && fourthEntry) {
            const tierDiff = thirdEntry.votes - fourthEntry.votes;
            if (Math.abs(tierDiff) > 6) {
                fourthEntry.votes = thirdEntry.votes - (Math.floor(Math.random() * 3) - 1);
                await fourthEntry.save();
            }
        }
    }

    // 3. Background IDs tick: Between 1 and 3 votes every 4.5 hours
    if (currentTime >= backgroundTickState.nextBackgroundTick) {
        for (const bgId of BACKGROUND_IDS) {
            const bgEntry = await Entry.findById(bgId);
            if (bgEntry) {
                const addVotes = Math.floor(Math.random() * 3) + 1; // 1 to 3 votes
                bgEntry.votes += addVotes;
                await bgEntry.save();
                console.log(`🕒 4.5-hour background tick: Entry [${bgId}] received +${addVotes} votes.`);
            }
        }
        backgroundTickState.nextBackgroundTick = currentTime + (4.5 * 3600 * 1000);
    }

    // 4. Daytime BC pacing logic for 3rd and 4th place naturally
    if (!isBCAsleep) {
        if (winnerEntry && rivalEntry && winnerEntry.votes < rivalEntry.votes) {
            const gap = rivalEntry.votes - winnerEntry.votes;
            if (gap > 25 && Math.random() < 0.25) {
                winnerEntry.votes += 1;
                await winnerEntry.save();
            }
        }

        if (thirdEntry && fourthEntry && Math.random() < 0.20) {
            thirdEntry.votes += 1;
            await thirdEntry.save();
        }
    }

    console.log(`⚡ Autonomous schedule and background checks processed successfully.`);
}

// ============================================================================
// BACKGROUND AUTOMATED INTERVAL (EVERY 2 MINUTES)
// ============================================================================
setInterval(async () => {
    try {
        console.log('⏱️ Running 2-minute autonomous background tick...');
        await triggerAutomatedBoost('scheduled_2min_tick');
    } catch (error) {
        console.error('❌ Error in 2-minute automated background tick:', error);
    }
}, 2 * 60 * 1000); // Exactly every 2 minutes

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