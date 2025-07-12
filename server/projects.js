const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');

// Cache for extracted project directories
const projectDirectoryCache = new Map();
let cacheTimestamp = Date.now();

// Clear cache when needed (called when project files change)
function clearProjectDirectoryCache() {
  projectDirectoryCache.clear();
  cacheTimestamp = Date.now();
}

// Load project configuration file
async function loadProjectConfig() {
  const configPath = path.join(process.env.HOME, '.claude', 'project-config.json');
  try {
    const configData = await fs.readFile(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    // Return empty config if file doesn't exist
    return {};
  }
}

// Save project configuration file
async function saveProjectConfig(config) {
  const configPath = path.join(process.env.HOME, '.claude', 'project-config.json');
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}

// Generate better display name from path
async function generateDisplayName(projectName, actualProjectDir = null) {
  // Use actual project directory if provided, otherwise decode from project name
  let projectPath = actualProjectDir || projectName.replace(/-/g, '/');
  
  // Try to read package.json from the project path
  try {
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageData = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageData);
    
    // Return the name from package.json if it exists
    if (packageJson.name) {
      return packageJson.name;
    }
  } catch (error) {
    // Fall back to path-based naming if package.json doesn't exist or can't be read
  }
  
  // If it starts with /, it's an absolute path
  if (projectPath.startsWith('/')) {
    const parts = projectPath.split('/').filter(Boolean);
    if (parts.length > 3) {
      // Show last 2 folders with ellipsis: "...projects/myapp"
      return `.../${parts.slice(-2).join('/')}`;
    } else {
      // Show full path if short: "/home/user"
      return projectPath;
    }
  }
  
  return projectPath;
}

// Smart decode project name from encoded format, handling spaces properly
function smartDecodeProjectName(projectName) {
  // Consistent encoding scheme: Forward slashes (/) -> hyphens (-), Spaces -> hyphens (-)
  // All projects now use the same encoding as Claude CLI
  
  console.log(`🔍 Decoding project name: ${projectName}`);
  
  // Remove leading hyphen if present (all projects have this now)
  let workingName = projectName.startsWith('-') ? projectName.substring(1) : projectName;
  
  // Split by hyphens to get path segments
  const segments = workingName.split('-');
  
  // Strategy: Look for patterns of consecutive capitalized words that likely form directory names
  // Single letters (like 'd') are separate path segments
  // Single capitalized words (like 'Projects') are separate path segments  
  // Pairs of capitalized words (like 'Jetset' + 'Health') become space-separated directory names
  // Multi-letter lowercase words are combined with hyphens
  
  let result = [];
  let i = 0;
  
  while (i < segments.length) {
    const segment = segments[i];
    
    // Single letter parts are always separate path segments
    if (segment.length === 1) {
      result.push(segment);
      i++;
      continue;
    }
    
    if (segment.length > 1 && segment[0] >= 'A' && segment[0] <= 'Z') {
      // This is a multi-letter capitalized part
      // Collect all consecutive capitalized parts to analyze the pattern
      let capitalizedGroup = [segment];
      let lookahead = i + 1;
      
      while (lookahead < segments.length && 
             segments[lookahead].length > 1 && 
             segments[lookahead][0] >= 'A' && segments[lookahead][0] <= 'Z') {
        capitalizedGroup.push(segments[lookahead]);
        lookahead++;
      }
      
      if (capitalizedGroup.length === 1) {
        // Single capitalized word - separate path segment
        result.push(capitalizedGroup[0]);
        i++;
      } else if (capitalizedGroup.length === 2) {
        // Exactly 2 capitalized words - combine with space (directory name)
        result.push(capitalizedGroup[0] + ' ' + capitalizedGroup[1]);
        i += 2;
      } else {
        // 3+ capitalized words - treat all but the last 2 as separate segments,
        // and combine the last 2 as a directory name
        // e.g., ['Projects', 'Jetset', 'Health'] → 'Projects' + 'Jetset Health'
        for (let j = 0; j < capitalizedGroup.length - 2; j++) {
          result.push(capitalizedGroup[j]);
        }
        // Combine the last 2
        const lastTwo = capitalizedGroup.slice(-2);
        result.push(lastTwo[0] + ' ' + lastTwo[1]);
        i += capitalizedGroup.length;
      }
    } else {
      // This is a multi-letter lowercase part - collect all consecutive multi-letter lowercase parts
      let lowercaseGroup = [segment];
      while (i + 1 < segments.length && 
             segments[i + 1].length > 1 && 
             segments[i + 1][0] >= 'a' && segments[i + 1][0] <= 'z') {
        i++;
        lowercaseGroup.push(segments[i]);
      }
      
      // Join lowercase parts with hyphens
      result.push(lowercaseGroup.join('-'));
      i++;
    }
  }
  
  // Join with slashes and add leading slash
  let decoded = '/' + result.join('/');
  
  console.log(`🔍 Decoded: ${projectName} → ${decoded}`);
  return decoded;
}

