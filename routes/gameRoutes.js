const express = require('express');
const db = require('../config/db');
const auth = require('../middleware/authMiddleware');

const router = express.Router();

function createDeck() {
    const suits = ['H', 'D', 'C', 'S'];
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

    let deck = [];

    for (let suit of suits) {
        for (let value of values) {
            deck.push(value + suit);
        }
    }

    return deck.sort(() => Math.random() - 0.5);
}

router.post('/create', auth, (req, res) => {
    const { room_name } = req.body;

    db.query(
        'INSERT INTO games (room_name) VALUES (?)',
        [room_name],
        (err, result) => {
            if (err) return res.status(500).json(err);

            res.json({
                message: 'Game created',
                gameId: result.insertId
            });
        }
    );
});

router.post('/join/:gameId', auth, (req, res) => {
    const gameId = req.params.gameId;

    db.query(
        'INSERT INTO game_players (game_id, user_id) VALUES (?, ?)',
        [gameId, req.user.id],
        (err) => {
            if (err) return res.status(500).json(err);

            res.json({ message: 'Joined game' });
        }
    );
});

router.post('/deal/:gameId', auth, (req, res) => {
    const deck = createDeck();

    const playerCards = {
        player1: [deck.pop(), deck.pop()],
        player2: [deck.pop(), deck.pop()]
    };

    const communityCards = [
        deck.pop(),
        deck.pop(),
        deck.pop(),
        deck.pop(),
        deck.pop()
    ];

    res.json({
        playerCards,
        communityCards
    });
});

router.post('/end/:gameId', auth, (req, res) => {
    const { winnerId } = req.body;

    db.query(
        'UPDATE users SET wins = wins + 1 WHERE id = ?',
        [winnerId],
        (err) => {
            if (err) return res.status(500).json(err);

            res.json({ message: 'Win recorded' });
        }
    );
});

module.exports = router;