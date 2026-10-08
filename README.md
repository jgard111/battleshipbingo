# OSRS Battleship Bingo

A Battleship Bingo tracker for Old School RuneScape clans. Anyone can create a game from the home page. Each game gets:

- a **public link** (`/g/your-game`) where everyone follows both boards live
- an **admin page** (`/g/your-game/admin`) protected by the password the creator chose
- **captain logins**, so each team captain can place their fleet until the admin starts the game
- optional **Discord updates** through a channel webhook

There's nothing to install: the server only uses Node's built-in modules.

---

## Put it online with Railway

You need a GitHub account (free) and a Railway account (Hobby plan, $5 a month, which includes $5 of usage; a small app like this normally stays inside that).

### 1. Put the files on GitHub
1. Sign in at github.com and click **New repository** (the **+** at the top right).
2. Name it something like `battleship-bingo`. **Private** is fine. Click **Create repository**.
3. On the new repository page, click **uploading an existing file**.
4. Unzip `battleship-bingo.zip` on your computer. Open the unzipped folder, select **everything inside it** (`server.js`, `package.json`, `README.md` and the `public` and `seed` folders) and drag it all into the upload area.
5. Click **Commit changes**.

Check that the repository shows `server.js` and `package.json` at the top level, not inside another folder.

### 2. Deploy on Railway
1. Go to railway.com and sign in with GitHub.
2. Click **New Project**, then **Deploy from GitHub repo**, and pick your repository. If it isn't listed, use **Configure GitHub App** to give Railway access to it.
3. Railway sees `package.json`, builds the app and starts it with `npm start`. The first deploy takes a minute or two.

### 3. Add a volume so games are saved (important)
Without a volume, every game is wiped whenever the app redeploys.
1. On the project canvas, right-click your service (or press **Ctrl/Cmd + K** and search for "volume") and choose to add or attach a **Volume**.
2. Set the mount path to **`/data`** and save.
3. Railway redeploys the app. It finds the volume on its own; you don't need to set any path.

### 4. Set one variable
In your service, open **Variables** and add:
- `CONTACT`: your Discord name or email. It's sent to the OSRS Wiki with icon searches, which the wiki asks bots and tools to do so they can contact the owner if something goes wrong.

Optional:
- `PUBLIC_URL`: your full site address (for example `https://bingo.up.railway.app`), used in Discord messages. Without it, the address is worked out automatically.

### 5. Get your web address
1. Open the service's **Settings**, find **Networking** and click **Generate Domain**.
2. Railway gives you an address like `https://battleship-bingo-production.up.railway.app`. Open it: you should see the **Create game** page.

You can also connect your own domain there later.

---

## Running a game
1. On the home page, click **Create game**. Choose a name, the link name and an admin password.
2. You land on the admin page and see the public link and the admin link. Share the public link with your clan.
3. **Board tab:** click a square and search for any item. Results come from icons already saved on your site and from the OSRS Wiki. Picking a wiki item saves its icon on your site, so it's only fetched once. You can also upload or paste an image, set hover text, or fill the board from a list of names.
4. **Ships & fleets tab:** design ships, set how many of each every team gets, and set a passcode for each team's captain.
5. Captains open the public link, choose **Captain login** and place their fleet. They can move ships until you start.
6. When both fleets are placed, press **Start game**. Fleets, ships and board size are then locked.
7. **Shots tab:** pick the team that fired and the square. The site scores the hit or miss from the hidden fleet, and everyone watching sees it immediately.

### Discord (optional)
In Discord, open the channel's settings, then **Integrations**, then **Webhooks**, then **New Webhook**, and click **Copy Webhook URL**. Paste it under **Settings → Discord updates** on the admin page, save, and click **Send test message**. You can choose to post every shot or only hits and sunk ships, attach the updated board image, and announce the start and the winner.

### Moving your existing board
`seed/my-current-board.json` is the board you set up on the Claude page. Your squares, icons, hover text and ships (including the Toad) are all in it.

To load it:
1. Create a game.
2. Go to **Settings → Board file → Load board file** and pick that file.

You can also use **Download board file** to copy a board from one game to another.

---

## Good to know
- **Passwords:** admin passwords are stored securely hashed and can't be recovered. Write yours down. Team passcodes are visible to admins, so they can pass them on to captains.
- **Updating the site:** change files in the GitHub repository and Railway redeploys automatically. Games stay on the volume.
- **Backups:** Railway volumes can be backed up from the volume's settings. Each game's board can also be saved with **Download board file**.
- **Running it on your own computer:** install Node 20 or newer and run `npm start`, then open http://localhost:3000. Data is saved in a `data` folder.