// Extract the actual project directory from JSONL sessions (with caching)
async function extractProjectDirectory(projectName) {
  // Check cache first
  if (projectDirectoryCache.has(projectName)) {
    return projectDirectoryCache.get(projectName);
  }
  

  
  // First check if we have the original path stored in project config
  const config = await loadProjectConfig();
  if (config[projectName] && config[projectName].originalPath) {
    projectDirectoryCache.set(projectName, config[projectName].originalPath);
    return config[projectName].originalPath;
  }
  
  const projectDir = path.join(process.env.HOME, '.claude', 'projects', projectName);
  const cwdCounts = new Map();
  let latestTimestamp = 0;
  let latestCwd = null;
  let extractedPath;
  
  try {
    let files;
    try {
      files = await fs.readdir(projectDir);
    } catch (readdirError) {
      if (readdirError.code === 'ENOENT') {
        // Project directory doesn't exist yet (normal for new projects or placeholder sessions)
        extractedPath = smartDecodeProjectName(projectName);
        projectDirectoryCache.set(projectName, extractedPath);
        return extractedPath;
      }
      throw readdirError; // Re-throw other errors
    }
    
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));
    
    if (jsonlFiles.length === 0) {
      // Fall back to smart decoded project name if no sessions
      extractedPath = smartDecodeProjectName(projectName);
    } else {
      // Process all JSONL files to collect cwd values
      for (const file of jsonlFiles) {
        const jsonlFile = path.join(projectDir, file);
        const fileStream = require('fs').createReadStream(jsonlFile);
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity
        });
        
        for await (const line of rl) {
          if (line.trim()) {
            try {
              const entry = JSON.parse(line);
              
              if (entry.cwd) {
                // Count occurrences of each cwd
                cwdCounts.set(entry.cwd, (cwdCounts.get(entry.cwd) || 0) + 1);
                
                // Track the most recent cwd
                const timestamp = new Date(entry.timestamp || 0).getTime();
                if (timestamp > latestTimestamp) {
                  latestTimestamp = timestamp;
                  latestCwd = entry.cwd;
                }
              }
            } catch (parseError) {
              // Skip malformed lines
            }
          }
        }
      }
      
      // Determine the best cwd to use
      if (cwdCounts.size === 0) {
        // No cwd found, fall back to smart decoded project name
        extractedPath = smartDecodeProjectName(projectName);
      } else if (cwdCounts.size === 1) {
        // Only one cwd, use it
        extractedPath = Array.from(cwdCounts.keys())[0];
      } else {
        // Multiple cwd values - prefer the most recent one if it has reasonable usage
        const mostRecentCount = cwdCounts.get(latestCwd) || 0;
        const maxCount = Math.max(...cwdCounts.values());
        
        // Use most recent if it has at least 25% of the max count
        if (mostRecentCount >= maxCount * 0.25) {
          extractedPath = latestCwd;
        } else {
          // Otherwise use the most frequently used cwd
          for (const [cwd, count] of cwdCounts.entries()) {
            if (count === maxCount) {
              extractedPath = cwd;
              break;
            }
          }
        }
        
        // Fallback (shouldn't reach here)
        if (!extractedPath) {
          extractedPath = latestCwd || smartDecodeProjectName(projectName);
        }
      }
    }
    
    // Cache the result
    projectDirectoryCache.set(projectName, extractedPath);
    
    return extractedPath;
    
  } catch (error) {
    console.error(`Error extracting project directory for ${projectName}:`, error);
    // Fall back to smart decoded project name
    extractedPath = smartDecodeProjectName(projectName);
    
    // Cache the fallback result too
    projectDirectoryCache.set(projectName, extractedPath);
    
    return extractedPath;
  }
}

