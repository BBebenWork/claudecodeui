// Load environment variables from .env file
try {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '../.env');
  const envFile = fs.readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const [key, ...valueParts] = trimmedLine.split('=');
      if (key && valueParts.length > 0 && !process.env[key]) {
        process.env[key] = valueParts.join('=').trim();
      }
    }
  });
} catch (e) {
  console.log('No .env file found or error reading it:', e.message);
}

console.log('PORT from env:', process.env.PORT);

const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const cors = require('cors');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const os = require('os');
const pty = require('node-pty');
const fetch = require('node-fetch');

const { getProjects, getSessions, getSessionMessages, renameProject, deleteSession, deleteAllSessions, deleteProject, addProjectManually, extractProjectDirectory, clearProjectDirectoryCache, loadProjectConfig, saveProjectConfig } = require('./projects');
const { spawnClaude, abortClaudeSession } = require('./claude-cli');
const gitRoutes = require('./routes/git');
const { createCheckpoint, restoreCheckpoint, getCheckpoints, deleteCheckpoint, clearProjectCheckpoints } = require('./checkpoints');

// File system watcher for projects folder
let projectsWatcher = null;
const connectedClients = new Set();

// Setup file system watcher for Claude projects folder using chokidar
function setupProjectsWatcher() {
  const chokidar = require('chokidar');
  const claudeProjectsPath = path.join(process.env.HOME, '.claude', 'projects');
  
  if (projectsWatcher) {
    projectsWatcher.close();
  }
  
  try {
    // Initialize chokidar watcher with optimized settings
    projectsWatcher = chokidar.watch(claudeProjectsPath, {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**',
        '**/*.tmp',
        '**/*.swp',
        '**/.DS_Store'
      ],
      persistent: true,
      ignoreInitial: true, // Don't fire events for existing files on startup
      followSymlinks: false,
      depth: 10, // Reasonable depth limit
      awaitWriteFinish: {
        stabilityThreshold: 100, // Wait 100ms for file to stabilize
        pollInterval: 50
      }
    });
    
    // Debounce function to prevent excessive notifications
    let debounceTimer;
    const debouncedUpdate = async (eventType, filePath) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        try {
          
          // Clear project directory cache when files change
          clearProjectDirectoryCache();
          
          // Get updated projects list
          const updatedProjects = await getProjects();
          
          // Notify all connected clients about the project changes
          const updateMessage = JSON.stringify({
            type: 'projects_updated',
            projects: updatedProjects,
            timestamp: new Date().toISOString(),
            changeType: eventType,
            changedFile: path.relative(claudeProjectsPath, filePath)
          });
          
          connectedClients.forEach(client => {
            if (client.readyState === client.OPEN) {
              client.send(updateMessage);
            }
          });
          
        } catch (error) {
          console.error('❌ Error handling project changes:', error);
        }
      }, 150); // 150ms debounce (faster response for new sessions)
    };
    
    // Set up event listeners
    projectsWatcher
      .on('add', (filePath) => debouncedUpdate('add', filePath))
      .on('change', (filePath) => debouncedUpdate('change', filePath))
      .on('unlink', (filePath) => debouncedUpdate('unlink', filePath))
      .on('addDir', (dirPath) => debouncedUpdate('addDir', dirPath))
      .on('unlinkDir', (dirPath) => debouncedUpdate('unlinkDir', dirPath))
      .on('error', (error) => {
        console.error('❌ Chokidar watcher error:', error);
      })
      .on('ready', () => {
      });
    
  } catch (error) {
    console.error('❌ Failed to setup projects watcher:', error);
  }
}

// Get the first non-localhost IP address
function getServerIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const app = express();
const server = http.createServer(app);

