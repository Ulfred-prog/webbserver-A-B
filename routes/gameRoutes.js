const express = require('express');
const db = require('../config/db');
const auth = require('../middleware/authMiddleware');

const router = express.Router();

// ─── Deck Utilities ───────────────────────────────────────────────────────────

function createDeck() {
    const suits = ['H', 'D', 'C', 'S'];
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    let deck = [];
    for (let suit of suits)
        for (let value of values)
            deck.push(value + suit);
    // Fisher-Yates shuffle
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// ─── Hand Evaluation ─────────────────────────────────────────────────────────

const RANK_ORDER = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const rankVal = (r) => RANK_ORDER.indexOf(r);

function parseCard(card) {
    const suit = card.slice(-1);
    const rank = card.slice(0, -1);
    return { rank, suit, val: rankVal(rank) };
}

function getCombinations(arr, k) {
    if (k === 0) return [[]];
    if (arr.length < k) return [];
    const [first, ...rest] = arr;
    const withFirst = getCombinations(rest, k - 1).map(c => [first, ...c]);
    const withoutFirst = getCombinations(rest, k);
    return [...withFirst, ...withoutFirst];
}

function evaluateHand(cards) {
    // cards: array of 5 card strings
    const parsed = cards.map(parseCard).sort((a, b) => b.val - a.val);
    const vals = parsed.map(c => c.val);
    const suits = parsed.map(c => c.suit);
    const ranks = parsed.map(c => c.rank);

    const isFlush = suits.every(s => s === suits[0]);
    const isStraight = (() => {
        for (let i = 0; i < 4; i++)
            if (vals[i] - vals[i+1] !== 1) {
                // Check A-2-3-4-5
                if (i === 0 && vals[0] === 12 && vals[1] === 3 && vals[2] === 2 && vals[3] === 1 && vals[4] === 0)
                    return 'wheel';
                return false;
            }
        return true;
    })();

    const counts = {};
    for (const v of vals) counts[v] = (counts[v] || 0) + 1;
    const groups = Object.entries(counts).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const groupCounts = groups.map(g => g[1]);

    let rank, tiebreak;

    if (isFlush && (isStraight === true)) { rank = 8; tiebreak = vals; } // Straight flush
    else if (isFlush && isStraight === 'wheel') { rank = 8; tiebreak = [3,2,1,0,-1]; }
    else if (groupCounts[0] === 4) { rank = 7; tiebreak = vals; } // Four of a kind
    else if (groupCounts[0] === 3 && groupCounts[1] === 2) { rank = 6; tiebreak = vals; } // Full house
    else if (isFlush) { rank = 5; tiebreak = vals; } // Flush
    else if (isStraight === true) { rank = 4; tiebreak = vals; } // Straight
    else if (isStraight === 'wheel') { rank = 4; tiebreak = [3,2,1,0,-1]; }
    else if (groupCounts[0] === 3) { rank = 3; tiebreak = vals; } // Three of a kind
    else if (groupCounts[0] === 2 && groupCounts[1] === 2) { rank = 2; tiebreak = vals; } // Two pair
    else if (groupCounts[0] === 2) { rank = 1; tiebreak = vals; } // One pair
    else { rank = 0; tiebreak = vals; } // High card

    return { rank, tiebreak, cards };
}

const HAND_NAMES = [
    'High Card','One Pair','Two Pair','Three of a Kind',
    'Straight','Flush','Full House','Four of a Kind','Straight Flush'
];

function bestHandFrom7(cards) {
    const combos = getCombinations(cards, 5);
    let best = null;
    for (const combo of combos) {
        const result = evaluateHand(combo);
        if (!best || compareHands(result, best) > 0) best = result;
    }
    return { ...best, name: HAND_NAMES[best.rank] };
}

function compareHands(a, b) {
    if (a.rank !== b.rank) return a.rank - b.rank;
    for (let i = 0; i < a.tiebreak.length; i++) {
        if (a.tiebreak[i] !== b.tiebreak[i]) return a.tiebreak[i] - b.tiebreak[i];
    }
    return 0;
}

// ─── Helper: promisify db.query ───────────────────────────────────────────────

function query(sql, params) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// List all open games
router.get('/', auth, async (req, res) => {
    try {
        const games = await query(
            `SELECT g.id, g.room_name, g.status, g.created_at,
                    COUNT(gp.id) as player_count
             FROM games g
             LEFT JOIN game_players gp ON g.id = gp.game_id
             WHERE g.status IN ('waiting','countdown','active')
             GROUP BY g.id
             ORDER BY g.created_at DESC`,
            []
        );
        res.json(games);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create a game
router.post('/create', auth, async (req, res) => {
    try {
        const { room_name } = req.body;
        const result = await query(
            'INSERT INTO games (room_name) VALUES (?)',
            [room_name || `Room ${Date.now()}`]
        );
        const gameId = result.insertId;
        // Creator auto-joins
        await query(
            'INSERT INTO game_players (game_id, user_id, seat_index) VALUES (?, ?, 0)',
            [gameId, req.user.id]
        );
        res.json({ message: 'Game created', gameId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Join a game
router.post('/join/:gameId', auth, async (req, res) => {
    try {
        const gameId = req.params.gameId;
        const game = (await query('SELECT * FROM games WHERE id = ?', [gameId]))[0];
        if (!game) return res.status(404).json({ message: 'Game not found' });
        if (game.status !== 'waiting') return res.status(400).json({ message: 'Game already started' });

        const players = await query('SELECT * FROM game_players WHERE game_id = ?', [gameId]);
        if (players.length >= 6) return res.status(400).json({ message: 'Game full (max 6)' });
        const alreadyIn = players.find(p => p.user_id === req.user.id);
        if (alreadyIn) return res.json({ message: 'Already in game' });

        await query(
            'INSERT INTO game_players (game_id, user_id, seat_index) VALUES (?, ?, ?)',
            [gameId, req.user.id, players.length]
        );
        res.json({ message: 'Joined game' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get full game state (safe: only return current player's hole cards)
router.get('/state/:gameId', auth, async (req, res) => {
    try {
        const gameId = req.params.gameId;
        const game = (await query('SELECT * FROM games WHERE id = ?', [gameId]))[0];
        if (!game) return res.status(404).json({ message: 'Game not found' });

        const players = await query(
            `SELECT gp.*, u.username, u.wins
             FROM game_players gp
             JOIN users u ON gp.user_id = u.id
             WHERE gp.game_id = ?
             ORDER BY gp.seat_index`,
            [gameId]
        );

        // Only reveal the requesting player's own hole cards
        const sanitized = players.map(p => ({
            ...p,
            hole_cards: p.user_id === req.user.id
                ? JSON.parse(p.hole_cards || 'null')
                : (p.folded ? null : (p.hole_cards ? ['??', '??'] : null))
        }));

        const communityCards = game.community_cards ? JSON.parse(game.community_cards) : [];
        // Only reveal cards appropriate to current round
        const roundReveal = { preflop: 0, flop: 3, turn: 4, river: 5, showdown: 5 };
        const revealCount = roundReveal[game.round] || 0;

        let winnerInfo = null;
        if (game.status === 'finished' && game.winner_id) {
            const winner = players.find(p => p.user_id === game.winner_id);
            winnerInfo = winner ? winner.username : null;
        }

        res.json({
            gameId: game.id,
            roomName: game.room_name,
            status: game.status,
            round: game.round,
            pot: game.pot,
            currentBet: game.current_bet,
            currentPlayerIndex: game.current_player_index,
            communityCards: communityCards.slice(0, revealCount),
            countdownStart: game.countdown_start,
            players: sanitized,
            myUserId: req.user.id,
            winnerId: game.winner_id,
            winnerName: winnerInfo
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Ready up (triggers countdown when all players ready, min 2)
router.post('/ready/:gameId', auth, async (req, res) => {
    try {
        const gameId = req.params.gameId;
        await query(
            'UPDATE game_players SET is_ready = TRUE WHERE game_id = ? AND user_id = ?',
            [gameId, req.user.id]
        );

        const players = await query('SELECT * FROM game_players WHERE game_id = ?', [gameId]);
        const allReady = players.length >= 2 && players.every(p => p.is_ready);

        if (allReady) {
            const now = Date.now();
            await query(
                'UPDATE games SET status = ?, countdown_start = ? WHERE id = ?',
                ['countdown', now, gameId]
            );

            // After 5s, start the game
            setTimeout(async () => {
                await startGame(gameId);
            }, 5000);
        }

        res.json({ message: 'Ready', allReady });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Internal: start game ────────────────────────────────────────────────────
async function startGame(gameId) {
    const game = (await query('SELECT * FROM games WHERE id = ?', [gameId]))[0];
    if (game.status !== 'countdown') return;

    const players = await query(
        'SELECT * FROM game_players WHERE game_id = ? ORDER BY seat_index',
        [gameId]
    );

    const deck = createDeck();
    const STARTING_CHIPS = 1000;
    const SMALL_BLIND = 25;
    const BIG_BLIND = 50;

    // Deal 2 hole cards to each player
    for (const player of players) {
        const holeCards = [deck.pop(), deck.pop()];
        await query(
            'UPDATE game_players SET hole_cards = ?, chips = ?, bet_this_round = 0, has_acted = FALSE, folded = FALSE WHERE id = ?',
            [JSON.stringify(holeCards), STARTING_CHIPS, player.id]
        );
    }

    // Burn 5 community cards off the top (store all 5 now, reveal per round)
    const communityCards = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];

    // Post blinds
    const sbIdx = 0;
    const bbIdx = 1 % players.length;
    await query(
        'UPDATE game_players SET chips = chips - ?, bet_this_round = ?, total_bet = ? WHERE id = ?',
        [SMALL_BLIND, SMALL_BLIND, SMALL_BLIND, players[sbIdx].id]
    );
    await query(
        'UPDATE game_players SET chips = chips - ?, bet_this_round = ?, total_bet = ? WHERE id = ?',
        [BIG_BLIND, BIG_BLIND, BIG_BLIND, players[bbIdx].id]
    );

    // First to act preflop is after big blind
    const firstActIdx = (bbIdx + 1) % players.length;

    await query(
        `UPDATE games SET
            status = 'active',
            deck = ?,
            community_cards = ?,
            pot = ?,
            current_bet = ?,
            current_player_index = ?,
            round = 'preflop',
            small_blind_index = 0
         WHERE id = ?`,
        [
            JSON.stringify(deck),
            JSON.stringify(communityCards),
            SMALL_BLIND + BIG_BLIND,
            BIG_BLIND,
            firstActIdx,
            gameId
        ]
    );
}

// ─── Betting action ──────────────────────────────────────────────────────────
router.post('/action/:gameId', auth, async (req, res) => {
    try {
        const gameId = req.params.gameId;
        const { action, amount } = req.body; // action: fold | check | call | raise

        const game = (await query('SELECT * FROM games WHERE id = ?', [gameId]))[0];
        if (!game || game.status !== 'active') return res.status(400).json({ message: 'Game not active' });

        const players = await query(
            'SELECT * FROM game_players WHERE game_id = ? ORDER BY seat_index',
            [gameId]
        );
        const myPlayer = players.find(p => p.user_id === req.user.id);
        if (!myPlayer) return res.status(403).json({ message: 'Not in game' });

        const currentIdx = game.current_player_index;
        if (players[currentIdx].user_id !== req.user.id)
            return res.status(400).json({ message: 'Not your turn' });

        let pot = game.pot;
        let currentBet = game.current_bet;
        const toCall = currentBet - myPlayer.bet_this_round;

        if (action === 'fold') {
            await query('UPDATE game_players SET folded = TRUE, has_acted = TRUE WHERE id = ?', [myPlayer.id]);
        } else if (action === 'check') {
            if (toCall > 0) return res.status(400).json({ message: 'Cannot check, must call or fold' });
            await query('UPDATE game_players SET has_acted = TRUE WHERE id = ?', [myPlayer.id]);
        } else if (action === 'call') {
            const callAmt = Math.min(toCall, myPlayer.chips);
            pot += callAmt;
            await query(
                'UPDATE game_players SET chips = chips - ?, bet_this_round = bet_this_round + ?, total_bet = total_bet + ?, has_acted = TRUE WHERE id = ?',
                [callAmt, callAmt, callAmt, myPlayer.id]
            );
            await query('UPDATE games SET pot = ? WHERE id = ?', [pot, gameId]);
        } else if (action === 'raise') {
            const raiseAmt = parseInt(amount);
            if (!raiseAmt || raiseAmt < currentBet * 2 - myPlayer.bet_this_round)
                return res.status(400).json({ message: 'Invalid raise amount' });
            const totalAdd = raiseAmt - myPlayer.bet_this_round;
            if (totalAdd > myPlayer.chips) return res.status(400).json({ message: 'Not enough chips' });
            pot += totalAdd;
            currentBet = raiseAmt;
            // Everyone else needs to act again
            await query(
                'UPDATE game_players SET has_acted = FALSE WHERE game_id = ? AND user_id != ? AND folded = FALSE',
                [gameId, req.user.id]
            );
            await query(
                'UPDATE game_players SET chips = chips - ?, bet_this_round = ?, total_bet = total_bet + ?, has_acted = TRUE WHERE id = ?',
                [totalAdd, raiseAmt, totalAdd, myPlayer.id]
            );
            await query('UPDATE games SET pot = ?, current_bet = ? WHERE id = ?', [pot, currentBet, gameId]);
        }

        // Reload players after update
        const updatedPlayers = await query(
            'SELECT * FROM game_players WHERE game_id = ? ORDER BY seat_index',
            [gameId]
        );
        const activePlayers = updatedPlayers.filter(p => !p.folded);

        // Check if only one player remains
        if (activePlayers.length === 1) {
            await endGame(gameId, activePlayers[0].user_id, pot, 'last_standing');
            return res.json({ message: 'Round over', action });
        }

        // Check if betting round is complete
        const bettingDone = activePlayers.every(p => p.has_acted && p.bet_this_round == game.current_bet);

        if (bettingDone) {
            await advanceRound(gameId, game, updatedPlayers);
        } else {
            // Advance to next non-folded player
            let nextIdx = (currentIdx + 1) % updatedPlayers.length;
            while (updatedPlayers[nextIdx].folded) {
                nextIdx = (nextIdx + 1) % updatedPlayers.length;
            }
            await query('UPDATE games SET current_player_index = ? WHERE id = ?', [nextIdx, gameId]);
        }

        res.json({ message: 'Action taken', action });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

async function advanceRound(gameId, game, players) {
    const rounds = ['preflop', 'flop', 'turn', 'river', 'showdown'];
    const nextRound = rounds[rounds.indexOf(game.round) + 1];

    if (!nextRound || nextRound === 'showdown') {
        // Showdown
        await doShowdown(gameId, game.pot, players);
        return;
    }

    // Reset bets for new round, start from small blind position
    await query(
        'UPDATE game_players SET bet_this_round = 0, has_acted = FALSE WHERE game_id = ?',
        [gameId]
    );

    const activePlayers = players.filter(p => !p.folded);
    // First to act post-flop is small blind (or next after)
    let firstIdx = game.small_blind_index % players.length;
    while (players[firstIdx].folded) {
        firstIdx = (firstIdx + 1) % players.length;
    }

    await query(
        'UPDATE games SET round = ?, current_bet = 0, current_player_index = ? WHERE id = ?',
        [nextRound, firstIdx, gameId]
    );
}

async function doShowdown(gameId, pot, players) {
    await query('UPDATE games SET round = "showdown" WHERE id = ?', [gameId]);

    const game = (await query('SELECT * FROM games WHERE id = ?', [gameId]))[0];
    const communityCards = JSON.parse(game.community_cards || '[]');
    const activePlayers = players.filter(p => !p.folded);

    let bestPlayer = null;
    let bestHand = null;

    for (const player of activePlayers) {
        const holeCards = JSON.parse(player.hole_cards || '[]');
        const allCards = [...holeCards, ...communityCards];
        const hand = bestHandFrom7(allCards);
        if (!bestHand || compareHands(hand, bestHand) > 0) {
            bestHand = hand;
            bestPlayer = player;
        }
    }

    await endGame(gameId, bestPlayer.user_id, pot, bestHand.name);
}

async function endGame(gameId, winnerId, pot, reason) {
    await query(
        'UPDATE games SET status = "finished", winner_id = ?, round = "showdown" WHERE id = ?',
        [winnerId, gameId]
    );
    await query(
        'UPDATE game_players SET chips = chips + ? WHERE game_id = ? AND user_id = ?',
        [pot, gameId, winnerId]
    );
    await query('UPDATE users SET wins = wins + 1 WHERE id = ?', [winnerId]);
}

module.exports = router;