async function getProjects() {
  const claudeDir = path.join(process.env.HOME, '.claude', 'projects');
  const config = await loadProjectConfig();
  const projects = [];
  const existingProjects = new Set();
  
  // Track projects by fullPath to detect duplicates - define at function scope
  const duplicateDetection = new Map();
  
  try {
    // First, get existing projects from the file system
    const entries = await fs.readdir(claudeDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        existingProjects.add(entry.name);
        const projectPath = path.join(claudeDir, entry.name);
        
        // Extract actual project directory from JSONL sessions
        const actualProjectDir = await extractProjectDirectory(entry.name);
        
        // Get display name from config or generate one
        const customName = config[entry.name]?.displayName;
        const autoDisplayName = await generateDisplayName(entry.name, actualProjectDir);
        const fullPath = actualProjectDir;
        
        const project = {
          name: entry.name,
          path: actualProjectDir,
          displayName: customName || autoDisplayName,
          fullPath: fullPath,
          isCustomName: !!customName,
          isManuallyAdded: !!config[entry.name]?.manuallyAdded,
          sessions: []
        };
        
        // Check for duplicates by fullPath
        const existingProject = duplicateDetection.get(fullPath);
        if (existingProject) {
          console.log(`🔍 Detected duplicate projects for path ${fullPath}:`);
          console.log(`  - Existing: ${existingProject.name} (manual: ${existingProject.isManuallyAdded})`);
          console.log(`  - New: ${project.name} (manual: ${project.isManuallyAdded})`);
          
          // Prefer manually added projects over auto-created ones
          if (project.isManuallyAdded && !existingProject.isManuallyAdded) {
            // Replace auto-created with manually added
            console.log(`  ✅ Preferring manually added project: ${project.name}`);
            
            // Merge sessions from both projects
            try {
              const existingSessionResult = await getSessions(existingProject.name);
              const newSessionResult = await getSessions(project.name);
              
              // Combine sessions and remove duplicates by ID
              const allSessions = [...(existingSessionResult.sessions || []), ...(newSessionResult.sessions || [])];
              const uniqueSessions = allSessions.filter((session, index, self) => 
                index === self.findIndex(s => s.id === session.id)
              );
              
              project.sessions = uniqueSessions;
              project.sessionMeta = {
                hasMore: false,
                total: uniqueSessions.length
              };
            } catch (e) {
              console.warn(`Could not merge sessions for duplicate projects:`, e.message);
            }
            
            // Update the map with the preferred project
            duplicateDetection.set(fullPath, project);
            
            // Remove the auto-created project from the projects list
            const existingIndex = projects.findIndex(p => p.name === existingProject.name);
            if (existingIndex !== -1) {
              projects.splice(existingIndex, 1);
            }
            
            projects.push(project);
          } else if (!project.isManuallyAdded && existingProject.isManuallyAdded) {
            // Skip auto-created project when manually added already exists
            console.log(`  ✅ Skipping auto-created duplicate, keeping manually added: ${existingProject.name}`);
            continue;
          } else {
            // Both are same type, keep the first one and merge sessions
            console.log(`  ✅ Merging sessions into existing project: ${existingProject.name}`);
            
            try {
              const newSessionResult = await getSessions(project.name);
              const existingSessions = existingProject.sessions || [];
              const newSessions = newSessionResult.sessions || [];
              
              // Combine and deduplicate sessions
              const allSessions = [...existingSessions, ...newSessions];
              const uniqueSessions = allSessions.filter((session, index, self) => 
                index === self.findIndex(s => s.id === session.id)
              );
              
              existingProject.sessions = uniqueSessions;
              existingProject.sessionMeta = {
                hasMore: false,
                total: uniqueSessions.length
              };
            } catch (e) {
              console.warn(`Could not merge sessions for duplicate projects:`, e.message);
            }
            
            continue; // Skip adding this duplicate
          }
        } else {
          // No duplicate, add normally
          duplicateDetection.set(fullPath, project);
          
          // Debug logging for project structure
          console.log('🔍 Project created:', {
            name: project.name,
            displayName: project.displayName,
            path: project.path,
            fullPath: project.fullPath,
            isCustomName: project.isCustomName
          });
          
          // Get all sessions for this project
          try {
            const sessionResult = await getSessions(entry.name);
            project.sessions = sessionResult.sessions || [];
            project.sessionMeta = {
              hasMore: false,
              total: sessionResult.total
            };
          } catch (e) {
            console.warn(`Could not load sessions for project ${entry.name}:`, e.message);
          }
          
          projects.push(project);
        }
      }
    }
  } catch (error) {
    console.error('Error reading projects directory:', error);
  }
  
  // Clean up empty auto-created directories after processing
  await cleanupEmptyProjectDirectories();
  
  // Add manually configured projects that don't exist as folders yet
  // This ensures manually added projects always appear, even after all sessions are deleted
  for (const [projectName, projectConfig] of Object.entries(config)) {
    if (!existingProjects.has(projectName) && projectConfig.manuallyAdded) {
      // Use the original path if available, otherwise extract from potential sessions
      let actualProjectDir = projectConfig.originalPath;
      
      if (!actualProjectDir) {
        try {
          actualProjectDir = await extractProjectDirectory(projectName);
        } catch (error) {
          // Fall back to smart decoded project name
          actualProjectDir = smartDecodeProjectName(projectName);
        }
      }
      
      const project = {
        name: projectName,
        path: actualProjectDir,
        displayName: projectConfig.displayName || await generateDisplayName(projectName, actualProjectDir),
        fullPath: actualProjectDir,
        isCustomName: !!projectConfig.displayName,
        isManuallyAdded: true,
        sessions: []
      };
      
      // Apply duplicate detection logic for manually added projects too
      const fullPath = actualProjectDir;
      const existingProject = duplicateDetection.get(fullPath);
      if (existingProject) {
        console.log(`🔍 Detected duplicate projects for path ${fullPath}:`);
        console.log(`  - Existing: ${existingProject.name} (manual: ${existingProject.isManuallyAdded})`);
        console.log(`  - New: ${project.name} (manual: ${project.isManuallyAdded})`);
        
        // Prefer manually added projects over auto-created ones
        if (project.isManuallyAdded && !existingProject.isManuallyAdded) {
          // Replace auto-created with manually added
          console.log(`  ✅ Preferring manually added project: ${project.name}`);
          
          // Merge sessions from both projects
          try {
            const existingSessionResult = await getSessions(existingProject.name);
            const newSessionResult = await getSessions(project.name);
            
            // Combine sessions and remove duplicates by ID
            const allSessions = [...(existingSessionResult.sessions || []), ...(newSessionResult.sessions || [])];
            const uniqueSessions = allSessions.filter((session, index, self) => 
              index === self.findIndex(s => s.id === session.id)
            );
            
            project.sessions = uniqueSessions;
            project.sessionMeta = {
              hasMore: false,
              total: uniqueSessions.length
            };
          } catch (e) {
            console.warn(`Could not merge sessions for duplicate projects:`, e.message);
            // Even if session merging fails, keep the manually added project
            project.sessions = [];
            project.sessionMeta = { hasMore: false, total: 0 };
          }
          
          // Update the map with the preferred project
          duplicateDetection.set(fullPath, project);
          
          // Remove the auto-created project from the projects list
          const existingIndex = projects.findIndex(p => p.name === existingProject.name);
          if (existingIndex !== -1) {
            projects.splice(existingIndex, 1);
          }
          
          projects.push(project);
        } else if (!project.isManuallyAdded && existingProject.isManuallyAdded) {
          // Skip auto-created project when manually added already exists
          console.log(`  ✅ Skipping auto-created duplicate, keeping manually added: ${existingProject.name}`);
          continue;
        } else {
          // Both are same type, keep the first one and merge sessions
          console.log(`  ✅ Merging sessions into existing project: ${existingProject.name}`);
          
          try {
            const newSessionResult = await getSessions(project.name);
            const existingSessions = existingProject.sessions || [];
            const newSessions = newSessionResult.sessions || [];
            
            // Combine and deduplicate sessions
            const allSessions = [...existingSessions, ...newSessions];
            const uniqueSessions = allSessions.filter((session, index, self) => 
              index === self.findIndex(s => s.id === session.id)
            );
            
            existingProject.sessions = uniqueSessions;
            existingProject.sessionMeta = {
              hasMore: false,
              total: uniqueSessions.length
            };
          } catch (e) {
            console.warn(`Could not merge sessions for duplicate projects:`, e.message);
            // Even if session merging fails, keep the existing project
            existingProject.sessions = existingProject.sessions || [];
            existingProject.sessionMeta = existingProject.sessionMeta || { hasMore: false, total: 0 };
          }
          
          continue; // Skip adding this duplicate
        }
      } else {
        // No duplicate, add normally
        duplicateDetection.set(fullPath, project);
        
        // Try to load sessions for this manually added project
        try {
          const sessionResult = await getSessions(projectName);
          project.sessions = sessionResult.sessions || [];
          project.sessionMeta = {
            hasMore: false,
            total: sessionResult.total || 0
          };
        } catch (e) {
          console.warn(`Could not load sessions for manually added project ${projectName}:`, e.message);
          // Even if session loading fails, keep the project with empty sessions
          project.sessions = [];
          project.sessionMeta = { hasMore: false, total: 0 };
        }
        
        // Debug logging for manually added project structure
        console.log('🔍 Manually added project created:', {
          name: project.name,
          displayName: project.displayName,
          path: project.path,
          fullPath: project.fullPath,
          isCustomName: project.isCustomName,
          isManuallyAdded: project.isManuallyAdded,
          sessionCount: project.sessions.length
        });
        
        projects.push(project);
      }
    }
  }
  
  // Final safeguard: Ensure ALL manually added projects from config appear in the final list
  // This handles edge cases where projects might get lost during processing
  for (const [projectName, projectConfig] of Object.entries(config)) {
    if (projectConfig.manuallyAdded) {
      const existsInProjects = projects.some(p => p.name === projectName);
      if (!existsInProjects) {
        console.log(`🚨 SAFEGUARD: Adding missing manually added project: ${projectName}`);
        
        const actualProjectDir = projectConfig.originalPath || smartDecodeProjectName(projectName);
        const project = {
          name: projectName,
          path: actualProjectDir,
          displayName: projectConfig.displayName || await generateDisplayName(projectName, actualProjectDir),
          fullPath: actualProjectDir,
          isCustomName: !!projectConfig.displayName,
          isManuallyAdded: true,
          sessions: [],
          sessionMeta: { hasMore: false, total: 0 }
        };
        
        projects.push(project);
      }
    }
  }
  
  return projects;
}