// Single WebSocket server that handles both paths
const wss = new WebSocketServer({ 
  server,
  verifyClient: (info) => {
    console.log('WebSocket connection attempt to:', info.req.url);
    return true; // Accept all connections for now
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../dist')));

// Git API Routes
app.use('/api/git', gitRoutes);

// Checkpoint API Routes
app.post('/api/checkpoints/create', async (req, res) => {
  try {
    const { projectName, promptId, userMessage } = req.body;
    
    if (!projectName || !promptId || !userMessage) {
      return res.status(400).json({ error: 'Project name, prompt ID, and user message are required' });
    }
    
    const result = await createCheckpoint(projectName, promptId, userMessage);
    res.json(result);
  } catch (error) {
    console.error('Create checkpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/checkpoints/restore', async (req, res) => {
  try {
    const { projectName, promptId } = req.body;
    
    if (!projectName || !promptId) {
      return res.status(400).json({ error: 'Project name and prompt ID are required' });
    }
    
    const result = await restoreCheckpoint(projectName, promptId);
    res.json(result);
  } catch (error) {
    console.error('Restore checkpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/checkpoints/:projectName', async (req, res) => {
  try {
    const { projectName } = req.params;
    const checkpoints = getCheckpoints(projectName);
    res.json({ checkpoints });
  } catch (error) {
    console.error('Get checkpoints error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/checkpoints/:projectName/:promptId', async (req, res) => {
  try {
    const { projectName, promptId } = req.params;
    const success = deleteCheckpoint(projectName, promptId);
    res.json({ success });
  } catch (error) {
    console.error('Delete checkpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/checkpoints/:projectName', async (req, res) => {
  try {
    const { projectName } = req.params;
    const deletedCount = clearProjectCheckpoints(projectName);
    res.json({ success: true, deletedCount });
  } catch (error) {
    console.error('Clear project checkpoints error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API Routes
app.get('/api/config', (req, res) => {
  // Always use the server's actual IP and port for WebSocket connections
  const serverIP = getServerIP();
  const host = `${serverIP}:${PORT}`;
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'wss' : 'ws';
  
  console.log('Config API called - Returning host:', host, 'Protocol:', protocol);
  
  res.json({
    serverPort: PORT,
    wsUrl: `${protocol}://${host}`
  });
});

app.get('/api/projects', async (req, res) => {
  try {
    const projects = await getProjects();
    res.json(projects);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/projects/:projectName/sessions', async (req, res) => {
  try {
    const { limit = 5, offset = 0 } = req.query;
    const result = await getSessions(req.params.projectName, parseInt(limit), parseInt(offset));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get messages for a specific session
app.get('/api/projects/:projectName/sessions/:sessionId/messages', async (req, res) => {
  try {
    const { projectName, sessionId } = req.params;
    
    const messages = await getSessionMessages(projectName, sessionId);
    
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rename project endpoint
app.put('/api/projects/:projectName/rename', async (req, res) => {
  try {
    const { displayName } = req.body;
    await renameProject(req.params.projectName, displayName);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete session endpoint
app.delete('/api/projects/:projectName/sessions/:sessionId', async (req, res) => {
  try {
    const { projectName, sessionId } = req.params;
    await deleteSession(projectName, sessionId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete all sessions endpoint
app.delete('/api/projects/:projectName/sessions', async (req, res) => {
  try {
    const { projectName } = req.params;
    const result = await deleteAllSessions(projectName);
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete project endpoint (only if empty)
app.delete('/api/projects/:projectName', async (req, res) => {
  try {
    const { projectName } = req.params;
    await deleteProject(projectName);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create project endpoint
app.post('/api/projects/create', async (req, res) => {
  try {
    const { path: projectPath, displayName } = req.body;
    
    if (!projectPath || !projectPath.trim()) {
      return res.status(400).json({ error: 'Project path is required' });
    }
    
    const project = await addProjectManually(projectPath.trim(), displayName?.trim() || null);
    res.json({ success: true, project });
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint for project configuration
app.get('/api/projects/debug/:projectPath(*)', async (req, res) => {
  try {
    const projectPath = '/' + req.params.projectPath; // Restore leading slash
    const absolutePath = path.resolve(projectPath);
    
    // Generate the encoded project name
    let projectName = absolutePath;
    if (projectName.startsWith('/')) {
      projectName = projectName.substring(1);
    }
    projectName = projectName.replace(/\//g, '-').replace(/\s+/g, '_');
    
    const config = await loadProjectConfig();
    const projectDir = path.join(process.env.HOME, '.claude', 'projects', projectName);
    
    // Check various states
    const pathExists = await fs.access(absolutePath).then(() => true).catch(() => false);
    const projectDirExists = await fs.access(projectDir).then(() => true).catch(() => false);
    const configEntry = config[projectName] || null;
    
    // Get all existing projects
    const existingProjects = await getProjects();
    const duplicateProject = existingProjects.find(project => 
      project.path === absolutePath || project.fullPath === absolutePath
    );
    
    res.json({
      requestedPath: absolutePath,
      encodedName: projectName,
      pathExists,
      projectDirExists,
      configEntry,
      duplicateProject: duplicateProject ? {
        name: duplicateProject.name,
        displayName: duplicateProject.displayName,
        path: duplicateProject.path,
        fullPath: duplicateProject.fullPath,
        isManuallyAdded: duplicateProject.isManuallyAdded
      } : null,
      allProjects: existingProjects.map(p => ({
        name: p.name,
        displayName: p.displayName,
        path: p.path,
        fullPath: p.fullPath,
        isManuallyAdded: p.isManuallyAdded
      }))
    });
  } catch (error) {
    console.error('Error debugging project:', error);
    res.status(500).json({ error: error.message });
  }
});

// Reset project configuration endpoint (for debugging)
app.delete('/api/projects/config/:projectName', async (req, res) => {
  try {
    const { projectName } = req.params;
    const config = await loadProjectConfig();
    
    if (config[projectName]) {
      delete config[projectName];
      await saveProjectConfig(config);
      
      // Also clear the directory cache
      clearProjectDirectoryCache();
      
      res.json({ success: true, message: `Removed ${projectName} from configuration` });
    } else {
      res.status(404).json({ error: 'Project not found in configuration' });
    }
  } catch (error) {
    console.error('Error removing project config:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clean up all orphaned project configurations
app.post('/api/projects/cleanup', async (req, res) => {
  try {
    const config = await loadProjectConfig();
    const claudeDir = path.join(process.env.HOME, '.claude', 'projects');
    
    // Check if Claude projects directory exists
    let projectDirExists = false;
    try {
      await fs.access(claudeDir);
      projectDirExists = true;
    } catch (error) {
      // Directory doesn't exist
    }
    
    if (!projectDirExists) {
      // If projects directory doesn't exist, clear all config
      if (Object.keys(config).length > 0) {
        await saveProjectConfig({});
        clearProjectDirectoryCache();
        
        res.json({ 
          success: true, 
          message: `Cleaned up ${Object.keys(config).length} orphaned configuration entries`,
          removedProjects: Object.keys(config)
        });
      } else {
        res.json({ 
          success: true, 
          message: 'No orphaned configurations found',
          removedProjects: []
        });
      }
    } else {
      // Projects directory exists, only remove configs without corresponding directories
      const entries = await fs.readdir(claudeDir, { withFileTypes: true });
      const existingProjectNames = new Set(
        entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
      );
      
      const orphanedConfigs = [];
      const cleanedConfig = {};
      
      for (const [projectName, projectConfig] of Object.entries(config)) {
        if (existingProjectNames.has(projectName)) {
          // Keep configs that have corresponding directories
          cleanedConfig[projectName] = projectConfig;
        } else {
          // Remove orphaned configs
          orphanedConfigs.push(projectName);
        }
      }
      
      if (orphanedConfigs.length > 0) {
        await saveProjectConfig(cleanedConfig);
        clearProjectDirectoryCache();
        
        res.json({ 
          success: true, 
          message: `Cleaned up ${orphanedConfigs.length} orphaned configuration entries`,
          removedProjects: orphanedConfigs
        });
      } else {
        res.json({ 
          success: true, 
          message: 'No orphaned configurations found',
          removedProjects: []
        });
      }
    }
  } catch (error) {
    console.error('Error cleaning up project configurations:', error);
    res.status(500).json({ error: error.message });
  }
});

// File browser endpoint
app.get('/api/browse-directories', async (req, res) => {
  try {
    const { path: browsePath, mode } = req.query;
    
    // Default to root directories if no path provided
    const targetPath = browsePath || '/';
    const navigationMode = mode || 'windows'; // Default to Windows mode
    
    // Helper function to get Windows username
    const getWindowsUsername = async () => {
      try {
        // Try to find the Windows username from common paths
        const usersPath = '/mnt/c/Users';
        const userDirs = await fs.readdir(usersPath, { withFileTypes: true });
        const userFolders = userDirs.filter(dir => 
          dir.isDirectory() && 
          !['Public', 'Default', 'All Users'].includes(dir.name) &&
          !dir.name.startsWith('.')
        );
        
        // Return the first valid user folder (usually the main user)
        return userFolders.length > 0 ? userFolders[0].name : null;
      } catch (e) {
        return null;
      }
    };
    
    // Add Windows shortcuts if we're at root and have WSL access
    const addWindowsShortcuts = async () => {
      const shortcuts = [];
      
      try {
        // Check if we have access to Windows C: drive
        await fs.access('/mnt/c');
        
        // Get Windows username
        const username = await getWindowsUsername();
        
        if (username) {
          const userPath = `/mnt/c/Users/${username}`;
          
          // Add common Windows folders
          const commonFolders = [
            { name: '🖥️ Desktop', path: `${userPath}/Desktop`, icon: 'desktop' },
            { name: '📁 Documents', path: `${userPath}/Documents`, icon: 'documents' },
            { name: '⬇️ Downloads', path: `${userPath}/Downloads`, icon: 'downloads' },
            { name: '🖼️ Pictures', path: `${userPath}/Pictures`, icon: 'pictures' },
            { name: '🎵 Music', path: `${userPath}/Music`, icon: 'music' },
            { name: '🎬 Videos', path: `${userPath}/Videos`, icon: 'videos' },
          ];
          
          // Check which folders exist and add them
          for (const folder of commonFolders) {
            try {
              const stats = await fs.stat(folder.path);
              if (stats.isDirectory()) {
                shortcuts.push({
                  name: folder.name,
                  path: folder.path,
                  isDirectory: true,
                  isWindowsShortcut: true,
                  icon: folder.icon
                });
              }
            } catch (e) {
              // Folder doesn't exist, skip
            }
          }
        }
        
        // Add drives
        for (let i = 65; i <= 90; i++) { // A-Z
          const drive = String.fromCharCode(i);
          try {
            await fs.access(`/mnt/${drive.toLowerCase()}`);
            shortcuts.push({
              name: `${drive}: Drive`,
              path: `/mnt/${drive.toLowerCase()}`,
              isDirectory: true,
              isWslMount: true
            });
          } catch (e) {
            // Drive doesn't exist, skip
          }
        }
        
      } catch (e) {
        // No WSL access, just show regular Linux root
      }
      
      return shortcuts;
    };
    
    // Handle navigation based on mode
    let normalizedPath = targetPath;
    
    if (navigationMode === 'windows') {
      // Windows navigation mode
      if (targetPath === '/' || targetPath === '') {
        const shortcuts = await addWindowsShortcuts();
        return res.json({ 
          directories: shortcuts, 
          currentPath: '/', 
          mode: 'windows',
          parentPath: null 
        });
      }
      
      // Convert WSL path back to Windows path for access if needed
      const wslMatch = targetPath.match(/^\/mnt\/([a-z])(.*)$/);
      if (wslMatch) {
        const drive = wslMatch[1].toUpperCase();
        const remainingPath = wslMatch[2] || '';
        if (os.platform() === 'win32') {
          normalizedPath = `${drive}:${remainingPath.replace(/\//g, '\\')}`;
        } else {
          normalizedPath = targetPath; // Keep WSL format on Linux
        }
      }
    } else {
      // Linux navigation mode
      if (targetPath === '/' || targetPath === '') {
        normalizedPath = '/';
      }
      // For Linux mode, use paths as-is
    }
    
    // Check if path exists
    try {
      const stats = await fs.stat(normalizedPath);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Path is not a directory' });
      }
    } catch (error) {
      return res.status(404).json({ error: 'Path does not exist' });
    }
    
    // Read directory contents
    const entries = await fs.readdir(normalizedPath, { withFileTypes: true });
    
    // Filter to only include directories and convert to our format
    const directories = entries
      .filter(entry => entry.isDirectory())
      .map(entry => {
        const entryPath = path.join(normalizedPath, entry.name);
        // Convert back to WSL format if on Windows
        let displayPath = entryPath;
        if (os.platform() === 'win32') {
          const windowsMatch = entryPath.match(/^([A-Z]):(.*)$/);
          if (windowsMatch) {
            const drive = windowsMatch[1].toLowerCase();
            const remainingPath = windowsMatch[2].replace(/\\/g, '/');
            displayPath = `/mnt/${drive}${remainingPath}`;
          }
        }
        
        return {
          name: entry.name,
          path: displayPath,
          isDirectory: true
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    
    // Calculate parent path based on mode
    let parentPath = null;
    if (targetPath !== '/') {
      if (navigationMode === 'windows' && targetPath.match(/^\/mnt\/[a-z]$/)) {
        // If we're at a drive root in Windows mode, parent is the Windows root
        parentPath = '/';
      } else {
        parentPath = path.dirname(targetPath);
        if (parentPath === '/' && navigationMode === 'linux') {
          parentPath = null; // No parent for Linux root
        }
      }
    }
    
    res.json({ 
      directories, 
      currentPath: targetPath,
      parentPath: parentPath,
      mode: navigationMode
    });
    
  } catch (error) {
    console.error('Error browsing directories:', error);
    res.status(500).json({ error: error.message });
  }
});

// Read file content endpoint
app.get('/api/projects/:projectName/file', async (req, res) => {
  try {
    const { projectName } = req.params;
    const { filePath } = req.query;
    
    console.log('📄 File read request:', projectName, filePath);
    
    const fs = require('fs').promises;
    
    // Security check - ensure the path is safe and absolute
    if (!filePath || !path.isAbsolute(filePath)) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    
    const content = await fs.readFile(filePath, 'utf8');
    res.json({ content, path: filePath });
  } catch (error) {
    console.error('Error reading file:', error);
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'File not found' });
    } else if (error.code === 'EACCES') {
      res.status(403).json({ error: 'Permission denied' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Serve binary file content endpoint (for images, etc.)
app.get('/api/projects/:projectName/files/content', async (req, res) => {
  try {
    const { projectName } = req.params;
    const { path: filePath } = req.query;
    
    console.log('🖼️ Binary file serve request:', projectName, filePath);
    
    const fs = require('fs');
    const mime = require('mime-types');
    
    // Security check - ensure the path is safe and absolute
    if (!filePath || !path.isAbsolute(filePath)) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    
    // Check if file exists
    try {
      await fs.promises.access(filePath);
    } catch (error) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Get file extension and set appropriate content type
    const mimeType = mime.lookup(filePath) || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    
    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
    fileStream.on('error', (error) => {
      console.error('Error streaming file:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error reading file' });
      }
    });
    
  } catch (error) {
    console.error('Error serving binary file:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// Save file content endpoint
app.put('/api/projects/:projectName/file', async (req, res) => {
  try {
    const { projectName } = req.params;
    const { filePath, content } = req.body;
    
    console.log('💾 File save request:', projectName, filePath);
    
    const fs = require('fs').promises;
    
    // Security check - ensure the path is safe and absolute
    if (!filePath || !path.isAbsolute(filePath)) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    
    if (content === undefined) {
      return res.status(400).json({ error: 'Content is required' });
    }
    
    // Create backup of original file
    try {
      const backupPath = filePath + '.backup.' + Date.now();
      await fs.copyFile(filePath, backupPath);
      console.log('📋 Created backup:', backupPath);
    } catch (backupError) {
      console.warn('Could not create backup:', backupError.message);
    }
    
    // Write the new content
    await fs.writeFile(filePath, content, 'utf8');
    
    res.json({ 
      success: true, 
      path: filePath,
      message: 'File saved successfully' 
    });
  } catch (error) {
    console.error('Error saving file:', error);
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'File or directory not found' });
    } else if (error.code === 'EACCES') {
      res.status(403).json({ error: 'Permission denied' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

app.get('/api/projects/:projectName/files', async (req, res) => {
  try {
    
    const fs = require('fs').promises;
    
    // Use extractProjectDirectory to get the actual project path
    let actualPath;
    try {
      actualPath = await extractProjectDirectory(req.params.projectName);
    } catch (error) {
      console.error('Error extracting project directory:', error);
      // Fallback to simple dash replacement
      actualPath = req.params.projectName.replace(/-/g, '/');
    }
    
    // Check if path exists
    try {
      await fs.access(actualPath);
    } catch (e) {
      return res.status(404).json({ error: `Project path not found: ${actualPath}` });
    }
    
    const files = await getFileTree(actualPath, 3, 0, true);
    const hiddenFiles = files.filter(f => f.name.startsWith('.'));
    res.json(files);
  } catch (error) {
    console.error('❌ File tree error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// WebSocket connection handler that routes based on URL path
wss.on('connection', (ws, request) => {
  const url = request.url;
  console.log('🔗 Client connected to:', url);
  
  if (url === '/shell') {
    handleShellConnection(ws);
  } else if (url === '/ws') {
    handleChatConnection(ws);
  } else {
    console.log('❌ Unknown WebSocket path:', url);
    ws.close();
  }
});

// Handle chat WebSocket connections
function handleChatConnection(ws) {
  console.log('💬 Chat WebSocket connected');
  
  // Add to connected clients for project updates
  connectedClients.add(ws);
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'claude-command') {
        console.log('💬 User message:', data.command || '[Continue/Resume]');
        console.log('📁 Project:', data.options?.projectPath || 'Unknown');
        console.log('🔄 Session:', data.options?.sessionId ? 'Resume' : 'New');
        await spawnClaude(data.command, data.options, ws);
      } else if (data.type === 'abort-session') {
        console.log('🛑 Abort session request:', data.sessionId);
        const success = abortClaudeSession(data.sessionId);
        ws.send(JSON.stringify({
          type: 'session-aborted',
          sessionId: data.sessionId,
          success
        }));
      } else if (data.type === 'truncate_messages') {
        console.log('✂️ Truncate messages request:', data.data);
        
        try {
          const { checkpointId, messageCount, projectName, sessionId } = data.data;
          
          if (!projectName || !sessionId || !checkpointId || !messageCount) {
            throw new Error('Missing required truncation parameters');
          }
          
          // Perform server-side truncation
          const { truncateSessionMessages } = require('./projects');
          const result = await truncateSessionMessages(projectName, sessionId, checkpointId, messageCount);
          
          ws.send(JSON.stringify({
            type: 'messages-truncated',
            checkpointId: checkpointId,
            messageCount: messageCount,
            truncatedCount: result.truncated,
            filesModified: result.files,
            success: true
          }));
          
        } catch (truncateError) {
          console.error('❌ Truncation error:', truncateError.message);
          ws.send(JSON.stringify({
            type: 'messages-truncated',
            checkpointId: data.data.checkpointId,
            messageCount: data.data.messageCount,
            success: false,
            error: truncateError.message
          }));
        }
      }
    } catch (error) {
      console.error('❌ Chat WebSocket error:', error.message);
      ws.send(JSON.stringify({
        type: 'error',
        error: error.message
      }));
    }
  });
  
  ws.on('close', () => {
    console.log('🔌 Chat client disconnected');
    // Remove from connected clients
    connectedClients.delete(ws);
  });
}

// Handle shell WebSocket connections
function handleShellConnection(ws) {
  console.log('🐚 Shell client connected');
  let shellProcess = null;
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      console.log('📨 Shell message received:', data.type);
      
      if (data.type === 'init') {
        // Initialize shell with project path and session info
        const projectPath = data.projectPath || process.cwd();
        const sessionId = data.sessionId;
        const hasSession = data.hasSession;
        
        console.log('🚀 Starting shell in:', projectPath);
        console.log('📋 Session info:', hasSession ? `Resume session ${sessionId}` : 'New session');
        
        // First send a welcome message
        const welcomeMsg = hasSession ? 
          `\x1b[36mResuming Claude session ${sessionId} in: ${projectPath}\x1b[0m\r\n` :
          `\x1b[36mStarting new Claude session in: ${projectPath}\x1b[0m\r\n`;
        
        ws.send(JSON.stringify({
          type: 'output',
          data: welcomeMsg
        }));
        
        try {
          // Build shell command that changes to project directory first, then runs claude
          let claudeCommand = 'claude';
          
          if (hasSession && sessionId) {
            // Try to resume session, but with fallback to new session if it fails
            claudeCommand = `claude --resume ${sessionId} || claude`;
          }
          
          // Create shell command that cds to the project directory first
          const shellCommand = `cd "${projectPath}" && ${claudeCommand}`;
          
          console.log('🔧 Executing shell command:', shellCommand);
          
          // Start shell using PTY for proper terminal emulation
          shellProcess = pty.spawn('bash', ['-c', shellCommand], {
            name: 'xterm-256color',
            cols: 80,
            rows: 24,
            cwd: process.env.HOME || '/', // Start from home directory
            env: { 
              ...process.env,
              TERM: 'xterm-256color',
              COLORTERM: 'truecolor',
              FORCE_COLOR: '3',
              // Override browser opening commands to echo URL for detection
              BROWSER: 'echo "OPEN_URL:"'
            }
          });
          
          console.log('🟢 Shell process started with PTY, PID:', shellProcess.pid);
          
          // Handle data output
          shellProcess.onData((data) => {
            if (ws.readyState === ws.OPEN) {
              let outputData = data;
              
              // Check for various URL opening patterns
              const patterns = [
                // Direct browser opening commands
                /(?:xdg-open|open|start)\s+(https?:\/\/[^\s\x1b\x07]+)/g,
                // BROWSER environment variable override
                /OPEN_URL:\s*(https?:\/\/[^\s\x1b\x07]+)/g,
                // Git and other tools opening URLs
                /Opening\s+(https?:\/\/[^\s\x1b\x07]+)/gi,
                // General URL patterns that might be opened
                /Visit:\s*(https?:\/\/[^\s\x1b\x07]+)/gi,
                /View at:\s*(https?:\/\/[^\s\x1b\x07]+)/gi,
                /Browse to:\s*(https?:\/\/[^\s\x1b\x07]+)/gi
              ];
              
              patterns.forEach(pattern => {
                let match;
                while ((match = pattern.exec(data)) !== null) {
                  const url = match[1];
                  console.log('🔗 Detected URL for opening:', url);
                  
                  // Send URL opening message to client
                  ws.send(JSON.stringify({
                    type: 'url_open',
                    url: url
                  }));
                  
                  // Replace the OPEN_URL pattern with a user-friendly message
                  if (pattern.source.includes('OPEN_URL')) {
                    outputData = outputData.replace(match[0], `🌐 Opening in browser: ${url}`);
                  }
                }
              });
              
              // Send regular output
              ws.send(JSON.stringify({
                type: 'output',
                data: outputData
              }));
            }
          });
          
          // Handle process exit
          shellProcess.onExit((exitCode) => {
            console.log('🔚 Shell process exited with code:', exitCode.exitCode, 'signal:', exitCode.signal);
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({
                type: 'output',
                data: `\r\n\x1b[33mProcess exited with code ${exitCode.exitCode}${exitCode.signal ? ` (${exitCode.signal})` : ''}\x1b[0m\r\n`
              }));
            }
            shellProcess = null;
          });
          
        } catch (spawnError) {
          console.error('❌ Error spawning process:', spawnError);
          ws.send(JSON.stringify({
            type: 'output',
            data: `\r\n\x1b[31mError: ${spawnError.message}\x1b[0m\r\n`
          }));
        }
        
      } else if (data.type === 'input') {
        // Send input to shell process
        if (shellProcess && shellProcess.write) {
          try {
            shellProcess.write(data.data);
          } catch (error) {
            console.error('Error writing to shell:', error);
          }
        } else {
          console.warn('No active shell process to send input to');
        }
      } else if (data.type === 'resize') {
        // Handle terminal resize
        if (shellProcess && shellProcess.resize) {
          console.log('Terminal resize requested:', data.cols, 'x', data.rows);
          shellProcess.resize(data.cols, data.rows);
        }
      }
    } catch (error) {
      console.error('❌ Shell WebSocket error:', error.message);
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'output',
          data: `\r\n\x1b[31mError: ${error.message}\x1b[0m\r\n`
        }));
      }
    }
  });
  
  ws.on('close', () => {
    console.log('🔌 Shell client disconnected');
    if (shellProcess && shellProcess.kill) {
      console.log('🔴 Killing shell process:', shellProcess.pid);
      shellProcess.kill();
    }
  });
  
  ws.on('error', (error) => {
    console.error('❌ Shell WebSocket error:', error);
  });
}
// Audio transcription endpoint
app.post('/api/transcribe', async (req, res) => {
  try {
    const multer = require('multer');
    const upload = multer({ storage: multer.memoryStorage() });
    
    // Handle multipart form data
    upload.single('audio')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: 'Failed to process audio file' });
      }
      
      if (!req.file) {
        return res.status(400).json({ error: 'No audio file provided' });
      }
      
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'OpenAI API key not configured. Please set OPENAI_API_KEY in server environment.' });
      }
      
      try {
        // Create form data for OpenAI
        const FormData = require('form-data');
        const formData = new FormData();
        formData.append('file', req.file.buffer, {
          filename: req.file.originalname,
          contentType: req.file.mimetype
        });
        formData.append('model', 'whisper-1');
        formData.append('response_format', 'json');
        formData.append('language', 'en');
        
        // Make request to OpenAI
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            ...formData.getHeaders()
          },
          body: formData
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error?.message || `Whisper API error: ${response.status}`);
        }
        
        const data = await response.json();
        let transcribedText = data.text || '';
        
        // Check if enhancement mode is enabled
        const mode = req.body.mode || 'default';
        
        // If no transcribed text, return empty
        if (!transcribedText) {
          return res.json({ text: '' });
        }
        
        // If default mode, return transcribed text without enhancement
        if (mode === 'default') {
          return res.json({ text: transcribedText });
        }
        
        // Handle different enhancement modes
        try {
          const OpenAI = require('openai');
          const openai = new OpenAI({ apiKey });
          
          let prompt, systemMessage, temperature = 0.7, maxTokens = 800;
          
          switch (mode) {
            case 'prompt':
              systemMessage = 'You are an expert prompt engineer who creates clear, detailed, and effective prompts.';
              prompt = `You are an expert prompt engineer. Transform the following rough instruction into a clear, detailed, and context-aware AI prompt.

Your enhanced prompt should:
1. Be specific and unambiguous
2. Include relevant context and constraints
3. Specify the desired output format
4. Use clear, actionable language
5. Include examples where helpful
6. Consider edge cases and potential ambiguities

Transform this rough instruction into a well-crafted prompt:
"${transcribedText}"

Enhanced prompt:`;
              break;
              
            case 'vibe':
            case 'instructions':
            case 'architect':
              systemMessage = 'You are a helpful assistant that formats ideas into clear, actionable instructions for AI agents.';
              temperature = 0.5; // Lower temperature for more controlled output
              prompt = `Transform the following idea into clear, well-structured instructions that an AI agent can easily understand and execute.

IMPORTANT RULES:
- Format as clear, step-by-step instructions
- Add reasonable implementation details based on common patterns
- Only include details directly related to what was asked
- Do NOT add features or functionality not mentioned
- Keep the original intent and scope intact
- Use clear, actionable language an agent can follow

Transform this idea into agent-friendly instructions:
"${transcribedText}"

Agent instructions:`;
              break;
              
            default:
              // No enhancement needed
              break;
          }
          
          // Only make GPT call if we have a prompt
          if (prompt) {
            const completion = await openai.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [
                { role: 'system', content: systemMessage },
                { role: 'user', content: prompt }
              ],
              temperature: temperature,
              max_tokens: maxTokens
            });
            
            transcribedText = completion.choices[0].message.content || transcribedText;
          }
          
        } catch (gptError) {
          console.error('GPT processing error:', gptError);
          // Fall back to original transcription if GPT fails
        }
        
        res.json({ text: transcribedText });
        
      } catch (error) {
        console.error('Transcription error:', error);
        res.status(500).json({ error: error.message });
      }
    });
  } catch (error) {
    console.error('Endpoint error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Serve React app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

async function getFileTree(dirPath, maxDepth = 3, currentDepth = 0, showHidden = true) {
  const fs = require('fs').promises;
  const items = [];
  
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      // Debug: log all entries including hidden files
   
      
      // Skip only heavy build directories
      if (entry.name === 'node_modules' || 
          entry.name === 'dist' || 
          entry.name === 'build') continue;
      
      const item = {
        name: entry.name,
        path: path.join(dirPath, entry.name),
        type: entry.isDirectory() ? 'directory' : 'file'
      };
      
      if (entry.isDirectory() && currentDepth < maxDepth) {
        // Recursively get subdirectories but limit depth
        try {
          // Check if we can access the directory before trying to read it
          await fs.access(item.path, fs.constants.R_OK);
          item.children = await getFileTree(item.path, maxDepth, currentDepth + 1, showHidden);
        } catch (e) {
          // Silently skip directories we can't access (permission denied, etc.)
          item.children = [];
        }
      }
      
      items.push(item);
    }
  } catch (error) {
    // Only log non-permission errors to avoid spam
    if (error.code !== 'EACCES' && error.code !== 'EPERM') {
      console.error('Error reading directory:', error);
    }
  }
  
  return items.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Claude Code UI server running on http://0.0.0.0:${PORT}`);
  
  // Clear project directory cache to ensure fresh decoding with updated logic
  clearProjectDirectoryCache();
  
  // Start watching the projects folder for changes
  setupProjectsWatcher();
});