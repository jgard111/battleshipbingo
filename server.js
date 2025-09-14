const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Data storage (in production, use a proper database)
const gamesFile = 'games.json';

// Initialize games file if it doesn't exist
if (!fs.existsSync(gamesFile)) {
    fs.writeFileSync(gamesFile, JSON.stringify({}));
}

// Helper functions
function readGames() {
    try {
        const data = fs.readFileSync(gamesFile, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading games file:', error);
        return {};
    }
}

function writeGames(games) {
    try {
        fs.writeFileSync(gamesFile, JSON.stringify(games, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing games file:', error);
        return false;
    }
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/team-a', (req, res) => {
    res.sendFile(path.join(__dirname, 'team-a.html'));
});

app.get('/team-b', (req, res) => {
    res.sendFile(path.join(__dirname, 'team-b.html'));
});

// API Routes
app.post('/api/games', (req, res) => {
    try {
        const { gameId, gameData } = req.body;
        
        if (!gameId || !gameData) {
            return res.status(400).json({ error: 'Game ID and data are required' });
        }
        
        const games = readGames();
        games[gameId] = {
            ...gameData,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        if (writeGames(games)) {
            res.json({ success: true, gameId });
        } else {
            res.status(500).json({ error: 'Failed to save game' });
        }
    } catch (error) {
        console.error('Error saving game:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/games/:gameId', (req, res) => {
    try {
        const { gameId } = req.params;
        const games = readGames();
        
        if (games[gameId]) {
            res.json(games[gameId]);
        } else {
            res.status(404).json({ error: 'Game not found' });
        }
    } catch (error) {
        console.error('Error fetching game:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/games/:gameId', (req, res) => {
    try {
        const { gameId } = req.params;
        const { gameData } = req.body;
        
        const games = readGames();
        
        if (!games[gameId]) {
            return res.status(404).json({ error: 'Game not found' });
        }
        
        games[gameId] = {
            ...games[gameId],
            ...gameData,
            updatedAt: new Date().toISOString()
        };
        
        if (writeGames(games)) {
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Failed to update game' });
        }
    } catch (error) {
        console.error('Error updating game:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/games', (req, res) => {
    try {
        const games = readGames();
        const gameList = Object.keys(games).map(gameId => ({
            gameId,
            createdAt: games[gameId].createdAt,
            updatedAt: games[gameId].updatedAt,
            gridSize: games[gameId].gridSize
        }));
        
        res.json(gameList);
    } catch (error) {
        console.error('Error fetching games list:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Battleship Bingo server running on port ${PORT}`);
    console.log(`Access the game at: http://localhost:${PORT}`);
});