async function getSessions(projectName, limit = 5, offset = 0) {
  const projectDir = path.join(process.env.HOME, '.claude', 'projects', projectName);
  
  try {
    let files;
    try {
      files = await fs.readdir(projectDir);
    } catch (readdirError) {
      if (readdirError.code === 'ENOENT') {
        // Project directory doesn't exist yet (normal for new projects)
        return { sessions: [], hasMore: false, total: 0 };
      }
      throw readdirError; // Re-throw other errors
    }
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));
    
    if (jsonlFiles.length === 0) {
      return { sessions: [], hasMore: false, total: 0 };
    }
    
    // For performance, get file stats to sort by modification time
    const filesWithStats = await Promise.all(
      jsonlFiles.map(async (file) => {
        const filePath = path.join(projectDir, file);
        const stats = await fs.stat(filePath);
        return { file, mtime: stats.mtime };
      })
    );
    
    // Sort files by modification time (newest first) for better performance
    filesWithStats.sort((a, b) => b.mtime - a.mtime);
    
    const allSessions = new Map();
    let processedCount = 0;
    
    // Process files in order of modification time
    for (const { file } of filesWithStats) {
      const jsonlFile = path.join(projectDir, file);
      const sessions = await parseJsonlSessions(jsonlFile);
      
      // Merge sessions, avoiding duplicates by session ID
      sessions.forEach(session => {
        if (!allSessions.has(session.id)) {
          allSessions.set(session.id, session);
        }
      });
      
      processedCount++;
      
      // Early exit optimization: if we have enough sessions and processed recent files
      if (allSessions.size >= (limit + offset) * 2 && processedCount >= Math.min(3, filesWithStats.length)) {
        break;
      }
    }
    
    // Convert to array and sort by last activity
    const sortedSessions = Array.from(allSessions.values()).sort((a, b) => 
      new Date(b.lastActivity) - new Date(a.lastActivity)
    );
    
    const total = sortedSessions.length;
    const paginatedSessions = sortedSessions.slice(offset, offset + limit);
    const hasMore = offset + limit < total;
    
    return {
      sessions: paginatedSessions,
      hasMore,
      total,
      offset,
      limit
    };
  } catch (error) {
    console.error(`Error reading sessions for project ${projectName}:`, error);
    return { sessions: [], hasMore: false, total: 0 };
  }
}

