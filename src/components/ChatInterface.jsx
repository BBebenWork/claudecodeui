/*
 * ChatInterface.jsx - Simplified Chat Component with Session Protection
 * 
 * This component handles the chat interface between users and Claude,
 * including session management, message handling, and conversation threading.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import TodoList from './TodoList';
import ClaudeLogo from './ClaudeLogo.jsx';
import ClaudeStatus from './ClaudeStatus';
import { MicButton } from './MicButton.jsx';

// Simplified message component
const MessageComponent = memo(({ message, index, prevMessage, createDiff, onFileOpen, onShowSettings, autoExpandTools, showRawParameters, onRevertToCheckpoint }) => {
  const isGrouped = prevMessage?.type === message.type && prevMessage.type === 'assistant' && !prevMessage.isToolUse && !message.isToolUse;
  const messageRef = useRef(null);
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Auto-expand tool details when they come into view
  useEffect(() => {
    if (!autoExpandTools || !messageRef.current || !message.isToolUse) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !isExpanded) {
            setIsExpanded(true);
            const details = messageRef.current.querySelectorAll('details');
            details.forEach(detail => detail.open = true);
          }
        });
      },
      { threshold: 0.1 }
    );
    
    observer.observe(messageRef.current);
    return () => observer.disconnect();
  }, [autoExpandTools, isExpanded, message.isToolUse]);

  const renderUserMessage = () => (
    <div className="flex items-end space-x-0 sm:space-x-3 w-full sm:w-auto sm:max-w-[85%] md:max-w-md lg:max-w-lg xl:max-w-xl">
      <div className="bg-blue-600 text-white rounded-2xl rounded-br-md px-3 sm:px-4 py-2 shadow-sm flex-1 sm:flex-initial">
        <div className="text-sm whitespace-pre-wrap break-words">{message.content}</div>
        <div className="flex items-center justify-between mt-1">
          <div className="text-xs text-blue-100">{new Date(message.timestamp).toLocaleTimeString()}</div>
          {message.checkpointId && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRevertToCheckpoint(message.checkpointId);
              }}
              className="text-xs text-blue-100 hover:text-white bg-blue-500 hover:bg-blue-400 px-2 py-1 rounded ml-2 transition-colors"
              title="Revert to checkpoint"
            >
              ↶ Revert
            </button>
          )}
        </div>
      </div>
      {!isGrouped && (
        <div className="hidden sm:flex w-8 h-8 bg-blue-600 rounded-full items-center justify-center text-white text-sm flex-shrink-0">
          U
        </div>
      )}
    </div>
  );

  const renderAssistantMessage = () => (
    <div className="w-full">
      {!isGrouped && (
        <div className="flex items-center space-x-3 mb-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0 p-1">
            <ClaudeLogo className="w-full h-full" />
          </div>
          <div className="text-sm font-medium text-gray-900 dark:text-white">Claude</div>
        </div>
      )}
      
      <div className="w-full">
        {message.isToolUse ? renderToolUse() : renderRegularMessage()}
        <div className={`text-xs text-gray-500 dark:text-gray-400 mt-1 ${isGrouped ? 'opacity-0 group-hover:opacity-100' : ''}`}>
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );

  const renderToolUse = () => (
    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-2 sm:p-3 mb-2">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 bg-blue-600 rounded flex items-center justify-center">
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <span className="font-medium text-blue-900 dark:text-blue-100">Using {message.toolName}</span>
          <span className="text-xs text-blue-600 dark:text-blue-400 font-mono">{message.toolId}</span>
        </div>
        {onShowSettings && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onShowSettings();
            }}
            className="p-1 rounded hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
            title="Tool Settings"
          >
            <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        )}
      </div>
      
      {renderToolInput()}
      {message.toolResult && renderToolResult()}
    </div>
  );

  const renderToolInput = () => {
    if (!message.toolInput) return null;
    
    try {
      const input = JSON.parse(message.toolInput);
      
      // Special handling for Edit tool
      if (message.toolName === 'Edit' && input.file_path && input.old_string && input.new_string) {
        return (
          <details className="mt-2" open={autoExpandTools}>
            <summary className="text-sm text-blue-700 dark:text-blue-300 cursor-pointer hover:text-blue-800 dark:hover:text-blue-200 flex items-center gap-2">
              <svg className="w-4 h-4 transition-transform details-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              📝 View edit diff for 
              <button 
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onFileOpen && onFileOpen(input.file_path, {
                    old_string: input.old_string,
                    new_string: input.new_string
                  });
                }}
                className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline font-mono"
              >
                {input.file_path.split('/').pop()}
              </button>
            </summary>
            <div className="mt-3">
              <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <button 
                    onClick={() => onFileOpen && onFileOpen(input.file_path, {
                      old_string: input.old_string,
                      new_string: input.new_string
                    })}
                    className="text-xs font-mono text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 truncate underline cursor-pointer"
                  >
                    {input.file_path}
                  </button>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Diff</span>
                </div>
                <div className="text-xs font-mono">
                  {createDiff(input.old_string, input.new_string).map((diffLine, i) => (
                    <div key={i} className="flex">
                      <span className={`w-8 text-center border-r ${
                        diffLine.type === 'removed' 
                          ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800'
                          : 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800'
                      }`}>
                        {diffLine.type === 'removed' ? '-' : '+'}
                      </span>
                      <span className={`px-2 py-0.5 flex-1 whitespace-pre-wrap ${
                        diffLine.type === 'removed'
                          ? 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
                          : 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
                      }`}>
                        {diffLine.content}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </details>
        );
      }
      
      // Special handling for Write tool
      if (message.toolName === 'Write' && input.file_path && input.content !== undefined) {
        return (
          <details className="mt-2" open={autoExpandTools}>
            <summary className="text-sm text-blue-700 dark:text-blue-300 cursor-pointer hover:text-blue-800 dark:hover:text-blue-200 flex items-center gap-2">
              <svg className="w-4 h-4 transition-transform details-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              📄 Creating new file: 
              <button 
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onFileOpen && onFileOpen(input.file_path, {
                    old_string: '',
                    new_string: input.content
                  });
                }}
                className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline font-mono"
              >
                {input.file_path.split('/').pop()}
              </button>
            </summary>
            <div className="mt-3">
              <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <button 
                    onClick={() => onFileOpen && onFileOpen(input.file_path, {
                      old_string: '',
                      new_string: input.content
                    })}
                    className="text-xs font-mono text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 truncate underline cursor-pointer"
                  >
                    {input.file_path}
                  </button>
                  <span className="text-xs text-gray-500 dark:text-gray-400">New File</span>
                </div>
                <div className="text-xs font-mono">
                  {createDiff('', input.content).map((diffLine, i) => (
                    <div key={i} className="flex">
                      <span className="w-8 text-center border-r bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800">
                        +
                      </span>
                      <span className="px-2 py-0.5 flex-1 whitespace-pre-wrap bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200">
                        {diffLine.content}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </details>
        );
      }
      
      // Special handling for TodoWrite tool
      if (message.toolName === 'TodoWrite' && input.todos && Array.isArray(input.todos)) {
        return (
          <details className="mt-2" open={autoExpandTools}>
            <summary className="text-sm text-blue-700 dark:text-blue-300 cursor-pointer hover:text-blue-800 dark:hover:text-blue-200 flex items-center gap-2">
              <svg className="w-4 h-4 transition-transform details-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              Updating Todo List
            </summary>
            <div className="mt-3">
              <TodoList todos={input.todos} />
            </div>
          </details>
        );
      }
      
      // Special handling for Bash tool
      if (message.toolName === 'Bash') {
        return (
          <details className="mt-2" open={autoExpandTools}>
            <summary className="text-sm text-blue-700 dark:text-blue-300 cursor-pointer hover:text-blue-800 dark:hover:text-blue-200 flex items-center gap-2">
              <svg className="w-4 h-4 transition-transform details-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              Running command
            </summary>
            <div className="mt-3 space-y-2">
              <div className="bg-gray-900 dark:bg-gray-950 text-gray-100 rounded-lg p-3 font-mono text-sm">
                <div className="flex items-center gap-2 mb-2 text-gray-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="text-xs">Terminal</span>
                </div>
                <div className="whitespace-pre-wrap break-all text-green-400">
                  $ {input.command}
                </div>
              </div>
              {input.description && (
                <div className="text-xs text-gray-600 dark:text-gray-400 italic">{input.description}</div>
              )}
            </div>
          </details>
        );
      }
      
      // Special handling for Read tool
      if (message.toolName === 'Read' && input.file_path) {
        const filename = input.file_path.split('/').pop();
        const pathParts = input.file_path.split('/');
        const relevantParts = pathParts.slice(-4, -1);
        const relativePath = relevantParts.length > 0 ? relevantParts.join('/') + '/' : '';
        
        return (
          <details className="mt-2" open={autoExpandTools}>
            <summary className="text-sm text-blue-700 dark:text-blue-300 cursor-pointer hover:text-blue-800 dark:hover:text-blue-200 flex items-center gap-1">
              <svg className="w-4 h-4 transition-transform details-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              <svg className="w-4 h-4 text-blue-600 dark:text-blue-400 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="text-gray-600 dark:text-gray-400 font-mono text-xs">{relativePath}</span>
              <span className="font-semibold text-blue-700 dark:text-blue-300 font-mono">{filename}</span>
            </summary>
          </details>
        );
      }
      
    } catch (e) {
      // Fall back to regular display
    }
    
    // Default tool input display
    return (
      <details className="mt-2" open={autoExpandTools}>
        <summary className="text-sm text-blue-700 dark:text-blue-300 cursor-pointer hover:text-blue-800 dark:hover:text-blue-200 flex items-center gap-2">
          <svg className="w-4 h-4 transition-transform details-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          View input parameters
        </summary>
        <pre className="mt-2 text-xs bg-blue-100 dark:bg-blue-800/30 p-2 rounded whitespace-pre-wrap break-words overflow-hidden text-blue-900 dark:text-blue-100">
          {message.toolInput}
        </pre>
      </details>
    );
  };

  const renderToolResult = () => {
    if (!message.toolResult) return null;
    
    return (
      <div className="mt-3 border-t border-blue-200 dark:border-blue-700 pt-3">
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-4 h-4 rounded flex items-center justify-center ${
            message.toolResult.isError ? 'bg-red-500' : 'bg-green-500'
          }`}>
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {message.toolResult.isError ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              )}
            </svg>
          </div>
          <span className={`text-sm font-medium ${
            message.toolResult.isError ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-300'
          }`}>
            {message.toolResult.isError ? 'Tool Error' : 'Tool Result'}
          </span>
        </div>
        
        <div className={`text-sm ${
          message.toolResult.isError ? 'text-red-800 dark:text-red-200' : 'text-green-800 dark:text-green-200'
        }`}>
          {renderToolResultContent()}
        </div>
      </div>
    );
  };

  const renderToolResultContent = () => {
    const content = String(message.toolResult.content || '');
    
    // Handle file update/creation messages
    const fileUpdateMatch = content.match(/(?:The file|File) (.+?) has been (?:updated|created|written)/);
    if (fileUpdateMatch) {
      return (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="font-medium">File {content.includes('created') ? 'created' : 'updated'} successfully</span>
          </div>
          <button 
            onClick={() => onFileOpen && onFileOpen(fileUpdateMatch[1])}
            className="text-xs font-mono bg-green-100 dark:bg-green-800/30 px-2 py-1 rounded text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline cursor-pointer"
          >
            {fileUpdateMatch[1]}
          </button>
        </div>
      );
    }
    
    // Handle TodoWrite success
    if ((message.toolName === 'TodoWrite' || message.toolName === 'TodoRead') && 
        content.includes('Todo')) {
      try {
        if (content.startsWith('[')) {
          const todos = JSON.parse(content);
          if (Array.isArray(todos)) {
            return (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="font-medium">Current Todo List</span>
                </div>
                <TodoList todos={todos} isResult={true} />
              </div>
            );
          }
        }
      } catch (e) {
        // Fall through to regular handling
      }
    }
    
    // Handle long content with collapsible details
    if (content.length > 300) {
      return (
        <details open={autoExpandTools}>
          <summary className="text-sm text-green-700 dark:text-green-300 cursor-pointer hover:text-green-800 dark:hover:text-green-200 mb-2 flex items-center gap-2">
            <svg className="w-4 h-4 transition-transform details-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            View full output ({content.length} chars)
          </summary>
          <div className="mt-2 prose prose-sm max-w-none prose-green dark:prose-invert">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        </details>
      );
    }
    
    // Regular content
    return (
      <div className="prose prose-sm max-w-none prose-green dark:prose-invert">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    );
  };

  const renderRegularMessage = () => {
    if (message.isInteractivePrompt) {
      return renderInteractivePrompt();
    }
    
    return (
      <div className="text-sm text-gray-700 dark:text-gray-300">
        {message.type === 'assistant' ? (
          <div className="prose prose-sm max-w-none dark:prose-invert prose-gray [&_code]:!bg-transparent [&_code]:!p-0">
            <ReactMarkdown
              components={{
                code: ({node, inline, className, children, ...props}) => {
                  return inline ? (
                    <strong className="text-blue-600 dark:text-blue-400 font-bold not-prose" {...props}>
                      {children}
                    </strong>
                  ) : (
                    <div className="bg-gray-100 dark:bg-gray-800 p-3 rounded-lg overflow-hidden my-2">
                      <code className="text-gray-800 dark:text-gray-200 text-sm font-mono block whitespace-pre-wrap break-words" {...props}>
                        {children}
                      </code>
                    </div>
                  );
                },
                a: ({href, children}) => (
                  <a href={href} className="text-blue-600 dark:text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ),
                p: ({children}) => <div className="mb-2 last:mb-0">{children}</div>
              }}
            >
              {String(message.content || '')}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="whitespace-pre-wrap">{message.content}</div>
        )}
      </div>
    );
  };

  const renderInteractivePrompt = () => (
    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="flex-1">
          <h4 className="font-semibold text-amber-900 dark:text-amber-100 text-base mb-2">
            Interactive Prompt
          </h4>
          <div className="text-sm text-amber-800 dark:text-amber-200 whitespace-pre-wrap">
            {message.content}
          </div>
          <div className="bg-amber-100 dark:bg-amber-800/30 rounded-lg p-3 mt-3">
            <p className="text-amber-900 dark:text-amber-100 text-sm font-medium mb-1">
              ⏳ Waiting for your response in the CLI
            </p>
            <p className="text-amber-800 dark:text-amber-200 text-xs">
              Please respond in your terminal where Claude is running.
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div
      ref={messageRef}
      className={`chat-message ${message.type} ${isGrouped ? 'grouped' : ''} ${
        message.type === 'user' ? 'flex justify-end px-3 sm:px-0' : 'px-3 sm:px-0'
      }`}
      data-session-id={message.sessionId}
    >
      {message.type === 'user' ? renderUserMessage() : renderAssistantMessage()}
    </div>
  );
});

// Main ChatInterface component
function ChatInterface({ 
  selectedProject, 
  selectedSession, 
  selectedConversation, 
  targetSessionId, 
  ws, 
  sendMessage, 
  messages, 
  onFileOpen, 
  onInputFocusChange, 
  onSessionActive, 
  onSessionInactive, 
  onReplaceTemporarySession, 
  onReplacePlaceholderSession, 
  onNavigateToSession, 
  onConversationSelect, 
  onShowSettings, 
  autoExpandTools, 
  showRawParameters, 
  autoScrollToBottom, 
  onProjectUpdate, 
  onUpdateSessionActivity 
}) {
  // Core state
  const [input, setInput] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState(selectedSession?.id || null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [sessionMessages, setSessionMessages] = useState([]);
  const [isLoadingSessionMessages, setIsLoadingSessionMessages] = useState(false);
  const [claudeStatus, setClaudeStatus] = useState(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);
  const [lastSentSessionId, setLastSentSessionId] = useState(null); // Track the session ID that was sent to server

  // File reference state
  const [showFileDropdown, setShowFileDropdown] = useState(false);
  const [fileList, setFileList] = useState([]);
  const [filteredFiles, setFilteredFiles] = useState([]);
  const [selectedFileIndex, setSelectedFileIndex] = useState(-1);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [atSymbolPosition, setAtSymbolPosition] = useState(-1);

  // Refs
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const scrollContainerRef = useRef(null);

  // Session management helpers
  const sessionManager = {
    getActiveSessionId: () => {
      if (selectedConversation) {
        // When a conversation is selected, use the targetSessionId if available,
        // otherwise use the most recent session from the conversation
        if (targetSessionId) {
          return targetSessionId;
        }
        // Find the most recent session in the conversation
        const mostRecentSession = selectedConversation.sessions.reduce((latest, current) => 
          new Date(current.lastActivity || current.updated_at) > new Date(latest.lastActivity || latest.updated_at) ? current : latest
        );
        return mostRecentSession?.id;
      }
      return currentSessionId || selectedSession?.id;
    },
    
    shouldCreateNewSession: () => {
      // Don't create a new session if we have a selected conversation
      if (selectedConversation) {
        return false;
      }
      return !currentSessionId && !selectedSession?.isPlaceholder;
    },
    
    getConversationContext: () => {
      if (selectedConversation) {
        return {
          conversationId: selectedConversation.id,
          conversationTitle: selectedConversation.title
        };
      }
      return null;
    }
  };

  // Message conversion utilities
  const messageConverter = {
    convertFromAPI: (apiMessages) => {
      const converted = [];
      const toolResults = new Map();
      
      // First pass: collect tool results
      apiMessages.forEach(msg => {
        if (msg.message?.role === 'user' && Array.isArray(msg.message?.content)) {
          msg.message.content.forEach(part => {
            if (part.type === 'tool_result') {
              toolResults.set(part.tool_use_id, {
                content: part.content,
                isError: part.is_error,
                timestamp: new Date(msg.timestamp || Date.now())
              });
            }
          });
        }
      });
      
      // Second pass: convert messages
      apiMessages.forEach(msg => {
        if (msg.message?.role === 'user' && msg.message?.content) {
          const content = Array.isArray(msg.message.content) 
            ? msg.message.content.filter(p => p.type === 'text').map(p => p.text).join('\n')
            : msg.message.content;
          
          if (content && !content.startsWith('<command-name>')) {
            converted.push({
              type: 'user',
              content: content,
              timestamp: msg.timestamp || new Date().toISOString(),
              sessionId: msg.sessionId,
              persisted: true,
              isPending: false
            });
          }
        } else if (msg.message?.role === 'assistant' && msg.message?.content) {
          if (Array.isArray(msg.message.content)) {
            msg.message.content.forEach(part => {
              if (part.type === 'text') {
                converted.push({
                  type: 'assistant',
                  content: part.text,
                  timestamp: msg.timestamp || new Date().toISOString(),
                  sessionId: msg.sessionId,
                  persisted: true,
                  isPending: false
                });
              } else if (part.type === 'tool_use') {
                const toolResult = toolResults.get(part.id);
                converted.push({
                  type: 'assistant',
                  content: '',
                  timestamp: msg.timestamp || new Date().toISOString(),
                  isToolUse: true,
                  toolName: part.name,
                  toolInput: JSON.stringify(part.input),
                  toolResult: toolResult,
                  toolId: part.id,
                  sessionId: msg.sessionId,
                  persisted: true,
                  isPending: false
                });
              }
            });
          } else {
            converted.push({
              type: 'assistant',
              content: msg.message.content,
              timestamp: msg.timestamp || new Date().toISOString(),
              sessionId: msg.sessionId,
              persisted: true,
              isPending: false
            });
          }
        }
      });
      
      return converted;
    }
  };

  // Diff calculation
  const createDiff = useMemo(() => {
    return (oldStr, newStr) => {
      const oldLines = oldStr.split('\n');
      const newLines = newStr.split('\n');
      const diffLines = [];
      
      let oldIndex = 0;
      let newIndex = 0;
      
      while (oldIndex < oldLines.length || newIndex < newLines.length) {
        if (oldIndex >= oldLines.length) {
          diffLines.push({ type: 'added', content: newLines[newIndex] });
          newIndex++;
        } else if (newIndex >= newLines.length) {
          diffLines.push({ type: 'removed', content: oldLines[oldIndex] });
          oldIndex++;
        } else if (oldLines[oldIndex] === newLines[newIndex]) {
          oldIndex++;
          newIndex++;
        } else {
          diffLines.push({ type: 'removed', content: oldLines[oldIndex] });
          diffLines.push({ type: 'added', content: newLines[newIndex] });
          oldIndex++;
          newIndex++;
        }
      }
      
      return diffLines;
    };
  }, []);

  // Scroll management
  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      setIsUserScrolledUp(false);
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
      const nearBottom = scrollHeight - scrollTop - clientHeight < 50;
      setIsUserScrolledUp(!nearBottom);
    }
  }, []);

  // Session and conversation loading
  const loadSessionMessages = useCallback(async (projectName, sessionId) => {
    if (!projectName || !sessionId) return [];
    
    setIsLoadingSessionMessages(true);
    try {
      const response = await fetch(`/api/projects/${projectName}/sessions/${sessionId}/messages`);
      if (!response.ok) throw new Error('Failed to load session messages');
      const data = await response.json();
      return data.messages || [];
    } catch (error) {
      console.error('Error loading session messages:', error);
      return [];
    } finally {
      setIsLoadingSessionMessages(false);
    }
  }, []);

  const loadConversationMessages = useCallback(async (projectName, sessions) => {
    if (!projectName || !sessions?.length) return [];
    
    setIsLoadingSessionMessages(true);
    try {
      const allMessages = [];
      
      for (const session of sessions) {
        const messages = await loadSessionMessages(projectName, session.id);
        const messagesWithSessionInfo = messages.map(msg => ({
          ...msg,
          sessionId: session.id,
          sessionSummary: session.summary
        }));
        allMessages.push(...messagesWithSessionInfo);
      }
      
      return allMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    } catch (error) {
      console.error('Error loading conversation messages:', error);
      return [];
    } finally {
      setIsLoadingSessionMessages(false);
    }
  }, [loadSessionMessages]);

  // WebSocket message handling
  const handleWebSocketMessage = useCallback((latestMessage) => {
    switch (latestMessage.type) {
      case 'session-created':
        if (latestMessage.sessionId && !currentSessionId) {
          setCurrentSessionId(latestMessage.sessionId);
          
          setChatMessages(prev => prev.map(msg => ({
            ...msg,
            sessionId: latestMessage.sessionId,
            isPending: false,
            persisted: true
          })));
          
          // Check if we're replacing a placeholder session by looking at the session ID that was sent to the server
          const isReplacingPlaceholder = lastSentSessionId && lastSentSessionId.startsWith('temp-');
          
          if (isReplacingPlaceholder && onReplacePlaceholderSession && lastSentSessionId) {
            // Definitively clean up the exact placeholder session that was sent to the server
            const existingPlaceholders = JSON.parse(localStorage.getItem('placeholderSessions') || '{}');
            if (existingPlaceholders[lastSentSessionId]) {
              delete existingPlaceholders[lastSentSessionId];
              localStorage.setItem('placeholderSessions', JSON.stringify(existingPlaceholders));
              console.log(`🧹 Definitively cleaned up placeholder session ${lastSentSessionId} from localStorage`);
            }
            
            onReplacePlaceholderSession(latestMessage.sessionId, lastSentSessionId);
            // Clear the tracked session ID since it's been replaced
            setLastSentSessionId(null);
            // Don't call onProjectUpdate here - the placeholder replacement handles state updates
          } else if (onReplaceTemporarySession) {
            onReplaceTemporarySession(latestMessage.sessionId);
            // Clear the tracked session ID
            setLastSentSessionId(null);
            // Only call onProjectUpdate for non-placeholder sessions
            if (onProjectUpdate) {
              onProjectUpdate();
            }
          }
        }
        break;
        
      case 'claude-response':
        const messageData = latestMessage.data.message || latestMessage.data;
        
        if (Array.isArray(messageData.content)) {
          messageData.content.forEach(part => {
            if (part.type === 'tool_use') {
              setChatMessages(prev => [...prev, {
                type: 'assistant',
                content: '',
                timestamp: new Date(),
                isToolUse: true,
                toolName: part.name,
                toolInput: JSON.stringify(part.input),
                toolId: part.id,
                sessionId: sessionManager.getActiveSessionId(),
                persisted: true,
                isPending: false
              }]);
            } else if (part.type === 'text' && part.text?.trim()) {
              setChatMessages(prev => [...prev, {
                type: 'assistant',
                content: part.text,
                timestamp: new Date(),
                sessionId: sessionManager.getActiveSessionId(),
                persisted: true,
                isPending: false
              }]);
            }
          });
        } else if (typeof messageData.content === 'string' && messageData.content.trim()) {
          setChatMessages(prev => [...prev, {
            type: 'assistant',
            content: messageData.content,
            timestamp: new Date(),
            sessionId: sessionManager.getActiveSessionId(),
            persisted: true,
            isPending: false
          }]);
        }
        
        // Handle tool results
        if (messageData.role === 'user' && Array.isArray(messageData.content)) {
          messageData.content.forEach(part => {
            if (part.type === 'tool_result') {
              setChatMessages(prev => prev.map(msg => {
                if (msg.isToolUse && msg.toolId === part.tool_use_id) {
                  return {
                    ...msg,
                    toolResult: {
                      content: part.content,
                      isError: part.is_error,
                      timestamp: new Date()
                    }
                  };
                }
                return msg;
              }));
            }
          });
        }
        break;
        
      case 'claude-output':
        setChatMessages(prev => [...prev, {
          type: 'assistant',
          content: latestMessage.data,
          timestamp: new Date(),
          sessionId: sessionManager.getActiveSessionId(),
          persisted: true,
          isPending: false
        }]);
        break;
        
      case 'claude-interactive-prompt':
        setChatMessages(prev => [...prev, {
          type: 'assistant',
          content: latestMessage.data,
          timestamp: new Date(),
          isInteractivePrompt: true,
          sessionId: sessionManager.getActiveSessionId(),
          persisted: true,
          isPending: false
        }]);
        break;
        
      case 'claude-error':
        setChatMessages(prev => [...prev, {
          type: 'error',
          content: `Error: ${latestMessage.error}`,
          timestamp: new Date(),
          sessionId: sessionManager.getActiveSessionId(),
          persisted: true,
          isPending: false
        }]);
        break;
        
      case 'claude-complete':
        setIsLoading(false);
        setClaudeStatus(null);
        setLastSentSessionId(null); // Clear tracked session ID when session completes
        if (onSessionInactive) {
          onSessionInactive(
            selectedConversation ? `conversation-${selectedConversation.id}` : sessionManager.getActiveSessionId()
          );
        }
        break;
        
      case 'session-aborted':
        setIsLoading(false);
        setClaudeStatus(null);
        setLastSentSessionId(null); // Clear tracked session ID when session is aborted
        if (onSessionInactive) {
          onSessionInactive(
            selectedConversation ? `conversation-${selectedConversation.id}` : sessionManager.getActiveSessionId()
          );
        }
        setChatMessages(prev => [...prev, {
          type: 'assistant',
          content: 'Session interrupted by user.',
          timestamp: new Date(),
          sessionId: sessionManager.getActiveSessionId(),
          persisted: true,
          isPending: false
        }]);
        break;
        
      case 'claude-status':
        const statusData = latestMessage.data;
        if (statusData) {
          setClaudeStatus({
            text: statusData.message || statusData.status || 'Working...',
            tokens: statusData.tokens || statusData.token_count || 0,
            can_interrupt: statusData.can_interrupt !== false
          });
          setIsLoading(true);
        }
        break;
    }
  }, [currentSessionId, selectedConversation, onReplaceTemporarySession, onProjectUpdate, onSessionInactive]);

  // Handle WebSocket messages
  useEffect(() => {
    if (messages.length > 0) {
      const latestMessage = messages[messages.length - 1];
      handleWebSocketMessage(latestMessage);
    }
  }, [messages, handleWebSocketMessage]);

  // Load messages when session/conversation changes
  useEffect(() => {
    const loadMessages = async () => {
      if (selectedConversation && selectedProject) {
        const messages = await loadConversationMessages(selectedProject.name, selectedConversation.sessions);
        setSessionMessages(messages);
      } else if (selectedSession && selectedProject && !selectedSession.isPlaceholder) {
        const messages = await loadSessionMessages(selectedProject.name, selectedSession.id);
        setSessionMessages(messages);
      } else {
        setSessionMessages([]);
      }
    };
    
    loadMessages();
  }, [selectedSession?.id, selectedConversation?.id, selectedProject?.name]);

  // Update currentSessionId when selectedSession changes
  useEffect(() => {
    if (selectedSession?.id !== currentSessionId) {
      setCurrentSessionId(selectedSession?.id || null);
      // Clear tracked session ID when switching sessions
      setLastSentSessionId(null);
    }
  }, [selectedSession?.id, currentSessionId]);

  // Update currentSessionId when conversation is selected
  useEffect(() => {
    if (selectedConversation) {
      // When a conversation is selected, set the currentSessionId to the appropriate session
      const sessionIdToUse = targetSessionId || 
        selectedConversation.sessions.reduce((latest, current) => 
          new Date(current.lastActivity || current.updated_at) > new Date(latest.lastActivity || latest.updated_at) ? current : latest
        )?.id;
      
      if (sessionIdToUse && (sessionIdToUse !== currentSessionId || !currentSessionId)) {
        setCurrentSessionId(sessionIdToUse);
        // Clear tracked session ID when switching conversations
        setLastSentSessionId(null);
      }
    }
  }, [selectedConversation?.id, targetSessionId]);

  // Convert session messages to chat messages and restore checkpoints
  useEffect(() => {
    if (sessionMessages.length > 0) {
      const converted = messageConverter.convertFromAPI(sessionMessages);
      
      // Restore checkpoint IDs from localStorage
      if (selectedProject?.name) {
        // Check multiple possible project names for checkpoints
        // This handles cases where messages are in auto-created directories but checkpoints
        // are stored under manually added project names, or vice versa
        const possibleProjectNames = [selectedProject.name];
        
        // If this is a manually added project, also check the auto-created project name
        if (selectedProject.name && !selectedProject.name.startsWith('-')) {
          // Generate the auto-created project name that Claude CLI would create
          let autoCreatedName = selectedProject.fullPath || selectedProject.path;
          if (autoCreatedName.startsWith('/')) {
            autoCreatedName = autoCreatedName.substring(1);
          }
          autoCreatedName = autoCreatedName.replace(/\//g, '-').replace(/\s+/g, '-');
          autoCreatedName = '-' + autoCreatedName;
          possibleProjectNames.push(autoCreatedName);
        }
        
        // If this is an auto-created project, also check the manually added project name
        if (selectedProject.name && selectedProject.name.startsWith('-')) {
          // Generate the manually added project name
          let manualName = selectedProject.fullPath || selectedProject.path;
          if (manualName.startsWith('/')) {
            manualName = manualName.substring(1);
          }
          manualName = manualName.replace(/\//g, '-').replace(/\s+/g, '_');
          possibleProjectNames.push(manualName);
        }
        
        // Combine checkpoints from all possible project names
        const allCheckpoints = {};
        for (const projectName of possibleProjectNames) {
          const checkpointKey = `checkpoints-${projectName}`;
          const checkpoints = JSON.parse(localStorage.getItem(checkpointKey) || '{}');
          Object.assign(allCheckpoints, checkpoints);
          console.log(`🔍 Checkpoints for ${projectName}:`, Object.keys(checkpoints).length, 'entries');
        }
        
        console.log(`🔍 Total checkpoints available:`, Object.keys(allCheckpoints).length);
        console.log(`🔍 Checkpoint keys:`, Object.keys(allCheckpoints));
        
        const messagesWithCheckpoints = converted.map(message => {
          if (message.type === 'user') {
            // Clean the message content for matching (remove \n suffix that API adds)
            const cleanContent = message.content.replace(/\n$/, '');
            
            // Try to find matching checkpoint by content and timestamp
            const messageKey = `${cleanContent.substring(0, 50)}-${new Date(message.timestamp).getTime()}`;
            const checkpoint = allCheckpoints[messageKey];
            
            if (checkpoint) {
              console.log(`✅ Found exact checkpoint match for message: "${cleanContent.substring(0, 30)}..."`);
              return { ...message, checkpointId: checkpoint.checkpointId };
            }
            
            // Fallback: try to match by content if timestamp doesn't match exactly
            const checkpointEntries = Object.values(allCheckpoints);
            const matchingCheckpoint = checkpointEntries.find(cp => 
              cp.content === cleanContent && 
              Math.abs(cp.timestamp - new Date(message.timestamp).getTime()) < 5000 // 5 second tolerance
            );
            
            if (matchingCheckpoint) {
              console.log(`✅ Found checkpoint match with tolerance for message: "${cleanContent.substring(0, 30)}..."`);
              return { ...message, checkpointId: matchingCheckpoint.checkpointId };
            }
            
            // Additional fallback: try to match by content only (for cases where timestamps are completely different)
            const contentOnlyMatch = checkpointEntries.find(cp => cp.content === cleanContent);
            if (contentOnlyMatch) {
              console.log(`✅ Found checkpoint match by content only for message: "${cleanContent.substring(0, 30)}..."`);
              return { ...message, checkpointId: contentOnlyMatch.checkpointId };
            }
            
            console.log(`❌ No checkpoint found for message: "${cleanContent.substring(0, 30)}..."`);
          }
          return message;
        });
        
        setChatMessages(messagesWithCheckpoints);
      } else {
        setChatMessages(converted);
      }
    } else if (!selectedSession?.isPlaceholder) {
      setChatMessages([]);
    }
  }, [sessionMessages, selectedProject?.name, selectedProject?.fullPath, selectedProject?.path, selectedSession?.id]);

  // Auto-scroll management
  useEffect(() => {
    if (autoScrollToBottom && !isUserScrolledUp && chatMessages.length > 0) {
      setTimeout(() => scrollToBottom(), 50);
    }
  }, [chatMessages.length, autoScrollToBottom, isUserScrolledUp, scrollToBottom]);

  // Scroll event listener
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  // File list management
  useEffect(() => {
    if (selectedProject) {
      fetchProjectFiles();
    }
  }, [selectedProject]);

  const fetchProjectFiles = async () => {
    try {
      const response = await fetch(`/api/projects/${selectedProject.name}/files`);
      if (response.ok) {
        const files = await response.json();
        setFileList(flattenFileTree(files));
      }
    } catch (error) {
      console.error('Error fetching files:', error);
    }
  };

  const flattenFileTree = (files, basePath = '') => {
    let result = [];
    for (const file of files) {
      const fullPath = basePath ? `${basePath}/${file.name}` : file.name;
      if (file.type === 'directory' && file.children) {
        result = result.concat(flattenFileTree(file.children, fullPath));
      } else if (file.type === 'file') {
        result.push({
          name: file.name,
          path: fullPath,
          relativePath: file.path
        });
      }
    }
    return result;
  };

  // File dropdown management
  useEffect(() => {
    const textBeforeCursor = input.slice(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      if (!textAfterAt.includes(' ')) {
        setAtSymbolPosition(lastAtIndex);
        setShowFileDropdown(true);
        
        const filtered = fileList.filter(file => 
          file.name.toLowerCase().includes(textAfterAt.toLowerCase()) ||
          file.path.toLowerCase().includes(textAfterAt.toLowerCase())
        ).slice(0, 10);
        
        setFilteredFiles(filtered);
        setSelectedFileIndex(-1);
      } else {
        setShowFileDropdown(false);
      }
    } else {
      setShowFileDropdown(false);
    }
  }, [input, cursorPosition, fileList]);

  // Input focus management
  useEffect(() => {
    if (onInputFocusChange) {
      onInputFocusChange(isInputFocused);
    }
  }, [isInputFocused, onInputFocusChange]);

  // Input persistence
  useEffect(() => {
    if (selectedProject?.name) {
      if (input) {
        localStorage.setItem(`draft_input_${selectedProject.name}`, input);
      } else {
        localStorage.removeItem(`draft_input_${selectedProject.name}`);
      }
    }
  }, [input, selectedProject?.name]);

  // Load saved input
  useEffect(() => {
    if (selectedProject?.name) {
      const savedInput = localStorage.getItem(`draft_input_${selectedProject.name}`) || '';
      if (savedInput !== input) {
        setInput(savedInput);
      }
    }
  }, [selectedProject?.name]);

  // Message persistence
  useEffect(() => {
    if (selectedProject?.name) {
      if (chatMessages.length > 0) {
        localStorage.setItem(`chat_messages_${selectedProject.name}`, JSON.stringify(chatMessages));
      } else {
        localStorage.removeItem(`chat_messages_${selectedProject.name}`);
      }
    }
  }, [chatMessages, selectedProject?.name]);

  // Handlers
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !selectedProject) return;
    
    if (selectedConversation?.isOrphaned) {
      setChatMessages(prev => [...prev, {
        type: 'system',
        content: '📚 This conversation is from your history but the session files are no longer available. You can view the messages but cannot continue the conversation. Please start a new conversation to continue chatting.',
        timestamp: new Date()
      }]);
      return;
    }

    const userMessage = {
      type: 'user',
      content: input,
      timestamp: new Date(),
      sessionId: sessionManager.getActiveSessionId(),
      isPending: !sessionManager.getActiveSessionId(),
      persisted: false
    };

    setChatMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setClaudeStatus({ text: 'Processing', tokens: 0, can_interrupt: true });
    setIsUserScrolledUp(false);
    setTimeout(() => scrollToBottom(), 100);

    // Session protection
    const sessionToActivate = selectedConversation 
      ? `conversation-${selectedConversation.id}`
      : sessionManager.getActiveSessionId() || `new-session-${Date.now()}`;
    
    if (onSessionActive) {
      onSessionActive(sessionToActivate);
    }

    // Create checkpoint
    try {
      const promptId = `prompt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const response = await fetch('/api/checkpoints/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: selectedProject.name,
          promptId,
          userMessage: input
        })
      });
      
      if (response.ok) {
        userMessage.checkpointId = promptId;
        setChatMessages(prev => prev.map(msg => 
          msg === userMessage ? { ...msg, checkpointId: promptId } : msg
        ));
        
        // Store checkpoint mapping
        const checkpointKey = `checkpoints-${selectedProject.name}`;
        const existingCheckpoints = JSON.parse(localStorage.getItem(checkpointKey) || '{}');
        const messageKey = `${input.substring(0, 50)}-${userMessage.timestamp.getTime()}`;
        existingCheckpoints[messageKey] = {
          checkpointId: promptId,
          content: input,
          timestamp: userMessage.timestamp.getTime()
        };
        localStorage.setItem(checkpointKey, JSON.stringify(existingCheckpoints));
      }
    } catch (error) {
      console.warn('Error creating checkpoint:', error);
    }

    // Get tools settings
    const getToolsSettings = () => {
      try {
        const saved = localStorage.getItem('claude-tools-settings');
        return saved ? JSON.parse(saved) : { allowedTools: [], disallowedTools: [], skipPermissions: false };
      } catch (error) {
        return { allowedTools: [], disallowedTools: [], skipPermissions: false };
      }
    };

    // Send message
    const sessionIdToUse = sessionManager.getActiveSessionId();
    const conversationContext = sessionManager.getConversationContext();
    
    // Track the session ID that was sent to the server for proper placeholder replacement
    setLastSentSessionId(sessionIdToUse);
    
    // If this is a placeholder session, mark it as "pending conversion" instead of deleting
    // This prevents it from being restored but keeps it available for definitive matching
    if (sessionIdToUse && sessionIdToUse.startsWith('temp-')) {
      const existingPlaceholders = JSON.parse(localStorage.getItem('placeholderSessions') || '{}');
      if (existingPlaceholders[sessionIdToUse]) {
        existingPlaceholders[sessionIdToUse].pendingConversion = true;
        existingPlaceholders[sessionIdToUse].pendingConversionTime = Date.now();
        localStorage.setItem('placeholderSessions', JSON.stringify(existingPlaceholders));
        console.log(`🔄 Marked placeholder session ${sessionIdToUse} as pending conversion`);
      }
    }
    
    sendMessage({
      type: 'claude-command',
      command: input,
      options: {
        projectName: selectedProject.name, // Always pass project name for proper project identification
        projectPath: selectedProject.path,
        cwd: selectedProject.fullPath,
        sessionId: sessionIdToUse,
        resume: !!sessionIdToUse,
        toolsSettings: getToolsSettings(),
        conversationContext
      }
    });

    // Update session activity immediately for better UX (but not for placeholder sessions)
    if (sessionIdToUse && onUpdateSessionActivity && !sessionIdToUse.startsWith('temp-')) {
      onUpdateSessionActivity({
        sessionId: sessionIdToUse,
        lastActivity: new Date().toISOString(),
        messageContent: input.trim(),
        increment: true
      });
    }

    setInput('');
    setIsTextareaExpanded(false);
    if (selectedProject) {
      localStorage.removeItem(`draft_input_${selectedProject.name}`);
    }
  };

  const handleKeyDown = (e) => {
    if (showFileDropdown && filteredFiles.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedFileIndex(prev => prev < filteredFiles.length - 1 ? prev + 1 : 0);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedFileIndex(prev => prev > 0 ? prev - 1 : filteredFiles.length - 1);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const fileToSelect = selectedFileIndex >= 0 ? filteredFiles[selectedFileIndex] : filteredFiles[0];
        if (fileToSelect) selectFile(fileToSelect);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowFileDropdown(false);
        return;
      }
    }
    
    if (e.key === 'Enter') {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
      } else if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleSubmit(e);
      }
    }
  };

  const selectFile = (file) => {
    const textBeforeAt = input.slice(0, atSymbolPosition);
    const textAfterAtQuery = input.slice(atSymbolPosition);
    const spaceIndex = textAfterAtQuery.indexOf(' ');
    const textAfterQuery = spaceIndex !== -1 ? textAfterAtQuery.slice(spaceIndex) : '';
    
    const newInput = textBeforeAt + '@' + file.path + textAfterQuery;
    setInput(newInput);
    setShowFileDropdown(false);
    setAtSymbolPosition(-1);
    
    if (textareaRef.current) {
      textareaRef.current.focus();
      const newCursorPos = textBeforeAt.length + 1 + file.path.length;
      setTimeout(() => {
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
        setCursorPosition(newCursorPos);
      }, 0);
    }
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
    setCursorPosition(e.target.selectionStart);
  };

  const handleRevertToCheckpoint = async (checkpointId) => {
    if (!selectedProject || !checkpointId) return;
    
    if (!confirm('Are you sure you want to revert to this checkpoint? This will overwrite current file changes.')) {
      return;
    }
    
    try {
      const response = await fetch('/api/checkpoints/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: selectedProject.name,
          promptId: checkpointId
        })
      });
      
      if (!response.ok) {
        throw new Error(await response.text());
      }
      
      const result = await response.json();
      
      setChatMessages(prev => {
        const checkpointIndex = prev.findIndex(msg => msg.checkpointId === checkpointId);
        if (checkpointIndex !== -1) {
          const truncatedMessages = prev.slice(0, checkpointIndex + 1);
          return [...truncatedMessages, {
            type: 'system',
            content: `✅ Reverted to checkpoint: ${result.restoredFiles} files restored`,
            timestamp: new Date()
          }];
        }
        return [...prev, {
          type: 'system',
          content: `✅ Checkpoint restored: ${result.restoredFiles} files restored`,
          timestamp: new Date()
        }];
      });
      
      if (onProjectUpdate) {
        onProjectUpdate();
      }
    } catch (error) {
      console.error('Error restoring checkpoint:', error);
      setChatMessages(prev => [...prev, {
        type: 'error', 
        content: `Failed to restore checkpoint: ${error.message}`,
        timestamp: new Date()
      }]);
    }
  };

  const handleAbortSession = () => {
    if (sessionManager.getActiveSessionId() && claudeStatus?.can_interrupt) {
      sendMessage({
        type: 'abort-session',
        sessionId: sessionManager.getActiveSessionId()
      });
    }
  };

  const handleTranscript = useCallback((text) => {
    if (text.trim()) {
      setInput(prev => {
        const newInput = prev.trim() ? `${prev} ${text}` : text;
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
            const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight);
            setIsTextareaExpanded(textareaRef.current.scrollHeight > lineHeight * 2);
          }
        }, 0);
        return newInput;
      });
    }
  }, []);

  // Show only recent messages for performance
  const visibleMessages = useMemo(() => {
    return chatMessages.length > 100 ? chatMessages.slice(-100) : chatMessages;
  }, [chatMessages]);

  if (!selectedProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <p>Select a project to start chatting with Claude</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>
        {`
          details[open] .details-chevron {
            transform: rotate(180deg);
          }
        `}
      </style>
      <div className="h-full flex flex-col">
        {/* Messages Area */}
        <div 
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto overflow-x-hidden px-0 py-3 sm:p-4 space-y-3 sm:space-y-4 relative"
        >
          {isLoadingSessionMessages && chatMessages.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 mt-8">
              <div className="flex items-center justify-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
                <p>Loading session messages...</p>
              </div>
            </div>
          ) : chatMessages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-gray-500 dark:text-gray-400 px-6 sm:px-4">
                <p className="font-bold text-lg sm:text-xl mb-3">Start a conversation with Claude</p>
                <p className="text-sm sm:text-base leading-relaxed">
                  Ask questions about your code, request changes, or get help with development tasks
                </p>
              </div>
            </div>
          ) : (
            <>
              {chatMessages.length > 100 && (
                <div className="text-center text-gray-500 dark:text-gray-400 text-sm py-2 border-b border-gray-200 dark:border-gray-700">
                  Showing last 100 messages ({chatMessages.length} total)
                </div>
              )}
              
              {visibleMessages.map((message, index) => {
                const prevMessage = index > 0 ? visibleMessages[index - 1] : null;
                return (
                  <MessageComponent
                    key={index}
                    message={message}
                    index={index}
                    prevMessage={prevMessage}
                    createDiff={createDiff}
                    onFileOpen={onFileOpen}
                    onShowSettings={onShowSettings}
                    autoExpandTools={autoExpandTools}
                    showRawParameters={showRawParameters}
                    onRevertToCheckpoint={handleRevertToCheckpoint}
                  />
                );
              })}
            </>
          )}
          
          {isLoading && (
            <div className="chat-message assistant">
              <div className="w-full">
                <div className="flex items-center space-x-3 mb-2">
                  <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0">
                    C
                  </div>
                  <div className="text-sm font-medium text-gray-900 dark:text-white">Claude</div>
                </div>
                <div className="w-full text-sm text-gray-500 dark:text-gray-400 pl-3 sm:pl-0">
                  <div className="flex items-center space-x-1">
                    <div className="animate-pulse">●</div>
                    <div className="animate-pulse" style={{ animationDelay: '0.2s' }}>●</div>
                    <div className="animate-pulse" style={{ animationDelay: '0.4s' }}>●</div>
                    <span className="ml-2">Thinking...</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Floating scroll button */}
        {isUserScrolledUp && chatMessages.length > 0 && (
          <button
            onClick={scrollToBottom}
            className="fixed bottom-20 sm:bottom-24 right-4 sm:right-6 w-12 h-12 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:ring-offset-gray-800 z-50"
            title="Scroll to bottom"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </button>
        )}

        {/* Input Area */}
        <div className={`p-2 sm:p-4 md:p-6 flex-shrink-0 ${
          isInputFocused ? 'pb-2 sm:pb-4 md:pb-6' : 'pb-16 sm:pb-4 md:pb-6'
        }`}>
          <ClaudeStatus 
            status={claudeStatus}
            isLoading={isLoading}
            onAbort={handleAbortSession}
          />
          
          <form onSubmit={handleSubmit} className="relative max-w-4xl mx-auto">
            <div className={`relative bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-600 focus-within:ring-2 focus-within:ring-blue-500 dark:focus-within:ring-blue-500 focus-within:border-blue-500 transition-all duration-200 ${isTextareaExpanded ? 'chat-input-expanded' : ''}`}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onClick={(e) => setCursorPosition(e.target.selectionStart)}
                onKeyDown={handleKeyDown}
                onFocus={() => setIsInputFocused(true)}
                onBlur={() => setIsInputFocused(false)}
                onInput={(e) => {
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                  setCursorPosition(e.target.selectionStart);
                  
                  const lineHeight = parseInt(window.getComputedStyle(e.target).lineHeight);
                  setIsTextareaExpanded(e.target.scrollHeight > lineHeight * 2);
                }}
                placeholder="Ask Claude to help with your code... (@ to reference files)"
                disabled={isLoading}
                rows={1}
                className="w-full px-4 sm:px-6 py-3 sm:py-4 pr-28 sm:pr-40 bg-transparent rounded-2xl focus:outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 disabled:opacity-50 resize-none min-h-[40px] sm:min-h-[56px] max-h-[40vh] sm:max-h-[300px] overflow-y-auto text-sm sm:text-base transition-all duration-200"
                style={{ height: 'auto' }}
              />
              
              {/* Clear button */}
              {input.trim() && (
                <button
                  type="button"
                  onClick={() => {
                    setInput('');
                    if (textareaRef.current) {
                      textareaRef.current.style.height = 'auto';
                      textareaRef.current.focus();
                    }
                    setIsTextareaExpanded(false);
                  }}
                  className="absolute -left-0.5 -top-3 sm:right-28 sm:left-auto sm:top-1/2 sm:-translate-y-1/2 w-6 h-6 sm:w-8 sm:h-8 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600 rounded-full flex items-center justify-center transition-all duration-200 group z-10 shadow-sm"
                  title="Clear input"
                >
                  <svg className="w-3 h-3 sm:w-4 sm:h-4 text-gray-600 dark:text-gray-300 group-hover:text-gray-800 dark:group-hover:text-gray-100 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
              
              {/* Send button */}
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 w-12 h-12 sm:w-12 sm:h-12 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed rounded-full flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:ring-offset-gray-800"
              >
                <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white transform rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
              
              {/* File dropdown */}
              {showFileDropdown && filteredFiles.length > 0 && (
                <div className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto z-50">
                  {filteredFiles.map((file, index) => (
                    <div
                      key={file.path}
                      className={`px-4 py-2 cursor-pointer border-b border-gray-100 dark:border-gray-700 last:border-b-0 ${
                        index === selectedFileIndex
                          ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                      }`}
                      onClick={() => selectFile(file)}
                    >
                      <div className="font-medium text-sm">{file.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">{file.path}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {/* Hint text */}
            <div className="text-xs text-gray-500 dark:text-gray-400 text-center mt-2 hidden sm:block">
              Press Enter to send • Shift+Enter for new line • @ to reference files
            </div>
            <div className={`text-xs text-gray-500 dark:text-gray-400 text-center mt-2 sm:hidden transition-opacity duration-200 ${
              isInputFocused ? 'opacity-100' : 'opacity-0'
            }`}>
              Enter to send • @ for files
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

export default React.memo(ChatInterface);