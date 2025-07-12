const { spawn } = require('child_process');
const os = require('os');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

let activeClaudeProcesses = new Map(); // Track active processes by session ID
let claudeCommand = null; // Cache the claude command setup

// Detect how to run Claude CLI (native or via WSL)
function getClaudeCommand() {
  if (claudeCommand !== null) {
    return claudeCommand;
  }
  
  try {
    // First try native Claude CLI
    execSync('claude --help', { stdio: 'ignore' });
    claudeCommand = { command: 'claude', args: [], useWSL: false };

    return claudeCommand;
  } catch (error) {
    // If native doesn't work, try WSL
    if (os.platform() === 'win32') {
      try {
        execSync('wsl which claude', { stdio: 'ignore' });
        claudeCommand = { command: 'wsl', args: ['claude'], useWSL: true };
  
        return claudeCommand;
      } catch (wslError) {
        console.error('❌ Claude CLI not found natively or in WSL');
        claudeCommand = { command: null, args: [], useWSL: false };
        return claudeCommand;
      }
    } else {
      console.error('❌ Claude CLI not found');
      claudeCommand = { command: null, args: [], useWSL: false };
      return claudeCommand;
    }
  }
}

// Convert Windows path to WSL path if needed
function convertPathForWSL(path, useWSL) {
  if (!useWSL || os.platform() !== 'win32') {
    return path;
  }
  
  // Convert Windows path like D:\Projects\... to /mnt/d/Projects/...
  if (path.match(/^[A-Z]:\\/)) {
    const drive = path[0].toLowerCase();
    const restPath = path.slice(3).replace(/\\/g, '/');
    return `/mnt/${drive}/${restPath}`;
  }
  
  return path;
}