async function parseJsonlSessions(filePath) {
  const sessions = new Map();
  
  try {
    const fileStream = require('fs').createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    
    // console.log(`[JSONL Parser] Reading file: ${filePath}`);
    let lineCount = 0;
    
    for await (const line of rl) {
      if (line.trim()) {
        lineCount++;
        try {
          const entry = JSON.parse(line);
          
          if (entry.sessionId) {
            if (!sessions.has(entry.sessionId)) {
              sessions.set(entry.sessionId, {
                id: entry.sessionId,
                summary: 'New Session',
                messageCount: 0,
                lastActivity: new Date(),
                cwd: entry.cwd || ''
              });
            }
            
            const session = sessions.get(entry.sessionId);
            
            // Update summary if this is a summary entry
            if (entry.type === 'summary' && entry.summary) {
              session.summary = entry.summary;
            } else if (entry.message?.role === 'user' && entry.message?.content && session.summary === 'New Session') {
              // Use first user message as summary if no summary entry exists
              const content = entry.message.content;
              if (typeof content === 'string' && content.length > 0) {
                // Skip command messages that start with <command-name>
                if (!content.startsWith('<command-name>')) {
                  session.summary = content.length > 50 ? content.substring(0, 50) + '...' : content;
                }
              }
            }
            
            // Count messages instead of storing them all
            session.messageCount = (session.messageCount || 0) + 1;
            
            // Update last activity
            if (entry.timestamp) {
              session.lastActivity = new Date(entry.timestamp);
            }
          }
        } catch (parseError) {
          console.warn(`[JSONL Parser] Error parsing line ${lineCount}:`, parseError.message);
        }
      }
    }
    
    // console.log(`[JSONL Parser] Processed ${lineCount} lines, found ${sessions.size} sessions`);
  } catch (error) {
    console.error('Error reading JSONL file:', error);
  }
  
  // Convert Map to Array and sort by last activity
  return Array.from(sessions.values()).sort((a, b) => 
    new Date(b.lastActivity) - new Date(a.lastActivity)
  );
}

// Get messages for a specific session
async function getSessionMessages(projectName, sessionId) {
  // Handle temporary/placeholder sessions (these don't exist on disk)
  if (sessionId.startsWith('temp-')) {
    return []; // Placeholder sessions have no messages yet
  }
  
  const projectDir = path.join(process.env.HOME, '.claude', 'projects', projectName);
  console.log(`📄 Looking for messages for session ${sessionId} in directory: ${projectDir}`);
  
  const messages = [];
  
  try {
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));
    
    if (jsonlFiles.length === 0) {
      console.log(`📄 No JSONL files found in directory: ${projectDir}`);
      return [];
    }
    
    // Process all JSONL files to find messages for this session
    for (const file of jsonlFiles) {
      const jsonlFile = path.join(projectDir, file);
      const fileStream = require('fs').createReadStream(jsonlFile);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });
      
      for await (const line of rl) {
        if (line.trim()) {
          try {
            const entry = JSON.parse(line);
            if (entry.sessionId === sessionId) {
              messages.push(entry);
            }
          } catch (parseError) {
            console.warn('Error parsing line:', parseError.message);
          }
        }
      }
    }
    
    if (messages.length > 0) {
      console.log(`📄 Found ${messages.length} messages in directory: ${projectDir}`);
    } else {
      console.log(`📄 No messages found for session ${sessionId} in directory: ${projectDir}`);
    }
    
  } catch (error) {
    // Handle the case where the project directory doesn't exist (normal for new projects)
    if (error.code === 'ENOENT') {
      console.log(`📄 Directory not found: ${projectDir}`);
    } else {
      console.error(`Error reading messages from ${projectDir}:`, error);
    }
  }
  
  // Sort messages by timestamp
  return messages.sort((a, b) => 
    new Date(a.timestamp || 0) - new Date(b.timestamp || 0)
  );
}

