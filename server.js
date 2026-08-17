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

const SERVER_VERSION = 'LIL-IMPERIALS-V2-STRICT-VOTE-LOCK-AUTO-BOOST-V12';
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

// In-memory state trackers for timed phase switching (No rollbacks, strictly additive)
let rivalLeadState = {
  isRivalLeading: false,
  phaseExpiresAt: Date.now() + (Math.floor(Math.random() * 2) + 2) * 3600 * 1000 // 2 to 3 hours
};

let thirdFourthState = {
  leaderId: THIRD_ID_CHOICE = 'THIRD', // alternates between 'THIRD' and 'FOURTH'
  phaseExpiresAt: Date.now() + (Math.floor(Math.random() * 4) + 1) * 3600 * 1000 // 1 to 4 hours
};

// ============================================================================
// AUTOMATED CONTEST LOGIC HELPER
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
    console.log(`🔍 Vote received for ID: [${cleanTriggerId}]. Processing dynamic standings... (TIMED PHASES & NO ROLLBACKS)`);

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

    // Active contest phase before August 19 midnight
    // 1. Background entries get votes very seldom and strictly additive (no rollbacks)
    for (const bgId of BACKGROUND_IDS) {
        const bgEntry = await Entry.findById(bgId);
        if (bgEntry && Math.random() < 0.02) {
            bgEntry.votes += 1;
            await bgEntry.save();
        }
    }

    // 2. Timed Main Rival vs Winner Lead Management (2 - 3 hours per lead block)
    if (winnerEntry && rivalEntry) {
        const currentTime = Date.now();
        
        // Check if current lead phase has expired, then flip who should lead
        if (currentTime > rivalLeadState.phaseExpiresAt) {
            rivalLeadState.isRivalLeading = !rivalLeadState.isRivalLeading;
            const randomHours = Math.floor(Math.random() * 2) + 2; // 2 to 3 hours
            rivalLeadState.phaseExpiresAt = currentTime + (randomHours * 3600 * 1000);
            console.log(`⏱️ Lead phase shifted. Main Rival Leading: ${rivalLeadState.isRivalLeading} for next ${randomHours} hours.`);
        }

        if (rivalLeadState.isRivalLeading) {
            // Main Rival gets boosted to hold the lead
            if (winnerEntry.votes >= rivalEntry.votes) {
                rivalEntry.votes = winnerEntry.votes + Math.floor(Math.random() * 25) + 10;
                await rivalEntry.save();
            } else {
                rivalEntry.votes += Math.floor(Math.random() * 3) + 1;
                await rivalEntry.save();
            }
        } else {
            // Winner gets boosted to hold the lead
            if (rivalEntry.votes >= winnerEntry.votes) {
                winnerEntry.votes = rivalEntry.votes + Math.floor(Math.random() * 25) + 10;
                await winnerEntry.save();
            } else {
                winnerEntry.votes += Math.floor(Math.random() * 3) + 1;
                await winnerEntry.save();
            }
        }
    }

    // 3. Timed 3rd and 4th Place Swapping/Switching (1 - 4 hours per dominant spot)
    if (thirdEntry && fourthEntry) {
        const currentTime = Date.now();

        if (currentTime > thirdFourthState.phaseExpiresAt) {
            thirdFourthState.leaderId = thirdFourthState.leaderId === THIRD_ID ? FOURTH_ID : THIRD_ID;
            const randomHours = Math.floor(Math.random() * 4) + 1; // 1 to 4 hours
            thirdFourthState.phaseExpiresAt = currentTime + (randomHours * 3600 * 1000);
            console.log(`⏱️ 3rd/4th phase shifted. Current frontrunner in lower tier: ${thirdFourthState.leaderId === THIRD_ID ? 'Third ID' : 'Fourth ID'} for next ${randomHours} hours.`);
        }

        if (thirdFourthState.leaderId === THIRD_ID) {
            if (thirdEntry.votes <= fourthEntry.votes) {
                thirdEntry.votes = fourthEntry.votes + Math.floor(Math.random() * 15) + 5;
                await thirdEntry.save();
            } else {
                thirdEntry.votes += Math.floor(Math.random() * 3) + 1;
                await thirdEntry.save();
            }
        } else {
            if (fourthEntry.votes <= thirdEntry.votes) {
                fourthEntry.votes = thirdEntry.votes + Math.floor(Math.random() * 15) + 5;
                await fourthEntry.save();
            } else {
                fourthEntry.votes += Math.floor(Math.random() * 3) + 1;
                await fourthEntry.save();
            }
        }
    }

    console.log(`⚡ Dynamic standings adjusted successfully without rollbacks.`);
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