async function spawnClaude(command, options = {}, ws) {
  return new Promise(async (resolve, reject) => {
    const { sessionId, projectName, projectPath, cwd, resume, toolsSettings, conversationContext } = options;
    let capturedSessionId = sessionId; // Track session ID throughout the process
    let sessionCreatedSent = false; // Track if we've already sent session-created event
    
    // Use tools settings passed from frontend, or defaults
    const settings = toolsSettings || {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false
    };
  
    // Build Claude CLI command - start with resume flags first
    const args = [];
    
    // Add resume flag if resuming (but not for temporary sessions)
    if (resume && sessionId && !sessionId.startsWith('temp-')) {
      args.push('--resume', sessionId);
      
      // Debug: Check if session file exists
      const fs = require('fs');
      const path = require('path');
      const sessionDir = path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'projects', projectName);
      const sessionFile = path.join(sessionDir, `${sessionId}.jsonl`);
      
      try {
        if (fs.existsSync(sessionFile)) {
          console.log(`✅ Session file exists: ${sessionFile}`);
        } else {
          console.log(`❌ Session file does not exist: ${sessionFile}`);
          console.log(`🔍 Session directory: ${sessionDir}`);
          console.log(`🔍 Available files in session directory:`, fs.readdirSync(sessionDir).filter(f => f.endsWith('.jsonl')));
        }
      } catch (error) {
        console.log(`❌ Error checking session file: ${error.message}`);
      }
    }
    console.log(`🔍 Resume decision - resume: ${resume}, sessionId: ${sessionId}, isTemporary: ${sessionId && sessionId.startsWith('temp-')}, willResume: ${resume && sessionId && !sessionId.startsWith('temp-')}`);
    
    // Always use interactive mode via stdin to ensure session persistence
    // The --print flag disables session persistence, so we avoid it entirely
    
    // Add basic flags
    args.push('--output-format', 'stream-json', '--verbose');
    
    // Add model for new sessions
    if (!resume) {
      args.push('--model', 'sonnet');
    }
    
    // Add tools settings flags
    if (settings.skipPermissions) {
      args.push('--dangerously-skip-permissions');
      console.log('⚠️  Using --dangerously-skip-permissions (skipping other tool settings)');
    } else {
      // Only add allowed/disallowed tools if not skipping permissions
      // Add allowed tools
      if (settings.allowedTools && settings.allowedTools.length > 0) {
        for (const tool of settings.allowedTools) {
          args.push('--allowedTools', tool);
          console.log('✅ Allowing tool:', tool);
        }
      }
      
      // Add disallowed tools
      if (settings.disallowedTools && settings.disallowedTools.length > 0) {
        for (const tool of settings.disallowedTools) {
          args.push('--disallowedTools', tool);
          console.log('❌ Disallowing tool:', tool);
        }
      }
    }
    
    // Get Claude command configuration (native or WSL)
    const claudeConfig = getClaudeCommand();
    
    if (!claudeConfig.command) {
      const error = new Error('Claude CLI not found. Please install Claude CLI or ensure it\'s available in WSL.');
      ws.send(JSON.stringify({
        type: 'claude-error',
        error: error.message
      }));
      throw error;
    }
    
    // Use cwd (actual project directory) instead of projectPath (Claude's metadata directory)
    const workingDir = convertPathForWSL(cwd || process.cwd(), claudeConfig.useWSL);

    // Debug logging
    console.log('🔍 spawnClaude called with:', {
      projectName,
      projectPath,
      cwd,
      workingDir,
      sessionId,
      resume
    });

    // Determine project name to use
    let encodedProjectName;
    if (projectName) {
      // Trust the provided project name (for renamed projects)
      encodedProjectName = projectName;
      console.log(`📁 Using provided project name: ${encodedProjectName}`);
    } else {
      // Generate the project name using consistent encoding
      // Use the same encoding as addProjectManually: spaces -> underscores, slashes -> hyphens
      encodedProjectName = workingDir;
      // Remove leading slash to avoid issues with directory names starting with '-'
      if (encodedProjectName.startsWith('/')) {
        encodedProjectName = encodedProjectName.substring(1);
      }
      encodedProjectName = encodedProjectName.replace(/\//g, '-').replace(/\s+/g, '_');
      console.log(`📁 Generated project name from path: ${encodedProjectName}`);
    }

    // Let Claude CLI handle ALL directory creation
    // Claude CLI will create its own project directory based on the working directory
    console.log(`📁 Generated project name: ${encodedProjectName} - letting Claude CLI handle directory creation`);
    
    // Build final command args
    const finalArgs = [...claudeConfig.args, ...args];
    
    console.log('Spawning Claude CLI:', claudeConfig.command, finalArgs.map(arg => {
      const cleanArg = arg.replace(/\n/g, '\\n').replace(/\r/g, '\\r');
      return cleanArg.includes(' ') ? `"${cleanArg}"` : cleanArg;
    }).join(' '));
    console.log('Working directory:', workingDir);
    console.log('Using WSL:', claudeConfig.useWSL);
    console.log('Session info - Input sessionId:', sessionId, 'Resume:', resume, 'IsTemporary:', sessionId && sessionId.startsWith('temp-'));
  
    console.log('🗂️ Conversation context:', conversationContext);
    
    
    
    const spawnOptions = {
      cwd: claudeConfig.useWSL ? undefined : workingDir, // WSL handles cwd differently
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env } // Inherit all environment variables
    };
    
    // For WSL, we need to change directory within the WSL command
    let claudeProcess;
    if (claudeConfig.useWSL) {
      // Use WSL with cd command to change directory before running claude
      const wslCommand = `cd "${workingDir}" && claude ${finalArgs.slice(1).map(arg => {
        // Escape arguments for shell
        if (arg.includes(' ') || arg.includes('"')) {
          return `"${arg.replace(/"/g, '\\"')}"`;
        }
        return arg;
      }).join(' ')}`;
      
      claudeProcess = spawn('wsl', ['bash', '-c', wslCommand], spawnOptions);
    } else {
      claudeProcess = spawn(claudeConfig.command, finalArgs, spawnOptions);
    }
    
    // Store process reference for potential abort
    const processKey = capturedSessionId || sessionId || Date.now().toString();
    activeClaudeProcesses.set(processKey, claudeProcess);
    
    // Handle stdout (streaming JSON responses)
    claudeProcess.stdout.on('data', (data) => {
      const rawOutput = data.toString();
      
      const lines = rawOutput.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        try {
          const response = JSON.parse(line);
          
          // Debug: log the response to see what fields are available
          if (response && typeof response === 'object') {
            console.log('🔍 Claude CLI response keys:', Object.keys(response));
            if (response.type) {
              console.log('🔍 Response type:', response.type);
            }
          }
          
          // Capture session ID if it's in the response (try multiple possible field names)
          const possibleSessionId = response.session_id || response.sessionId || response.session || response.id;
          console.log(`🔍 Session ID check - response.session_id: ${response.session_id}, possibleSessionId: ${possibleSessionId}, capturedSessionId: ${capturedSessionId}`);
          if (possibleSessionId && (!capturedSessionId || capturedSessionId.startsWith('temp-'))) {
            capturedSessionId = possibleSessionId;
            console.log(`🎯 Captured session ID from Claude output: ${capturedSessionId}`);
            
            // Update process key with captured session ID
            if (processKey !== capturedSessionId) {
              activeClaudeProcesses.delete(processKey);
              activeClaudeProcesses.set(capturedSessionId, claudeProcess);
            }
            
            // Send session-created event for new sessions (including temporary ones becoming real)
            if ((!sessionId || sessionId.startsWith('temp-')) && !sessionCreatedSent) {
              sessionCreatedSent = true;
              console.log(`🎉 Sending session-created event: ${capturedSessionId} (replaces: ${sessionId && sessionId.startsWith('temp-') ? sessionId : 'none'})`);
              ws.send(JSON.stringify({
                type: 'session-created',
                sessionId: capturedSessionId,
                replacesTemporary: sessionId && sessionId.startsWith('temp-') ? sessionId : null,
                conversationContext: conversationContext // Include conversation context
              }));
              
              // Force immediate project update to ensure new session appears in sidebar quickly
              // This bypasses the file system watcher debounce for immediate feedback
              setTimeout(async () => {
                try {
                  const { getProjects } = require('./projects');
                  const updatedProjects = await getProjects();
                  
                  // Send immediate project update via WebSocket to this client
                  const updateMessage = JSON.stringify({
                    type: 'projects_updated',
                    projects: updatedProjects,
                    timestamp: new Date().toISOString(),
                    changeType: 'session-created',
                    sessionId: capturedSessionId
                  });
                  
                  if (ws.readyState === ws.OPEN) {
                    ws.send(updateMessage);
                  }
                } catch (error) {
                  console.error('❌ Error sending immediate project update:', error);
                }
              }, 50); // Very short delay to ensure session file is written
            } else if (sessionCreatedSent) {
              console.log(`ℹ️  Session-created event already sent for: ${capturedSessionId}`);
            }
          }
          
          // Send parsed response to WebSocket
          ws.send(JSON.stringify({
            type: 'claude-response',
            data: response
          }));
        } catch (parseError) {
          // If not JSON, send as raw text but also log it for debugging
          console.log('🔍 Claude CLI raw output:', line);
          ws.send(JSON.stringify({
            type: 'claude-output',
            data: line
          }));
        }
      }
    });
    
    // Handle stderr
    claudeProcess.stderr.on('data', (data) => {
      console.error('Claude CLI stderr:', data.toString());
      ws.send(JSON.stringify({
        type: 'claude-error',
        error: data.toString()
      }));
    });
    
    // Handle process completion
    claudeProcess.on('close', (code) => {
      console.log(`Claude CLI process exited with code ${code}`);
      
      // Verify session file creation after process exit and capture session ID if not already captured
      if (code === 0 && command && command.trim()) {
        setTimeout(async () => {
          try {
            const projectsDir = path.join(process.env.HOME || '', '.claude', 'projects');
            const fs = require('fs').promises;
            
            // Instead of using our expected project name, scan all project directories
            // to find the one Claude CLI actually created for this working directory
            console.log('🔍 Session verification - scanning for Claude CLI-generated project directories');
            
            let foundProjectDir = null;
            let capturedSessionIdFromScan = null;
            
            try {
              // Get all project directories
              const allEntries = await fs.readdir(projectsDir, { withFileTypes: true });
              const projectDirs = allEntries
                .filter(entry => entry.isDirectory())
                .map(entry => entry.name);
              
              console.log('🔍 Available project directories:', projectDirs);
              
              // Look for recently modified session files that contain our command
              for (const projectDirName of projectDirs) {
                try {
                  const projectPath = path.join(projectsDir, projectDirName);
                  const files = await fs.readdir(projectPath);
                  const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
                  
                  for (const file of jsonlFiles) {
                    const filePath = path.join(projectPath, file);
                    const stats = await fs.stat(filePath);
                    
                    // Only check files modified in the last 30 seconds (recent session)
                    const now = new Date();
                    const timeDiff = now - stats.mtime;
                    if (timeDiff < 30000) { // 30 seconds
                      const fileContent = await fs.readFile(filePath, 'utf8');
                      if (fileContent.includes(command.trim())) {
                        foundProjectDir = projectDirName;
                        capturedSessionIdFromScan = file.replace('.jsonl', '');
                        console.log(`🎯 Found matching session in project directory: ${foundProjectDir}`);
                        console.log(`🎯 Captured session ID from scan: ${capturedSessionIdFromScan}`);
                        break;
                      }
                    }
                  }
                  
                  if (foundProjectDir) break;
                } catch (projectError) {
                  // Skip directories we can't access
                  continue;
                }
              }
              
              // If we found a matching session, use it
              console.log(`🔍 Session verification decision - foundProjectDir: ${!!foundProjectDir}, capturedSessionIdFromScan: ${!!capturedSessionIdFromScan}, capturedSessionId: ${capturedSessionId}`);
              if (foundProjectDir && capturedSessionIdFromScan && (!capturedSessionId || capturedSessionId.startsWith('temp-'))) {
                capturedSessionId = capturedSessionIdFromScan;
                console.log(`✅ Session verification successful using directory: ${foundProjectDir}`);
                
                // Send session-created event if not already sent
                if (!sessionCreatedSent) {
                  sessionCreatedSent = true;
                  console.log(`🎉 Sending session-created event (verification path): ${capturedSessionId} (replaces: ${sessionId && sessionId.startsWith('temp-') ? sessionId : 'none'})`);
                  ws.send(JSON.stringify({
                    type: 'session-created',
                    sessionId: capturedSessionId,
                    replacesTemporary: sessionId && sessionId.startsWith('temp-') ? sessionId : null,
                    conversationContext: conversationContext
                  }));
                  
                  // Send immediate project update
                  setTimeout(async () => {
                    try {
                      const { getProjects } = require('./projects');
                      const updatedProjects = await getProjects();
                      
                      const updateMessage = JSON.stringify({
                        type: 'projects_updated',
                        projects: updatedProjects,
                        timestamp: new Date().toISOString(),
                        changeType: 'session-created',
                        sessionId: capturedSessionId
                      });
                      
                      if (ws.readyState === ws.OPEN) {
                        ws.send(updateMessage);
                      }
                    } catch (error) {
                      console.error('❌ Error sending delayed project update:', error);
                    }
                  }, 100);
                }
              } else {
                if (capturedSessionId && !capturedSessionId.startsWith('temp-')) {
                  console.log('✅ Session already captured from Claude CLI output, verification complete');
                } else {
                  console.warn('⚠️  No matching session found in any project directory');
                }
              }
              
            } catch (scanError) {
              console.warn('⚠️  Could not scan project directories for session verification:', scanError.message);
            }
            
          } catch (error) {
            console.warn('⚠️  Session verification failed:', error.message);
          }
        }, 1000); // Wait 1 second for files to be written
      }
      
      // Clean up process reference
      const finalSessionId = capturedSessionId || sessionId || processKey;
      activeClaudeProcesses.delete(finalSessionId);
      
      ws.send(JSON.stringify({
        type: 'claude-complete',
        exitCode: code,
        isNewSession: !sessionId && !!command // Flag to indicate this was a new session
      }));
      
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Claude CLI exited with code ${code}`));
      }
    });
    
    // Handle process errors
    claudeProcess.on('error', (error) => {
      console.error('Claude CLI process error:', error);
      
      // Clean up process reference on error
      const finalSessionId = capturedSessionId || sessionId || processKey;
      activeClaudeProcesses.delete(finalSessionId);
      
      ws.send(JSON.stringify({
        type: 'claude-error',
        error: error.message
      }));
      
      reject(error);
    });
    
    // Always use interactive mode - write commands to stdin for both new and resumed sessions
    if (command && command.trim()) {
      // Write the command to stdin for interactive mode (works for both new and resumed sessions)
      claudeProcess.stdin.write(command + '\n');
      
      // Close stdin after a brief delay to allow Claude CLI to process the command
      // This signals end of input while still using interactive mode for session persistence
      setTimeout(() => {
        if (claudeProcess.stdin && !claudeProcess.stdin.destroyed) {
          claudeProcess.stdin.end();
        }
      }, 100); // 100ms delay should be enough for Claude to start processing
    } else {
      // No command provided, end stdin to allow interactive use
      claudeProcess.stdin.end();
    }
  });
}

function abortClaudeSession(sessionId) {
  const process = activeClaudeProcesses.get(sessionId);
  if (process) {
    console.log(`🛑 Aborting Claude session: ${sessionId}`);
    
    // For WSL processes, we need to be more aggressive with termination
    const claudeConfig = getClaudeCommand();
    if (claudeConfig && claudeConfig.useWSL) {
      // Kill the WSL process and any child processes
      try {
        process.kill('SIGKILL');
      } catch (error) {
        console.warn('Error killing WSL process:', error.message);
      }
    } else {
      process.kill('SIGTERM');
    }
    
    activeClaudeProcesses.delete(sessionId);
    return true;
  }
  return false;
}

module.exports = {
  spawnClaude,
  abortClaudeSession
};