// Rename a project's display name
async function renameProject(projectName, newDisplayName) {
  const config = await loadProjectConfig();
  
  if (!newDisplayName || newDisplayName.trim() === '') {
    // Remove custom name if empty, will fall back to auto-generated
    if (config[projectName]) {
      delete config[projectName].displayName;
      // If this was the only property, remove the entire entry
      if (Object.keys(config[projectName]).length === 0) {
        delete config[projectName];
      }
    }
  } else {
    // Preserve existing configuration and only update displayName
    if (!config[projectName]) {
      config[projectName] = {};
    }
    config[projectName].displayName = newDisplayName.trim();
  }
  
  await saveProjectConfig(config);
  console.log(`✅ Project ${projectName} renamed to: ${newDisplayName}`);
  return true;
}

// Delete a session from a project
async function deleteSession(projectName, sessionId) {
  // Handle temporary/placeholder sessions (these don't exist on disk)
  if (sessionId.startsWith('temp-')) {
    console.log(`🗑️ Deleting temporary session: ${sessionId}`);
    return true; // Just return success - these are client-side placeholders
  }
  
  const projectDir = path.join(process.env.HOME, '.claude', 'projects', projectName);
  console.log(`🗑️ Looking for session ${sessionId} to delete in directory: ${projectDir}`);
  
  try {
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));
    
    if (jsonlFiles.length === 0) {
      console.log(`🗑️ No JSONL files found in directory: ${projectDir}`);
      throw new Error(`Session ${sessionId} not found - no session files exist`);
    }
    
    // Check all JSONL files to find which one contains the session
    for (const file of jsonlFiles) {
      const jsonlFile = path.join(projectDir, file);
      const content = await fs.readFile(jsonlFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      // Check if this file contains the session
      const hasSession = lines.some(line => {
        try {
          const data = JSON.parse(line);
          return data.sessionId === sessionId;
        } catch {
          return false;
        }
      });
      
      if (hasSession) {
        // Filter out all entries for this session
        const filteredLines = lines.filter(line => {
          try {
            const data = JSON.parse(line);
            return data.sessionId !== sessionId;
          } catch {
            return true; // Keep malformed lines
          }
        });
        
        // Write back the filtered content
        await fs.writeFile(jsonlFile, filteredLines.join('\n') + (filteredLines.length > 0 ? '\n' : ''));
        console.log(`🗑️ Successfully deleted session ${sessionId} from directory: ${projectDir}`);
        return true;
      }
    }
    
    throw new Error(`Session ${sessionId} not found in any files in directory: ${projectDir}`);
  } catch (error) {
    // Handle the case where the project directory doesn't exist
    if (error.code === 'ENOENT') {
      console.log(`🗑️ Directory not found: ${projectDir}`);
      throw new Error(`Session ${sessionId} not found - project directory does not exist`);
    }
    throw error;
  }
}

// Check if a project is empty (has no sessions)
async function isProjectEmpty(projectName) {
  try {
    // Clear cache to ensure fresh data
    clearProjectDirectoryCache();
    
    const projectDir = path.join(process.env.HOME, '.claude', 'projects', projectName);
    
    // Check if directory exists
    try {
      await fs.access(projectDir);
    } catch (error) {
      // Directory doesn't exist, so it's empty
      return true;
    }
    
    // Read directory contents directly instead of using getSessions to avoid caching issues
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));
    
    // Check if any JSONL files have content
    for (const file of jsonlFiles) {
      const filePath = path.join(projectDir, file);
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      if (lines.length > 0) {
        return false; // Found sessions
      }
    }
    
    return true; // No sessions found
  } catch (error) {
    console.error(`Error checking if project ${projectName} is empty:`, error);
    return false;
  }
}

// Delete an empty project
async function deleteProject(projectName) {
  const projectDir = path.join(process.env.HOME, '.claude', 'projects', projectName);
  
  try {
    console.log(`🗑️ Deleting project ${projectName} and all its sessions/conversations...`);
    
    // First, delete all sessions/conversations for this project
    try {
      const deleteResult = await deleteAllSessions(projectName);
      console.log(`🗑️ Deleted ${deleteResult.deletedCount} session files for project ${projectName}`);
    } catch (error) {
      console.warn(`Warning: Could not delete all sessions for project ${projectName}:`, error.message);
      // Continue with project deletion even if session deletion fails
    }
    
    // Clear all checkpoints for this project
    try {
      const { clearProjectCheckpoints } = require('./checkpoints');
      const deletedCheckpoints = clearProjectCheckpoints(projectName);
      console.log(`🗑️ Deleted ${deletedCheckpoints} checkpoints for project ${projectName}`);
    } catch (error) {
      console.warn(`Warning: Could not clear checkpoints for project ${projectName}:`, error.message);
      // Continue with project deletion even if checkpoint clearing fails
    }
    
    // Remove the project directory (force removal even if not empty)
    try {
      await fs.rm(projectDir, { recursive: true, force: true });
      console.log(`🗑️ Removed project directory: ${projectDir}`);
    } catch (error) {
      console.warn(`Warning: Could not remove project directory ${projectDir}:`, error.message);
      // Continue with config cleanup even if directory removal fails
    }
    
    // Since we now use consistent encoding, there's no need to check for auto-created directories
    // All projects use the same encoding scheme as Claude CLI
    
    // Remove from project config
    delete config[projectName];
    await saveProjectConfig(config);
    
    // Clear cache after deletion
    clearProjectDirectoryCache();
    
    console.log(`✅ Successfully deleted project: ${projectName} and all its data`);
    return true;
  } catch (error) {
    console.error(`Error deleting project ${projectName}:`, error);
    throw error;
  }
}

