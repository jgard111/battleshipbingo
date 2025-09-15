class BattleshipBingo {
    constructor() {
        this.gridSize = 0;
        this.grid = [];
        this.editMode = false;
        this.currentEditingTile = null;
        this.searchResults = [];
        this.gameId = null;
        this.apiBaseUrl = window.location.origin;
        this.searchCache = new Map(); // Cache for search results
        this.searchTimeout = null;
        
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // Grid size selection
        document.getElementById('gridSize').addEventListener('change', (e) => {
            const createGridBtn = document.getElementById('createGridBtn');
            createGridBtn.disabled = !e.target.value;
        });

        // Create grid button
        document.getElementById('createGridBtn').addEventListener('click', () => {
            this.createGrid();
        });

        // Edit mode toggle
        document.getElementById('editModeToggle').addEventListener('click', () => {
            this.toggleEditMode();
        });

        // Create game button
        document.getElementById('createGameBtn').addEventListener('click', () => {
            this.createGame();
        });

        // Modal event listeners
        this.initializeModalListeners();
    }

    initializeModalListeners() {
        const modal = document.getElementById('tileEditModal');
        const closeBtn = document.querySelector('.close');
        const cancelBtn = document.getElementById('cancelTileBtn');
        const saveBtn = document.getElementById('saveTileBtn');
        const searchBtn = document.getElementById('searchBtn');
        const itemSearch = document.getElementById('itemSearch');

        // Close modal
        closeBtn.addEventListener('click', () => this.closeModal());
        cancelBtn.addEventListener('click', () => this.closeModal());
        
        // Click outside modal to close
        window.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeModal();
            }
        });

        // Save tile
        saveBtn.addEventListener('click', () => this.saveTile());

        // Real-time search functionality
        itemSearch.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            
            // Clear previous timeout
            clearTimeout(this.searchTimeout);
            
            // Clear results if query is empty
            if (query.length === 0) {
                document.getElementById('searchResults').innerHTML = '';
                return;
            }
            
            // Check cache first
            if (this.searchCache.has(query)) {
                this.displaySearchResults(this.searchCache.get(query));
                return;
            }
            
            // Show loading state
            this.showSearchLoading(true);
            
            // Debounce search - wait 300ms after user stops typing
            this.searchTimeout = setTimeout(() => {
                this.searchItems(query);
            }, 300);
        });

        // Manual search button (still available)
        searchBtn.addEventListener('click', () => {
            const query = itemSearch.value.trim();
            if (query) {
                this.searchItems(query);
            }
        });

        // Real-time preview updates
        document.getElementById('hoverText').addEventListener('input', () => this.updatePreview());
        
    }

    createGrid() {
        const size = parseInt(document.getElementById('gridSize').value);
        if (!size) return;

        this.gridSize = size;
        this.grid = Array(size).fill().map(() => Array(size).fill(null));

        const gridContainer = document.getElementById('battleshipGrid');
        gridContainer.innerHTML = '';
        gridContainer.style.gridTemplateColumns = `repeat(${size}, 1fr)`;

        // Create grid tiles
        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                const tile = document.createElement('div');
                tile.className = 'grid-tile';
                tile.dataset.row = row;
                tile.dataset.col = col;
                tile.addEventListener('click', () => this.tileClicked(row, col));
                gridContainer.appendChild(tile);
            }
        }

        // Show game section and team names section
        document.getElementById('gameSection').style.display = 'block';
        document.getElementById('teamNamesSection').style.display = 'block';
        document.getElementById('createGameBtn').disabled = false;
        
        // Scroll to grid
        document.getElementById('gameSection').scrollIntoView({ behavior: 'smooth' });
    }

    toggleEditMode() {
        this.editMode = !this.editMode;
        const toggleBtn = document.getElementById('editModeToggle');
        const tiles = document.querySelectorAll('.grid-tile');
        
        if (this.editMode) {
            toggleBtn.innerHTML = '<i class="fas fa-edit"></i> Edit Mode: ON';
            toggleBtn.classList.remove('btn-secondary');
            toggleBtn.classList.add('btn-success');
            tiles.forEach(tile => tile.classList.add('edit-mode'));
        } else {
            toggleBtn.innerHTML = '<i class="fas fa-edit"></i> Edit Mode: OFF';
            toggleBtn.classList.remove('btn-success');
            toggleBtn.classList.add('btn-secondary');
            tiles.forEach(tile => tile.classList.remove('edit-mode'));
        }
    }

    tileClicked(row, col) {
        if (!this.editMode) return;

        this.currentEditingTile = { row, col };
        this.openModal();
    }

    openModal() {
        const modal = document.getElementById('tileEditModal');
        const tile = this.grid[this.currentEditingTile.row][this.currentEditingTile.col];
        
        // Reset form
        document.getElementById('itemSearch').value = '';
        document.getElementById('hoverText').value = tile?.hoverText || '';
        document.getElementById('searchResults').innerHTML = '';
        
        // No color selection on admin board
        
        this.updatePreview();
        modal.style.display = 'block';
    }

    closeModal() {
        document.getElementById('tileEditModal').style.display = 'none';
        this.currentEditingTile = null;
    }

    async searchItems(query = null) {
        const searchQuery = query || document.getElementById('itemSearch').value.trim();
        if (!searchQuery) return;

        // Check cache first
        if (this.searchCache.has(searchQuery)) {
            this.displaySearchResults(this.searchCache.get(searchQuery));
            return;
        }

        this.showSearchLoading(true);
        
        try {
            // Using OSRS Wiki API
            const response = await fetch(`https://oldschool.runescape.wiki/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(searchQuery)}&srnamespace=0&srlimit=10`);
            const data = await response.json();
            
            let results = [];
            if (data.query && data.query.search) {
                results = data.query.search;
            }
            
            // Cache the results
            this.searchCache.set(searchQuery, results);
            
            // Limit cache size to prevent memory issues
            if (this.searchCache.size > 50) {
                const firstKey = this.searchCache.keys().next().value;
                this.searchCache.delete(firstKey);
            }
            
            this.displaySearchResults(results);
        } catch (error) {
            console.error('Search error:', error);
            this.displaySearchResults([]);
        } finally {
            this.showSearchLoading(false);
        }
    }

    displaySearchResults(results) {
        const container = document.getElementById('searchResults');
        container.innerHTML = '';

        if (results.length === 0) {
            container.innerHTML = '<div class="no-results"><i class="fas fa-search"></i><br>No items found</div>';
            return;
        }

        results.forEach((item, index) => {
            const resultItem = document.createElement('div');
            resultItem.className = 'search-result-item';
            
            // Get item image from OSRS Wiki
            const imageUrl = `https://oldschool.runescape.wiki/images/${item.title.replace(/ /g, '_')}.png`;
            
            resultItem.innerHTML = `
                <img src="${imageUrl}" alt="${item.title}" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjRjBGMEYwIi8+CjxwYXRoIGQ9Ik0xNiA4VjI0TTggMTZIMjQiIHN0cm9rZT0iIzk5OTk5OSIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KPC9zdmc+'">
                <span>${item.title}</span>
            `;
            
            // Add slight delay for animation effect
            setTimeout(() => {
                resultItem.style.opacity = '0';
                resultItem.style.transform = 'translateY(-10px)';
                resultItem.style.transition = 'all 0.3s ease';
                container.appendChild(resultItem);
                
                // Trigger animation
                setTimeout(() => {
                    resultItem.style.opacity = '1';
                    resultItem.style.transform = 'translateY(0)';
                }, 10);
            }, index * 50);
            
            resultItem.addEventListener('click', () => this.selectItem(item.title, imageUrl));
        });
    }

    selectItem(itemName, imageUrl) {
        const { row, col } = this.currentEditingTile;
        
        if (!this.grid[row][col]) {
            this.grid[row][col] = {};
        }
        
        this.grid[row][col].itemName = itemName;
        this.grid[row][col].imageUrl = imageUrl;
        
        this.updatePreview();
        document.getElementById('searchResults').innerHTML = '';
        document.getElementById('itemSearch').value = '';
    }

    updatePreview() {
        const preview = document.getElementById('tilePreview');
        const { row, col } = this.currentEditingTile;
        const tile = this.grid[row][col];
        const hoverText = document.getElementById('hoverText').value;
        
        // Set default background for admin preview (no color changes on admin board)
        preview.style.background = 'linear-gradient(135deg, #2d2d2d, #1a1a1a)';
        
        preview.innerHTML = '';
        
        if (tile && tile.imageUrl) {
            const img = document.createElement('img');
            img.src = tile.imageUrl;
            img.alt = tile.itemName;
            img.onerror = () => {
                img.style.display = 'none';
                preview.innerHTML = '<i class="fas fa-image" style="color: #999;"></i>';
            };
            preview.appendChild(img);
        } else {
            preview.innerHTML = '<i class="fas fa-plus" style="color: #999;"></i>';
        }
        
        if (hoverText) {
            const hoverElement = document.createElement('div');
            hoverElement.className = 'tile-hover-text';
            hoverElement.textContent = hoverText;
            preview.appendChild(hoverElement);
        }
    }

    saveTile() {
        const { row, col } = this.currentEditingTile;
        const hoverText = document.getElementById('hoverText').value;
        
        if (!this.grid[row][col]) {
            this.grid[row][col] = {};
        }
        
        this.grid[row][col].hoverText = hoverText;
        // No color saving on admin board - colors are only for team pages
        
        // Update the actual tile in the grid
        this.updateTileDisplay(row, col);
        
        this.closeModal();
    }

    updateTileDisplay(row, col) {
        const tileElement = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
        const tile = this.grid[row][col];
        
        if (!tile) return;
        
        // Set default background for admin board (no color changes)
        tileElement.style.background = 'linear-gradient(135deg, #2d2d2d, #1a1a1a)';
        
        // Update image
        tileElement.innerHTML = '';
        if (tile.imageUrl) {
            const img = document.createElement('img');
            img.src = tile.imageUrl;
            img.alt = tile.itemName;
            img.onerror = () => {
                img.style.display = 'none';
                tileElement.innerHTML = '<i class="fas fa-image" style="color: #999;"></i>';
            };
            tileElement.appendChild(img);
        }
        
        // Update hover text
        if (tile.hoverText) {
            const hoverElement = document.createElement('div');
            hoverElement.className = 'tile-hover-text';
            hoverElement.textContent = tile.hoverText;
            tileElement.appendChild(hoverElement);
        }
    }

    async createGame() {
        if (!this.gameId) {
            this.gameId = this.generateGameId();
        }
        
        // Validate password
        const password = document.getElementById('adminPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        
        if (!this.validatePassword(password, confirmPassword)) {
            return; // Stop if validation fails
        }
        
        // Get team names
        const teamAName = document.getElementById('teamAName').value.trim() || 'Team A';
        const teamBName = document.getElementById('teamBName').value.trim() || 'Team B';
        
        const gameData = {
            gridSize: this.gridSize,
            grid: this.grid,
            teamAName: teamAName,
            teamBName: teamBName,
            adminPassword: password
        };
        
        try {
            this.showLoading(true);
            
            const response = await fetch(`${this.apiBaseUrl}/api/games`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    gameId: this.gameId,
                    gameData: gameData
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                this.gameId = result.gameId;
                
                // Generate team page links
                const teamALink = `${this.apiBaseUrl}/team-a?gameId=${this.gameId}`;
                const teamBLink = `${this.apiBaseUrl}/team-b?gameId=${this.gameId}`;
                
                // Show success message with links (without password)
                const message = `Game created successfully!\n\nGame ID: ${this.gameId}\n\n${teamAName}: ${teamALink}\n${teamBName}: ${teamBLink}\n\nAdmin Password: ${password}`;
                alert(message);
                
                // Also display links on the page
                this.displayGameLinks(teamALink, teamBLink, teamAName, teamBName, password);
            } else {
                throw new Error('Failed to save game');
            }
        } catch (error) {
            console.error('Error creating game:', error);
            alert('Error creating game. Please try again.');
        } finally {
            this.showLoading(false);
        }
    }

    validatePassword(password, confirmPassword) {
        const errorDiv = document.getElementById('passwordError');
        const errorText = document.getElementById('passwordErrorText');
        
        // Clear previous errors
        errorDiv.style.display = 'none';
        
        // Check if password is provided
        if (!password) {
            errorText.textContent = 'Password is required';
            errorDiv.style.display = 'block';
            return false;
        }
        
        // Check minimum length
        if (password.length < 4) {
            errorText.textContent = 'Password must be at least 4 characters long';
            errorDiv.style.display = 'block';
            return false;
        }
        
        // Check if passwords match
        if (password !== confirmPassword) {
            errorText.textContent = 'Passwords do not match';
            errorDiv.style.display = 'block';
            return false;
        }
        
        return true;
    }

    generateGameId() {
        return 'game_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    displayGameLinks(teamALink, teamBLink, teamAName, teamBName, password) {
        // Create a section to display the links
        const gameSection = document.getElementById('gameSection');
        
        // Remove existing links section if it exists
        const existingLinks = document.getElementById('gameLinks');
        if (existingLinks) {
            existingLinks.remove();
        }
        
        const linksSection = document.createElement('div');
        linksSection.id = 'gameLinks';
        linksSection.className = 'game-links-section';
        linksSection.innerHTML = `
            <h3><i class="fas fa-link"></i> Game Links</h3>
            <div class="links-container">
                <div class="link-item">
                    <h4>${teamAName}</h4>
                    <div class="link-input-container">
                        <input type="text" value="${teamALink}" readonly id="teamALink">
                        <button class="btn btn-secondary" onclick="copyToClipboard('teamALink')">
                            <i class="fas fa-copy"></i> Copy
                        </button>
                    </div>
                </div>
                <div class="link-item">
                    <h4>${teamBName}</h4>
                    <div class="link-input-container">
                        <input type="text" value="${teamBLink}" readonly id="teamBLink">
                        <button class="btn btn-secondary" onclick="copyToClipboard('teamBLink')">
                            <i class="fas fa-copy"></i> Copy
                        </button>
                    </div>
                </div>
            </div>
            <div class="password-display">
                <i class="fas fa-key"></i> Admin Password: <strong>${password}</strong>
            </div>
            <div class="game-info">
                <i class="fas fa-info-circle"></i> Share these links with your teams to start playing!
            </div>
        `;
        
        gameSection.appendChild(linksSection);
    }

    showLoading(show) {
        document.getElementById('loadingOverlay').style.display = show ? 'block' : 'none';
    }

    showSearchLoading(show) {
        const searchResults = document.getElementById('searchResults');
        if (show) {
            searchResults.innerHTML = '<div class="search-loading"><i class="fas fa-spinner fa-spin"></i> Searching...</div>';
        }
    }
}

// Copy to clipboard function
function copyToClipboard(elementId) {
    const element = document.getElementById(elementId);
    element.select();
    element.setSelectionRange(0, 99999); // For mobile devices
    document.execCommand('copy');
    
    // Show feedback
    const button = element.nextElementSibling;
    const originalText = button.innerHTML;
    button.innerHTML = '<i class="fas fa-check"></i> Copied!';
    button.classList.add('btn-success');
    button.classList.remove('btn-secondary');
    
    setTimeout(() => {
        button.innerHTML = originalText;
        button.classList.remove('btn-success');
        button.classList.add('btn-secondary');
    }, 2000);
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new BattleshipBingo();
});
