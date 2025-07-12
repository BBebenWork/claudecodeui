import React, { useState, useEffect } from 'react';
import { X, Folder, FolderOpen, ChevronRight, Home, ArrowLeft, Monitor, FileText, Download, Image, Music, Video, HardDrive, Server } from 'lucide-react';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';

const DirectoryBrowser = ({ isOpen, onClose, onSelect }) => {
  const [directories, setDirectories] = useState([]);
  const [currentPath, setCurrentPath] = useState('/');
  const [parentPath, setParentPath] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [navigationMode, setNavigationMode] = useState('windows'); // 'windows' or 'linux'

  // Get icon for Windows shortcuts
  const getWindowsIcon = (iconType) => {
    switch (iconType) {
      case 'desktop':
        return <Monitor className="w-4 h-4 text-blue-600 dark:text-blue-400" />;
      case 'documents':
        return <FileText className="w-4 h-4 text-green-600 dark:text-green-400" />;
      case 'downloads':
        return <Download className="w-4 h-4 text-orange-600 dark:text-orange-400" />;
      case 'pictures':
        return <Image className="w-4 h-4 text-purple-600 dark:text-purple-400" />;
      case 'music':
        return <Music className="w-4 h-4 text-pink-600 dark:text-pink-400" />;
      case 'videos':
        return <Video className="w-4 h-4 text-red-600 dark:text-red-400" />;
      default:
        return <Folder className="w-4 h-4 text-gray-500 dark:text-gray-400" />;
    }
  };

  // Fetch directories for the current path
  const fetchDirectories = async (path, mode = navigationMode) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/browse-directories?path=${encodeURIComponent(path)}&mode=${mode}`);
      const data = await response.json();
      
      if (response.ok) {
        setDirectories(data.directories);
        setCurrentPath(data.currentPath);
        setParentPath(data.parentPath);
      } else {
        setError(data.error || 'Failed to load directories');
      }
    } catch (err) {
      console.error('Error fetching directories:', err);
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  // Load directories when component opens
  useEffect(() => {
    if (isOpen) {
      fetchDirectories('/', navigationMode);
    }
  }, [isOpen, navigationMode]);

  // Navigate to a directory
  const navigateToDirectory = (path) => {
    fetchDirectories(path, navigationMode);
  };

  // Go back to parent directory
  const goBack = () => {
    if (parentPath) {
      navigateToDirectory(parentPath);
    }
  };

  // Go to root
  const goToRoot = () => {
    navigateToDirectory('/');
  };

  // Switch navigation mode
  const switchMode = (newMode) => {
    setNavigationMode(newMode);
    setCurrentPath('/');
    setParentPath(null);
    setDirectories([]);
    // fetchDirectories will be called by useEffect when navigationMode changes
  };

  // Select current directory
  const selectCurrentDirectory = () => {
    if (currentPath && currentPath !== '/') {
      onSelect(currentPath);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-2xl mx-4 h-[80vh] max-h-[600px] min-h-[400px] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
              <Folder className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Browse Directories</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Select a project folder</p>
            </div>
          </div>
          
          {/* Mode Toggle */}
          <div className="flex items-center gap-2">
            <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
              <button
                onClick={() => switchMode('windows')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  navigationMode === 'windows'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                <HardDrive className="w-4 h-4" />
                Windows
              </button>
              <button
                onClick={() => switchMode('linux')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  navigationMode === 'linux'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                <Server className="w-4 h-4" />
                Linux
              </button>
            </div>
            
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Bar */}
        <div className="flex items-center gap-2 p-4 border-b border-gray-200 dark:border-gray-700">
          <Button
            variant="outline"
            size="sm"
            onClick={goToRoot}
            className="h-8"
          >
            <Home className="w-4 h-4" />
          </Button>
          
          {parentPath && (
            <Button
              variant="outline"
              size="sm"
              onClick={goBack}
              className="h-8"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
          )}
          
          <div className="flex-1 px-3 py-1 bg-gray-50 dark:bg-gray-700 rounded-md text-sm font-mono text-gray-700 dark:text-gray-300">
            {currentPath}
          </div>
        </div>

        {/* Directory List */}
        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-1">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-6 h-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
                  <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">Loading directories...</span>
                </div>
              ) : error ? (
                <div className="text-center py-8">
                  <div className="text-red-600 dark:text-red-400 mb-2">⚠️ {error}</div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchDirectories(currentPath)}
                  >
                    Try Again
                  </Button>
                </div>
              ) : directories.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  No directories found
                </div>
              ) : (
                <>
                  {/* Group directories by type */}
                  {(() => {
                    // Filter directories based on navigation mode
                    if (navigationMode === 'linux') {
                      // Linux mode: show only regular directories, no Windows shortcuts
                      const regularDirs = directories.filter(dir => !dir.isWindowsShortcut && !dir.isWslMount);
                      
                      return (
                        <>
                          {regularDirs.map((dir) => (
                            <div
                              key={dir.path}
                              className="group flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                              onClick={() => navigateToDirectory(dir.path)}
                            >
                              <div className="w-8 h-8 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
                                <Folder className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                              </div>
                              
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                  {dir.name}
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">
                                  {dir.path}
                                </div>
                              </div>
                              
                              <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300" />
                            </div>
                          ))}
                        </>
                      );
                    } else {
                      // Windows mode: show grouped layout with Windows shortcuts
                      const windowsShortcuts = directories.filter(dir => dir.isWindowsShortcut);
                      const wslMounts = directories.filter(dir => dir.isWslMount);
                      const regularDirs = directories.filter(dir => !dir.isWindowsShortcut && !dir.isWslMount);
                      
                      return (
                        <>
                          {/* Windows Shortcuts Section */}
                          {windowsShortcuts.length > 0 && (
                            <>
                              <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                Windows Folders
                              </div>
                              {windowsShortcuts.map((dir) => (
                              <div
                                key={dir.path}
                                className="group flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                                onClick={() => navigateToDirectory(dir.path)}
                              >
                                <div className="w-8 h-8 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-lg flex items-center justify-center">
                                  {getWindowsIcon(dir.icon)}
                                </div>
                                
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                    {dir.name}
                                  </div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">
                                    {dir.path}
                                  </div>
                                </div>
                                
                                <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300" />
                              </div>
                            ))}
                            
                            {/* Separator */}
                            <div className="border-t border-gray-200 dark:border-gray-700 my-2" />
                          </>
                        )}
                        
                        {/* WSL Drives Section */}
                        {wslMounts.length > 0 && (
                          <>
                            <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                              Windows Drives
                            </div>
                            {wslMounts.map((dir) => (
                              <div
                                key={dir.path}
                                className="group flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                                onClick={() => navigateToDirectory(dir.path)}
                              >
                                <div className="w-8 h-8 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
                                  <div className="w-4 h-4 bg-blue-600 rounded-sm flex items-center justify-center">
                                    <span className="text-white text-xs font-bold">
                                      {dir.name.charAt(0)}
                                    </span>
                                  </div>
                                </div>
                                
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                    {dir.name}
                                  </div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">
                                    {dir.path}
                                  </div>
                                </div>
                                
                                <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300" />
                              </div>
                            ))}
                            
                            {regularDirs.length > 0 && (
                              <div className="border-t border-gray-200 dark:border-gray-700 my-2" />
                            )}
                          </>
                        )}
                        
                        {/* Regular Directories Section */}
                        {regularDirs.length > 0 && (
                          <>
                            {(windowsShortcuts.length > 0 || wslMounts.length > 0) && (
                              <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                Folders
                              </div>
                            )}
                            {regularDirs.map((dir) => (
                              <div
                                key={dir.path}
                                className="group flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                                onClick={() => navigateToDirectory(dir.path)}
                              >
                                <div className="w-8 h-8 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
                                  <Folder className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                                </div>
                                
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                    {dir.name}
                                  </div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">
                                    {dir.path}
                                  </div>
                                </div>
                                
                                <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300" />
                              </div>
                            ))}
                            </>
                          )}
                        </>
                      );
                    }
                  })()}
                  {/* Add some bottom padding to ensure last item is visible */}
                  <div className="h-4" />
                </>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-200 dark:border-gray-700">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {navigationMode === 'windows' 
              ? 'Browse Windows folders and drives • Navigate to your project folder and click "Select This Folder"'
              : 'Browse Linux file system • Navigate to your project folder and click "Select This Folder"'
            }
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={onClose}
            >
              Cancel
            </Button>
            {currentPath !== '/' && (
              <Button
                onClick={selectCurrentDirectory}
              >
                Select This Folder
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DirectoryBrowser; 