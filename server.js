const express = require('express');
const cors = require('cors');
const path = require('path');

require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const gameRoutes = require('./routes/gameRoutes');

const app = express();

app.use(cors());
app.use(express.json());

// API routes FIRST
app.use('/api/auth', authRoutes);
app.use('/api/games', gameRoutes);

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`JWT_SECRET loaded: ${!!process.env.JWT_SECRET}`);
    console.log(`DB_HOST: ${process.env.DB_HOST}`);
});
