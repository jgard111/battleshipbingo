# Battleship Bingo - Online Game Tracker

A web-based Battleship Bingo game tracker with OSRS (Old School RuneScape) integration, featuring admin controls and team management.

## Features

- **Grid Management**: Create 10x10, 15x15, 20x20, or 25x25 game grids
- **OSRS Integration**: Search and add Old School RuneScape item images
- **Team Pages**: Separate pages for Team A and Team B
- **Password Protection**: Secure admin access with password authentication
- **Real-time Updates**: Changes sync across all team pages
- **Responsive Design**: Works on desktop and mobile devices

## Quick Start

### Local Development

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start the Server**
   ```bash
   npm start
   ```

3. **Access the Application**
   - Admin Panel: `http://localhost:3000`
   - Team A: `http://localhost:3000/team-a?gameId=YOUR_GAME_ID`
   - Team B: `http://localhost:3000/team-b?gameId=YOUR_GAME_ID`

### Production Deployment

#### Option 1: Heroku (Recommended)

1. **Create a Heroku App**
   ```bash
   heroku create your-battleship-bingo-app
   ```

2. **Deploy**
   ```bash
   git add .
   git commit -m "Initial deployment"
   git push heroku main
   ```

3. **Open Your App**
   ```bash
   heroku open
   ```

#### Option 2: Railway

1. **Connect to Railway**
   - Go to [railway.app](https://railway.app)
   - Connect your GitHub repository
   - Deploy automatically

#### Option 3: Render

1. **Create a Web Service**
   - Go to [render.com](https://render.com)
   - Connect your repository
   - Set build command: `npm install`
   - Set start command: `npm start`

#### Option 4: Vercel

1. **Deploy with Vercel**
   ```bash
   npm install -g vercel
   vercel
   ```

2. **Configure for Node.js**
   - Create `vercel.json`:
   ```json
   {
     "version": 2,
     "builds": [
       {
         "src": "server.js",
         "use": "@vercel/node"
       }
     ],
     "routes": [
       {
         "src": "/(.*)",
         "dest": "server.js"
       }
     ]
   }
   ```

## File Structure

```
battleship-bingo/
├── index.html          # Admin panel
├── team-a.html         # Team A page
├── team-b.html         # Team B page
├── styles.css          # All styling
├── script.js           # Frontend JavaScript
├── server.js           # Backend API server
├── package.json        # Dependencies
└── README.md           # This file
```

## API Endpoints

- `GET /` - Admin panel
- `GET /team-a` - Team A page
- `GET /team-b` - Team B page
- `POST /api/games` - Create/update game
- `GET /api/games/:gameId` - Get game data
- `PUT /api/games/:gameId` - Update game data
- `GET /api/games` - List all games

## Usage

### Admin Setup

1. **Create Grid**
   - Select grid size (10x10 to 25x25)
   - Click "Create Grid"

2. **Configure Tiles**
   - Toggle "Edit Mode" ON
   - Click tiles to edit them
   - Search for OSRS items
   - Add hover text and colors
   - Save individual tiles

3. **Create Game**
   - Click "Create Game" when ready
   - Copy the generated team links
   - Share links with teams

### Team Usage

1. **Access Team Page**
   - Use the provided team link
   - Enter password: `TimDuncan1444900`

2. **Play the Game**
   - Select colors to mark tiles
   - Click tiles to mark them
   - Use "Clear All" to reset
   - Lock/unlock editing as needed

## Environment Variables

- `PORT` - Server port (default: 3000)

## Security

- Admin password: `TimDuncan1444900`
- Password can be changed in the HTML files
- All data is stored server-side
- CORS enabled for cross-origin requests

## Troubleshooting

### Common Issues

1. **"Game not found" error**
   - Ensure game ID is correct in URL
   - Check if game was created successfully

2. **OSRS images not loading**
   - Images are loaded from OSRS Wiki
   - Check internet connection
   - Some items may not have images

3. **Server won't start**
   - Ensure Node.js is installed
   - Run `npm install` to install dependencies
   - Check if port 3000 is available

### Support

For issues or questions:
1. Check the browser console for errors
2. Verify all files are uploaded correctly
3. Ensure the server is running
4. Check network connectivity

## License

MIT License - Feel free to modify and distribute.