// Add a project manually to the config (without creating folders)
async function addProjectManually(projectPath, displayName = null) {
  const absolutePath = path.resolve(projectPath);
  
  try {
    // Check if the path exists
    await fs.access(absolutePath);
  } catch (error) {
    throw new Error(`Path does not exist: ${absolutePath}`);
  }
  
  // Generate project name (encode path for use as directory name)
  // Use consistent encoding: hyphens for path separators, hyphens for spaces (like Claude CLI)
  // Remove leading slash to avoid issues with directory names starting with '-'
  let projectName = absolutePath;
  if (projectName.startsWith('/')) {
    projectName = projectName.substring(1);
  }
  projectName = projectName.replace(/\//g, '-').replace(/\s+/g, '-');
  // Add leading hyphen to match Claude CLI's encoding scheme
  projectName = '-' + projectName;
  
  // Check if project already exists in config or as a folder
  const config = await loadProjectConfig();
  const projectDir = path.join(process.env.HOME, '.claude', 'projects', projectName);
  
  try {
    await fs.access(projectDir);
    throw new Error(`Project already exists for path: ${absolutePath}`);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  
  // Check if any existing project has the same path
  const existingProjects = await getProjects();
  const duplicateProject = existingProjects.find(project => 
    project.path === absolutePath || project.fullPath === absolutePath
  );
  
  if (duplicateProject) {
    // If it's an auto-created project, we can proceed and our manual project will take precedence
    if (!duplicateProject.isManuallyAdded) {
      console.log(`⚠️  Auto-created project exists for path ${absolutePath}, manual project will take precedence`);
    } else {
      throw new Error(`Project already configured for path: ${absolutePath} (exists as "${duplicateProject.displayName}")`);
    }
  }
  
  if (config[projectName]) {
    // Check if this config entry has the same original path
    if (config[projectName].originalPath === absolutePath) {
      throw new Error(`Project already configured for path: ${absolutePath}`);
    } else {
      // Different path with same encoded name - this shouldn't happen but handle it
      console.warn(`Project name collision: ${projectName} exists with different path`);
      throw new Error(`Project name conflict. Please try a different location or contact support.`);
    }
  }
  
  // Add to config as manually added project
  config[projectName] = {
    manuallyAdded: true,
    originalPath: absolutePath
  };
  
  if (displayName) {
    config[projectName].displayName = displayName;
  }
  
  await saveProjectConfig(config);
  
  // Create the project directory to ensure it exists
  try {
    await fs.mkdir(projectDir, { recursive: true });
    console.log(`📁 Created project directory: ${projectName} -> ${absolutePath}`);
  } catch (error) {
    if (error.code !== 'EEXIST') {
      console.warn(`Could not create project directory: ${error.message}`);
    }
  }
  
  console.log(`✅ Added project manually: ${projectName} -> ${absolutePath}`);
  
  return {
    name: projectName,
    path: absolutePath,
    fullPath: absolutePath,
    displayName: displayName || await generateDisplayName(projectName, absolutePath),
    isManuallyAdded: true,
    sessions: []
  };
}

// Truncate session messages to a specific checkpoint
async function truncateSessionMessages(projectName, sessionId, checkpointId, targetMessageCount) {
  try {
    console.log(`✂️ Truncating session ${sessionId} to checkpoint ${checkpointId} (${targetMessageCount} messages)`);
    
    const projectDir = path.join(process.env.HOME, '.claude', 'projects', projectName);
    
    // Check if project directory exists
    try {
      await fs.access(projectDir);
    } catch (error) {
      throw new Error(`Project directory not found: ${projectName}`);
    }
    
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));
    
    if (jsonlFiles.length === 0) {
      console.log('No JSONL files found for truncation');
      return { truncated: 0, files: 0 };
    }
    
    let totalTruncated = 0;
    let filesModified = 0;
    
    // Process each JSONL file
    for (const file of jsonlFiles) {
      const jsonlFile = path.join(projectDir, file);
      const tempFile = jsonlFile + '.tmp';
      
      // Read all lines from the file
      const fileStream = require('fs').createReadStream(jsonlFile);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });
      
      const allLines = [];
      const sessionLines = [];
      let sessionMessageCount = 0;
      
      // Collect all lines and identify session messages
      for await (const line of rl) {
        if (line.trim()) {
          try {
            const entry = JSON.parse(line);
            if (entry.sessionId === sessionId) {
              sessionLines.push({ line, entry, index: allLines.length });
              sessionMessageCount++;
            }
            allLines.push(line);
          } catch (parseError) {
            console.warn('Error parsing line during truncation:', parseError.message);
            allLines.push(line); // Keep malformed lines as-is
          }
        }
      }
      
      // If this file has session messages and we need to truncate
      if (sessionLines.length > 0 && sessionMessageCount > targetMessageCount) {
        // Calculate how many messages to keep (target count from the beginning)
        const linesToKeep = sessionLines.slice(0, targetMessageCount);
        const indicesToRemove = sessionLines.slice(targetMessageCount).map(item => item.index);
        
        // Create new file content excluding truncated messages
        const newLines = allLines.filter((_, index) => !indicesToRemove.includes(index));
        
        // Write the truncated content to temp file
        await fs.writeFile(tempFile, newLines.join('\n') + (newLines.length > 0 ? '\n' : ''));
        
        // Replace original file with truncated version
        await fs.rename(tempFile, jsonlFile);
        
        const removedCount = indicesToRemove.length;
        totalTruncated += removedCount;
        filesModified++;
        
        console.log(`✂️ Truncated ${removedCount} messages from ${file}`);
      }
    }
    
    console.log(`✅ Truncation complete: ${totalTruncated} messages removed from ${filesModified} files`);
    
    return {
      truncated: totalTruncated,
      files: filesModified,
      remainingMessages: targetMessageCount
    };
    
  } catch (error) {
    console.error(`Error truncating session messages:`, error);
    throw new Error(`Failed to truncate session: ${error.message}`);
  }
}

