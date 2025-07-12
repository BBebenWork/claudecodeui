import React, { useState, useEffect, useRef } from 'react';
import DirectoryBrowser from './DirectoryBrowser';

// Utility function for time formatting
const formatTimeAgo = (dateString, currentTime) => {
  const date = new Date(dateString);
  const diffMs = currentTime - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  
  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  if (diffMinutes > 0) return `${diffMinutes}m ago`;
  return 'Just now';
};

function Sidebar({ 
  projects, 
  selectedProject, 
  selectedSession, 
  selectedConversation,
  targetSessionId,
  onProjectSelect, 
  onSessionSelect, 
  onConversationSelect,
  onNewSession,
  onSessionDelete,
  onProjectDelete,
  isLoading,
  onRefresh,
  onShowSettings,
  updateAvailable,
  latestVersion,
  currentVersion,
  onShowVersionModal
}) {
  // Consolidated state management
  const [expandedProjects, setExpandedProjects] = useState(new Set());
  const [expandedConversations, setExpandedConversations] = useState(new Set());
  const [editing, setEditing] = useState({ type: null, id: null, value: '' });
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectPath, setNewProjectPath] = useState('');
  const [showDirectoryBrowser, setShowDirectoryBrowser] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now());

  const editInputRef = useRef(null);

  // Update current time periodically
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Auto-expand selected project
  useEffect(() => {
    if (selectedProject) {
      setExpandedProjects(prev => new Set([...prev, selectedProject.name]));
    }
  }, [selectedProject]);

  // Auto-expand conversation with target session
  useEffect(() => {
    if (targetSessionId && selectedProject) {
      const conversations = getProjectConversations(selectedProject);
      const targetConversation = conversations.find(conv => 
        conv.sessions.some(session => session.id === targetSessionId)
      );
      if (targetConversation) {
        setExpandedConversations(prev => new Set([...prev, targetConversation.id]));
      }
    }
  }, [targetSessionId, selectedProject]);

  // Focus edit input when editing starts
  useEffect(() => {
    if (editing.type && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editing.type]);

  // Utility functions
  const toggleExpanded = (set, setter, id) => {
    setter(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const startEditing = (type, id, currentValue) => {
    setEditing({ type, id, value: currentValue });
  };

  const cancelEditing = () => {
    setEditing({ type: null, id: null, value: '' });
  };

  const confirmDelete = (message) => {
    return window.confirm(message);
  };

  // Project management
  const handleProjectRename = async (projectName, newName) => {
    if (!newName.trim()) {
      cancelEditing();
      return;
    }
    
    // Store the current project to revert if needed
    const currentProject = projects.find(p => p.name === projectName);
    if (!currentProject) {
      cancelEditing();
      return;
    }
    
    // Check if the name actually changed
    if (newName.trim() === currentProject.displayName) {
      // No change - just cancel editing without any API calls
      cancelEditing();
      return;
    }
    
    cancelEditing();
    
    try {
      const response = await fetch(`/api/projects/${projectName}/rename`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: newName.trim() })
      });

      if (response.ok) {
        // Success - refresh to get updated data from server
        onRefresh();
      } else {
        console.error('Error renaming project:', response.statusText);
        alert('Failed to rename project. Please try again.');
      }
    } catch (error) {
      console.error('Error renaming project:', error);
      alert('Network error while renaming project. Please try again.');
    }
  };

  const handleProjectDelete = async (projectName) => {
    if (!confirmDelete('Are you sure you want to delete this project? This will permanently delete the project and ALL its conversations, sessions, and checkpoints. This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/projects/${projectName}`, { method: 'DELETE' });
      if (response.ok) {
        onProjectDelete(projectName);
      }
    } catch (error) {
      console.error('Error deleting project:', error);
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !newProjectPath.trim()) return;
    
    try {
      const response = await fetch('/api/projects/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          path: newProjectPath.trim(), 
          displayName: newProjectName.trim() 
        })
      });

      if (response.ok) {
        const result = await response.json();
        const newProject = result.project;
        setShowNewProject(false);
        setNewProjectName('');
        setNewProjectPath('');
        onRefresh();
        // Select the newly created project
        setTimeout(() => {
          onProjectSelect(newProject);
        }, 500); // Small delay to ensure the project list is updated
      } else {
        const errorData = await response.json();
        console.error('Error creating project:', errorData.error);
        
        // Check if it's a "already configured" error
        if (errorData.error.includes('already configured')) {
          const confirmResolve = window.confirm(
            `${errorData.error}\n\nWould you like to check the project configuration and try to resolve this issue? This may help if the project exists but isn't showing properly.`
          );
          
          if (confirmResolve) {
            await handleResolveProjectConflict(newProjectPath.trim());
          }
        } else {
          alert(`Error creating project: ${errorData.error}`);
        }
      }
    } catch (error) {
      console.error('Error creating project:', error);
      alert(`Error creating project: ${error.message}`);
    }
  };

  const handleResolveProjectConflict = async (projectPath) => {
    try {
      // First, get debug info about the project
      const debugResponse = await fetch(`/api/projects/debug${projectPath}`);
      const debugData = await debugResponse.json();
      
      console.log('Project debug info:', debugData);
      
      if (debugData.duplicateProject) {
        const message = `Found existing project: "${debugData.duplicateProject.displayName}"\n` +
                       `Project Name: ${debugData.duplicateProject.name}\n` +
                       `Path: ${debugData.duplicateProject.path}\n\n` +
                       `The project exists but may not be showing in the sidebar. Try refreshing the page.`;
        alert(message);
        onRefresh(); // Refresh the sidebar
      } else if (debugData.configEntry) {
        const removeConfig = window.confirm(
          `Found orphaned configuration entry for this path.\n\n` +
          `Would you like to remove the old configuration and try adding the project again?`
        );
        
        if (removeConfig) {
          const deleteResponse = await fetch(`/api/projects/config/${debugData.encodedName}`, {
            method: 'DELETE'
          });
          
          if (deleteResponse.ok) {
            alert('Old configuration removed. You can now try adding the project again.');
            onRefresh();
          } else {
            const deleteError = await deleteResponse.json();
            alert(`Error removing configuration: ${deleteError.error}`);
          }
        }
      } else {
        alert('Could not determine the cause of the conflict. Please try a different project path or contact support.');
      }
    } catch (error) {
      console.error('Error resolving project conflict:', error);
      alert(`Error checking project configuration: ${error.message}`);
    }
  };

  const handleCleanupOrphanedConfigs = async () => {
    const confirmCleanup = window.confirm(
      'This will clean up any orphaned project configurations that may be causing conflicts.\n\n' +
      'Are you sure you want to proceed?'
    );
    
    if (!confirmCleanup) return;

    try {
      const response = await fetch('/api/projects/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        const result = await response.json();
        if (result.removedProjects.length > 0) {
          alert(`✅ Successfully cleaned up ${result.removedProjects.length} orphaned configuration entries:\n\n${result.removedProjects.join('\n')}`);
        } else {
          alert('✅ No orphaned configurations found. Your project configuration is clean.');
        }
        onRefresh(); // Refresh the sidebar
      } else {
        const errorData = await response.json();
        alert(`Error during cleanup: ${errorData.error}`);
      }
    } catch (error) {
      console.error('Error cleaning up configurations:', error);
      alert(`Error during cleanup: ${error.message}`);
    }
  };

  // Session management
  const handleSessionDelete = async (projectName, sessionId) => {
    if (!confirmDelete('Are you sure you want to delete this session? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/projects/${projectName}/sessions/${sessionId}`, { 
        method: 'DELETE' 
      });
      if (response.ok) {
        onSessionDelete(sessionId);
      }
    } catch (error) {
      console.error('Error deleting session:', error);
    }
  };

  const handleDeleteAllSessions = async (projectName) => {
    if (!confirmDelete('Are you sure you want to delete all sessions for this project? This action cannot be undone.')) {
      return;
    }

    try {
      // First, clean up all placeholder sessions for this project from localStorage
      const storedPlaceholders = JSON.parse(localStorage.getItem('placeholderSessions') || '{}');
      const updatedPlaceholders = {};
      
      // Keep only placeholder sessions that don't belong to this project
      Object.entries(storedPlaceholders).forEach(([sessionId, placeholderData]) => {
        if (placeholderData.projectName !== projectName) {
          updatedPlaceholders[sessionId] = placeholderData;
        }
      });
      
      localStorage.setItem('placeholderSessions', JSON.stringify(updatedPlaceholders));
      
      // Then delete all sessions from the server (this handles persisted sessions)
      const response = await fetch(`/api/projects/${projectName}/sessions`, { method: 'DELETE' });
      if (response.ok) {
        onRefresh();
      }
    } catch (error) {
      console.error('Error deleting all sessions:', error);
    }
  };

  // Conversation management
  const handleConversationRename = async (projectName, conversation, newTitle) => {
    if (!newTitle.trim()) {
      cancelEditing();
      return;
    }
    
    // Check if the title actually changed
    if (newTitle.trim() === conversation.title) {
      // No change - just cancel editing without any API calls
      cancelEditing();
      return;
    }
    
    try {
      const updatePromises = conversation.sessions.map(session =>
        fetch(`/api/projects/${projectName}/sessions/${session.id}/summary`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ summary: newTitle.trim() })
        })
      );
      
      const responses = await Promise.all(updatePromises);
      const allSuccessful = responses.every(response => response.ok);
      
      if (allSuccessful) {
        cancelEditing();
        onRefresh();
      } else {
        console.error('Some conversation renames failed');
        // Don't cancel editing if some requests failed
      }
    } catch (error) {
      console.error('Error renaming conversation:', error);
      // Don't cancel editing if there was an error
    }
  };

  const handleConversationDelete = async (projectName, conversation) => {
    if (!confirmDelete('Are you sure you want to delete this conversation? This action cannot be undone.')) {
      return;
    }

    try {
      const deletePromises = conversation.sessions.map(session =>
        fetch(`/api/projects/${projectName}/sessions/${session.id}`, { method: 'DELETE' })
      );
      
      const responses = await Promise.all(deletePromises);
      const allSuccessful = responses.every(response => response.ok);
      
      if (allSuccessful) {
        onRefresh();
      } else {
        console.error('Some conversation deletions failed');
      }
    } catch (error) {
      console.error('Error deleting conversation:', error);
    }
  };

  const getProjectConversations = (project) => {
    const sessions = project.sessions || [];
    if (sessions.length === 0) return [];
    
    const conversations = [];
    const processedSessions = new Set();
    
    sessions.forEach(session => {
      if (processedSessions.has(session.id)) return;
      
      const conversation = {
        id: `conversation_${session.id}`,
        title: session.summary || session.title || 'Untitled',
        sessions: [session],
        lastActivity: session.lastActivity || session.updated_at,
        isOrphaned: session.isOrphaned || false
      };
      
      // Group sessions with same summary/title
      const relatedSessions = sessions.filter(s => 
        s.id !== session.id && 
        !processedSessions.has(s.id) &&
        s.summary === session.summary &&
        s.summary !== 'New Conversation'
      );
      
      relatedSessions.forEach(relatedSession => {
        conversation.sessions.push(relatedSession);
        processedSessions.add(relatedSession.id);
        
        // Update last activity to most recent
        const relatedActivity = relatedSession.lastActivity || relatedSession.updated_at;
        if (new Date(relatedActivity) > new Date(conversation.lastActivity)) {
          conversation.lastActivity = relatedActivity;
        }
      });
      
      conversations.push(conversation);
      processedSessions.add(session.id);
    });
    
    return conversations.sort((a, b) => 
      new Date(b.lastActivity) - new Date(a.lastActivity)
    );
  };

  // Render functions
  const renderProject = (project) => {
    // Use selectedProject data if this is the currently selected project to get the most up-to-date session data
    const currentProject = selectedProject?.name === project.name ? selectedProject : project;
    
    const isExpanded = expandedProjects.has(project.name);
    const isSelected = selectedProject?.name === project.name;
    const conversations = getProjectConversations(currentProject);
    const totalSessions = currentProject.sessions?.length || 0;
    const isEditing = editing.type === 'project' && editing.id === project.name;

    return (
      <div key={project.name} className="mb-2">
        <div className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${
          isSelected ? 'bg-blue-100 dark:bg-blue-900' : 'hover:bg-gray-100 dark:hover:bg-gray-700'
        }`}>
          <div className="flex items-center space-x-2 flex-1 min-w-0">
            <button
              onClick={() => toggleExpanded(expandedProjects, setExpandedProjects, project.name)}
              className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
            >
              <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} 
                   fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            
            <div className="flex-1 min-w-0" onClick={() => !isEditing && onProjectSelect(currentProject)}>
              {isEditing ? (
                <div className="flex items-center space-x-2">
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editing.value}
                    onChange={(e) => setEditing(prev => ({ ...prev, value: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleProjectRename(project.name, editing.value);
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelEditing();
                      }
                    }}
                    className="flex-1 px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleProjectRename(project.name, editing.value);
                    }}
                    className="p-1 hover:bg-green-200 dark:hover:bg-green-800 rounded text-green-600 dark:text-green-400"
                    title="Confirm rename"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      cancelEditing();
                    }}
                    className="p-1 hover:bg-red-200 dark:hover:bg-red-800 rounded text-red-600 dark:text-red-400"
                    title="Cancel rename"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <div>
                  <span className="font-medium text-sm truncate">{currentProject.displayName}</span>
                  <div className="text-xs text-gray-500">
                    {totalSessions} session{totalSessions !== 1 ? 's' : ''}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {!isEditing && (
            <div className="flex items-center space-x-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  startEditing('project', project.name, project.displayName);
                }}
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
                title="Rename project"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleProjectDelete(project.name);
                }}
                className="p-1 hover:bg-red-200 dark:hover:bg-red-800 rounded text-red-600"
                title="Delete project"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          )}
        </div>
        
        {isExpanded && (
          <div className="ml-4 mt-2 space-y-2">
            {/* Action buttons */}
            <div className="flex items-center space-x-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNewSession(currentProject);
                }}
                className="flex items-center space-x-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-md transition-colors"
                title="New session"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>New Conversation</span>
              </button>
              
              {totalSessions > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteAllSessions(project.name);
                  }}
                  className="flex items-center space-x-2 px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-md transition-colors"
                  title="Delete all conversations"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  <span>Delete All</span>
                </button>
              )}
            </div>
            
            {/* Conversations list */}
            <div className="space-y-1">
              {conversations.map(conversation => renderConversation(currentProject, conversation))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderConversation = (project, conversation) => {
    const isExpanded = expandedConversations.has(conversation.id);
    const isSelected = selectedConversation?.id === conversation.id;
    const isEditing = editing.type === 'conversation' && editing.id === conversation.id;
    
    return (
      <div key={conversation.id} className="mb-1">
        <div className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${
          isSelected ? 'bg-blue-100 dark:bg-blue-900' : 'hover:bg-gray-100 dark:hover:bg-gray-700'
        }`}>
          <div className="flex items-center space-x-2 flex-1 min-w-0">
            <button
              onClick={() => toggleExpanded(expandedConversations, setExpandedConversations, conversation.id)}
              className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
            >
              <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} 
                   fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            
            <div className="flex-1 min-w-0" onClick={() => {
              if (!isEditing) {
                // Find the most recent session in the conversation
                const mostRecentSession = conversation.sessions.reduce((latest, current) => 
                  new Date(current.lastActivity || current.updated_at) > new Date(latest.lastActivity || latest.updated_at) ? current : latest
                );
                onConversationSelect(conversation, mostRecentSession?.id);
              }
            }}>
              {isEditing ? (
                <div className="flex items-center space-x-2">
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editing.value}
                    onChange={(e) => setEditing(prev => ({ ...prev, value: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleConversationRename(project.name, conversation, editing.value);
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelEditing();
                      }
                    }}
                    className="flex-1 px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleConversationRename(project.name, conversation, editing.value);
                    }}
                    className="p-1 hover:bg-green-200 dark:hover:bg-green-800 rounded text-green-600 dark:text-green-400"
                    title="Confirm rename"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      cancelEditing();
                    }}
                    className="p-1 hover:bg-red-200 dark:hover:bg-red-800 rounded text-red-600 dark:text-red-400"
                    title="Cancel rename"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <div>
                  <span className="text-sm truncate">{conversation.title}</span>
                  <div className="text-xs text-gray-500">
                    {conversation.sessions.length} session{conversation.sessions.length !== 1 ? 's' : ''} • {formatTimeAgo(conversation.lastActivity, currentTime)}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {!isEditing && (
            <div className="flex items-center space-x-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  startEditing('conversation', conversation.id, conversation.title);
                }}
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
                title="Rename conversation"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleConversationDelete(project.name, conversation);
                }}
                className="p-1 hover:bg-red-200 dark:hover:bg-red-800 rounded text-red-600"
                title="Delete conversation"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          )}
        </div>
        
        {isExpanded && (
          <div className="ml-4 mt-1 space-y-1">
            {conversation.sessions.map(session => renderSession(project, session))}
          </div>
        )}
      </div>
    );
  };

  const renderSession = (project, session) => {
    const isSelected = selectedSession?.id === session.id;
    
    return (
      <div
        key={session.id}
        className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${
          isSelected ? 'bg-blue-100 dark:bg-blue-900' : 'hover:bg-gray-100 dark:hover:bg-gray-700'
        }`}
        onClick={() => onSessionSelect(session)}
      >
        <div className="flex-1 min-w-0">
          <div className="text-sm truncate">{session.summary || session.title}</div>
          <div className="text-xs text-gray-500">
            {formatTimeAgo(session.lastActivity || session.updated_at, currentTime)}
          </div>
        </div>
        
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleSessionDelete(project.name, session.id);
          }}
          className="p-1 hover:bg-red-200 dark:hover:bg-red-800 rounded text-red-600"
          title="Delete session"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Projects</h1>
          <div className="flex items-center space-x-2">
            {updateAvailable && (
              <button
                onClick={onShowVersionModal}
                className="px-2 py-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 text-xs rounded-md hover:bg-green-200 dark:hover:bg-green-800 transition-colors"
                title={`Update available: ${latestVersion}`}
              >
                Update
              </button>
            )}
            <button
              onClick={handleCleanupOrphanedConfigs}
              className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg"
              title="Clean up orphaned project configurations"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
            <button
              onClick={onShowSettings}
              className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg"
              title="Settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <button
              onClick={onRefresh}
              className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg"
              title="Refresh"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>
        
        <button
          onClick={() => setShowNewProject(true)}
          className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center justify-center space-x-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Add Project</span>
        </button>
      </div>
      
      {/* Project List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {isLoading ? (
          <div className="text-center text-gray-500 py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400 mx-auto mb-4"></div>
            <p>Loading projects...</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <p>No projects found</p>
            <p className="text-sm">Add a project to get started</p>
          </div>
        ) : (
          projects.map(project => renderProject(project))
        )}
      </div>

      {/* New Project Modal */}
      {showNewProject && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Add New Project</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Project Name</label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700"
                  placeholder="Enter project name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Project Path</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={newProjectPath}
                    onChange={(e) => setNewProjectPath(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700"
                    placeholder="Enter project path"
                  />
                  <button
                    onClick={() => setShowDirectoryBrowser(true)}
                    className="px-3 py-2 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 rounded-md"
                  >
                    Browse
                  </button>
                </div>
              </div>
            </div>
            <div className="flex justify-end space-x-2 mt-6">
              <button
                onClick={() => {
                  setShowNewProject(false);
                  setNewProjectName('');
                  setNewProjectPath('');
                }}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateProject}
                disabled={!newProjectName.trim() || !newProjectPath.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-md transition-colors"
              >
                Add Project
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Directory Browser */}
      <DirectoryBrowser
        isOpen={showDirectoryBrowser}
        onClose={() => setShowDirectoryBrowser(false)}
        onSelect={(path) => {
          setNewProjectPath(path);
          setShowDirectoryBrowser(false);
        }}
      />
    </div>
  );
}

export default Sidebar;