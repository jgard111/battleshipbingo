const express = require('express');
const cors = require('cors');
const path = require('path');
const { kv } = require('@vercel/kv');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Helper functions for Redis operations
async function readGames() {
    try {
        const games = await kv.get('battleship_games');
        return games || {};
    } catch (error) {
        console.error('Error reading games from KV:', error);
        return {};
    }
}

async function writeGames(newGames) {
    try {
        await kv.set('battleship_games', newGames);
        return true;
    } catch (error) {
        console.error('Error writing games to KV:', error);
        return false;
    }
}

// API Routes
app.post('/api/games', async (req, res) => {
    try {
        const { gameId, gameData } = req.body;
        
        if (!gameId || !gameData) {
            return res.status(400).json({ error: 'Game ID and data are required' });
        }
        
        const games = await readGames();
        games[gameId] = {
            ...gameData,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            // Initialize team states
            teamAState: {
                markedTiles: {},
                lastUpdated: new Date().toISOString()
            },
            teamBState: {
                markedTiles: {},
                lastUpdated: new Date().toISOString()
            }
        };
        
        if (await writeGames(games)) {
            res.json({ success: true, gameId });
        } else {
            res.status(500).json({ error: 'Failed to save game' });
        }
    } catch (error) {
        console.error('Error saving game:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/games/:gameId', async (req, res) => {
    try {
        const { gameId } = req.params;
        const games = await readGames();
        
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

app.put('/api/games/:gameId', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { gameData } = req.body;
        
        const games = await readGames();
        
        if (!games[gameId]) {
            return res.status(404).json({ error: 'Game not found' });
        }
        
        games[gameId] = {
            ...games[gameId],
            ...gameData,
            updatedAt: new Date().toISOString()
        };
        
        if (await writeGames(games)) {
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Failed to update game' });
        }
    } catch (error) {
        console.error('Error updating game:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Team-specific state endpoints
app.get('/api/games/:gameId/team/:teamId/state', async (req, res) => {
    try {
        const { gameId, teamId } = req.params;
        const games = await readGames();
        
        if (!games[gameId]) {
            return res.status(404).json({ error: 'Game not found' });
        }
        
        const teamStateKey = teamId === 'A' ? 'teamAState' : 'teamBState';
        const teamState = games[gameId][teamStateKey] || { markedTiles: {}, lastUpdated: new Date().toISOString() };
        
        res.json(teamState);
    } catch (error) {
        console.error('Error fetching team state:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/games/:gameId/team/:teamId/state', async (req, res) => {
    try {
        const { gameId, teamId } = req.params;
        const { markedTiles } = req.body;
        
        const games = await readGames();
        
        if (!games[gameId]) {
            return res.status(404).json({ error: 'Game not found' });
        }
        
        const teamStateKey = teamId === 'A' ? 'teamAState' : 'teamBState';
        
        if (!games[gameId][teamStateKey]) {
            games[gameId][teamStateKey] = { markedTiles: {}, lastUpdated: new Date().toISOString() };
        }
        
        games[gameId][teamStateKey] = {
            markedTiles: markedTiles || {},
            lastUpdated: new Date().toISOString()
        };
        
        if (await writeGames(games)) {
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Failed to save team state' });
        }
    } catch (error) {
        console.error('Error saving team state:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/games', async (req, res) => {
    try {
        const games = await readGames();
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

module.exports = app;