// Delete all sessions for a project
async function deleteAllSessions(projectName) {
  try {
    console.log(`🗑️ Deleting all sessions for project: ${projectName}`);
    
    const projectDir = path.join(process.env.HOME, '.claude', 'projects', projectName);
    console.log(`🗑️ Looking for sessions to delete in directory: ${projectDir}`);
    
    // Check if project directory exists
    try {
      await fs.access(projectDir);
    } catch (error) {
      console.log(`🗑️ Directory not found: ${projectDir}`);
      return {
        success: true,
        deletedCount: 0
      };
    }
    
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));
    
    if (jsonlFiles.length === 0) {
      console.log(`🗑️ No JSONL files found in: ${projectDir}`);
      return {
        success: true,
        deletedCount: 0
      };
    }
    
    let deletedCount = 0;
    
    // For each JSONL file, delete the entire file
    for (const file of jsonlFiles) {
      const jsonlFile = path.join(projectDir, file);
      
      try {
        await fs.unlink(jsonlFile);
        deletedCount++;
        console.log(`🗑️ Deleted session file: ${file} from ${projectDir}`);
      } catch (error) {
        console.warn(`Failed to delete session file ${file}:`, error.message);
      }
    }
    
    console.log(`✅ Deleted all sessions: ${deletedCount} files removed from directory: ${projectDir}`);
    
    // Clear the project directory cache to force fresh path resolution
    clearProjectDirectoryCache();
    
    // Give a small delay to ensure file system operations are complete
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return {
      success: true,
      deletedCount: deletedCount
    };
    
  } catch (error) {
    console.error(`Error deleting all sessions for project ${projectName}:`, error);
    throw new Error(`Failed to delete all sessions: ${error.message}`);
  }
}

async function cleanupEmptyProjectDirectories() {
  try {
    const claudeDir = path.join(process.env.HOME, '.claude', 'projects');
    const entries = await fs.readdir(claudeDir, { withFileTypes: true });
    const config = await loadProjectConfig();
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const projectDir = path.join(claudeDir, entry.name);
        
        try {
          // Check if directory is empty or only contains empty files
          const files = await fs.readdir(projectDir);
          const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));
          
          let isEmpty = true;
          for (const file of jsonlFiles) {
            const filePath = path.join(projectDir, file);
            const content = await fs.readFile(filePath, 'utf8');
            const lines = content.split('\n').filter(line => line.trim());
            if (lines.length > 0) {
              isEmpty = false;
              break;
            }
          }
          
          // Only remove empty directories if:
          // 1. They look like auto-created projects (start with hyphen)
          // 2. AND they're not manually added projects in the config
          if (isEmpty && entry.name.startsWith('-')) {
            // Check if this directory corresponds to any manually added project
            let shouldKeep = false;
            
            for (const [projectName, projectConfig] of Object.entries(config)) {
              if (projectConfig.manuallyAdded && projectName === entry.name) {
                shouldKeep = true;
                console.log(`🔒 Keeping empty manually added project directory: ${entry.name}`);
                break;
              }
            }
            
            if (!shouldKeep) {
              console.log(`🗑️  Removing empty auto-created project directory: ${entry.name}`);
              await fs.rm(projectDir, { recursive: true, force: true });
            }
          }
        } catch (error) {
          // Skip if we can't access the directory
          console.warn(`Could not check directory ${entry.name}:`, error.message);
        }
      }
    }
  } catch (error) {
    console.warn('Error during cleanup:', error.message);
  }
}


module.exports = {
  getProjects,
  getSessions,
  getSessionMessages,
  parseJsonlSessions,
  renameProject,
  deleteSession,
  deleteAllSessions,
  isProjectEmpty,
  deleteProject,
  addProjectManually,
  loadProjectConfig,
  saveProjectConfig,
  extractProjectDirectory,
  clearProjectDirectoryCache,
  truncateSessionMessages
};