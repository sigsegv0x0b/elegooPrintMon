#!/usr/bin/env node

const config = require('./config/config');
const logger = require('./utils/logger');
const MjpegCapture = require('./capture/mjpeg-capture');
const LLMClient = require('./llm/llm-client');
const TelegramNotifier = require('./notifications/telegram-notifier');
const ConsoleNotifier = require('./notifications/console-notifier');
const prompts = require('./llm/prompts');
const { createPrinterModule } = require('./printer/index');
const ImageCleanup = require('./utils/image-cleanup');

class PrintMonitor {
  constructor() {
    this.config = config;
    this.capture = new MjpegCapture();
    this.llmClient = new LLMClient();
    this.telegramNotifier = new TelegramNotifier();
    this.consoleNotifier = new ConsoleNotifier();
    
    // Create printer module if printer IP is configured
    this.printerModule = null;
    if (config.printerIP) {
      try {
        this.printerModule = createPrinterModule(config.printerIP);
        logger.info(`Printer module initialized with IP: ${config.printerIP}`);
      } catch (error) {
        logger.warn(`Failed to initialize printer module: ${error.message}`);
      }
    }

    // Create image cleanup service
    this.imageCleanup = new ImageCleanup('images');
    
    // Pass dependencies to Telegram notifier for command handling
    this.telegramNotifier.setDependencies(this.capture, this.llmClient, prompts, this, this.printerModule);
    
    this.isRunning = false;
    this.frameCount = 0;
    this.startTime = null;
    this.lastAnalysisTime = null;
    this.consoleMode = false;
    this.debugMode = false;
    
    // Queue system for LLM requests
    this.llmRequestQueue = [];
    this.isProcessingLLMRequest = false;
    this.llmRequestId = 0;
    
    // Printer status tracking for LLM_MODE=disabled
    this.lastPrinterStatus = null;
    this.lastPrinterStatusTime = null;
    this.lastNotificationTime = null;
    this.statusChangeNotificationCooldown = 60000; // 1 minute cooldown between status change notifications
    this.hasHadValidPrinterStatus = false; // Track if we've ever received a valid status
    
    // Statistics
    this.stats = {
      framesProcessed: 0,
      framesWithProblems: 0,
      totalProblemsDetected: 0,
      notificationsSent: 0,
      lastError: null,
      statusChangesDetected: 0,
      statusNotificationsSent: 0
    };
  }

  // Queue management methods
  async queueLLMRequest(requestType, options = {}) {
    const requestId = ++this.llmRequestId;
    const request = {
      id: requestId,
      type: requestType,
      options,
      timestamp: Date.now(),
      promise: null,
      resolve: null,
      reject: null
    };
    
    // Create a promise that will be resolved when the request is processed
    request.promise = new Promise((resolve, reject) => {
      request.resolve = resolve;
      request.reject = reject;
    });
    
    // Add to queue
    this.llmRequestQueue.push(request);
    logger.debug(`Queued LLM request #${requestId} (${requestType}), queue length: ${this.llmRequestQueue.length}`);
    
    // Process queue if not already processing
    if (!this.isProcessingLLMRequest) {
      this.processLLMQueue();
    }
    
    return request.promise;
  }
  
  async processLLMQueue() {
    if (this.isProcessingLLMRequest || this.llmRequestQueue.length === 0) {
      return;
    }
    
    this.isProcessingLLMRequest = true;
    
    while (this.llmRequestQueue.length > 0) {
      const request = this.llmRequestQueue.shift();
      logger.debug(`Processing LLM request #${request.id} (${request.type})`);
      
      try {
        let result;
        
        switch (request.type) {
          case 'status':
            result = await this.processStatusRequest(request.options);
            break;
          case 'analyze':
            result = await this.processAnalyzeRequest(request.options);
            break;
          case 'frame':
            result = await this.processFrameRequest(request.options);
            break;
          default:
            throw new Error(`Unknown request type: ${request.type}`);
        }
        
        request.resolve(result);
      } catch (error) {
        logger.error(`LLM request #${request.id} failed: ${error.message}`);
        request.reject(error);
      }
      
      // Small delay between requests to prevent overwhelming the LLM
      if (this.llmRequestQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    this.isProcessingLLMRequest = false;
  }
  
  async processStatusRequest(options) {
    const { source = 'unknown', chatId = null } = options;
    logger.info(`Processing status request from ${source}${chatId ? ` (chat: ${chatId})` : ''}`);
    
    // Capture current frame
    const frameBuffer = await this.capture.captureFrame();
    if (!frameBuffer) {
      throw new Error('Failed to capture frame');
    }
    
    let analysis = null;
    
    if (this.config.llmMode === 'enabled') {
      // Analyze with LLM
      analysis = await this.llmClient.analyzeImage(
        frameBuffer,
        prompts.systemPrompt,
        prompts.getUserPrompt(),
        this.debugMode
      );
    }
    
    // Get printer status if available
    let printerStatus = null;
    if (this.printerModule) {
      try {
        printerStatus = this.printerModule.getStatus();
      } catch (error) {
        logger.warn(`Failed to get printer status: ${error.message}`);
      }
    }
    
    return {
      frameBuffer,
      analysis,
      printerStatus,
      llmEnabled: this.config.llmMode === 'enabled',
      timestamp: Date.now()
    };
  }
  
  async processAnalyzeRequest(options) {
    const { source = 'unknown', chatId = null } = options;
    logger.info(`Processing analyze request from ${source}${chatId ? ` (chat: ${chatId})` : ''}`);
    
    // Same as status but with more detailed logging
    const result = await this.processStatusRequest(options);
    
    // Additional processing for analyze requests could go here
    return result;
  }
  
  async processFrameRequest(options) {
    const { source = 'unknown' } = options;
    logger.debug(`Processing frame capture request from ${source}`);
    
    // Just capture frame without LLM analysis
    const frameBuffer = await this.capture.captureFrame();
    if (!frameBuffer) {
      throw new Error('Failed to capture frame');
    }
    
    return {
      frameBuffer,
      timestamp: Date.now()
    };
  }

  /**
   * Check if printer status has changed significantly
   * Returns true if status changed and should trigger notification
   * Only checks the machine field (status.machine.code) as requested
   */
  hasPrinterStatusChanged(currentStatus, previousStatus) {
    // Debug logging to help diagnose issues
    logger.debug(`Checking status change: current=${currentStatus?.success ? 'valid' : 'invalid'}, previous=${previousStatus?.success ? 'valid' : 'invalid/null'}`);

    if (!currentStatus || !currentStatus.success) {
      logger.debug('No valid current status - returning false');
      return false; // No valid current status
    }

    // If this is the very first valid status we've ever received, notify about it
    if (!this.hasHadValidPrinterStatus) {
      logger.debug('First valid printer status ever - returning true');
      this.hasHadValidPrinterStatus = true;
      return true;
    }

    if (!previousStatus || !previousStatus.success) {
      logger.debug('Previous status invalid - not notifying (already had valid status before)');
      return false; // We already notified about the first valid status, don't notify again
    }

    // Safety check: if current and previous are the same object reference, no change
    if (currentStatus === previousStatus) {
      logger.debug('Current and previous status are the same object reference - returning false');
      return false;
    }

    // Check machine status change (Idle -> Printing, etc.)
    const currentMachineStatus = currentStatus.status?.machine?.code;
    const previousMachineStatus = previousStatus.status?.machine?.code;
    const currentMachineText = currentStatus.status?.machine?.text || 'Unknown';
    const previousMachineText = previousStatus.status?.machine?.text || 'Unknown';

    logger.debug(`Machine status comparison: ${previousMachineText}(${previousMachineStatus}, type: ${typeof previousMachineStatus}) -> ${currentMachineText}(${currentMachineStatus}, type: ${typeof currentMachineStatus})`);

    // Safety check: ensure status objects have the expected structure
    if (!currentStatus.status?.machine || !previousStatus.status?.machine) {
      logger.debug('Status object structure check failed - missing status.machine');
      return false; // Don't notify if status objects are malformed
    }

    // Safety check: ensure both values are defined and are numbers
    if (typeof currentMachineStatus !== 'number' || typeof previousMachineStatus !== 'number') {
      logger.debug(`Machine status type check failed - current: ${typeof currentMachineStatus}, previous: ${typeof previousMachineStatus}`);
      return false; // Don't notify if status codes are malformed
    }

    // Debug: log the actual comparison
    logger.debug(`Comparison: ${currentMachineStatus} != ${previousMachineStatus} = ${currentMachineStatus != previousMachineStatus}`);

    // Use strict equality for numbers to avoid type coercion issues
    if (currentMachineStatus !== previousMachineStatus) {
      logger.info(`Machine status changed: ${previousMachineText}(${previousMachineStatus}) -> ${currentMachineText}(${currentMachineStatus})`);
      return true;
    }

    logger.debug(`No machine status change detected (${currentMachineText} -> ${currentMachineText})`);
    return false; // No machine status change detected
  }

  /**
   * Send printer status change notification
   */
  async sendPrinterStatusChangeNotification(currentStatus, previousStatus, frameNumber, imageBuffer) {
    try {
      const now = Date.now();
      
      // Check cooldown period
      if (this.lastNotificationTime && (now - this.lastNotificationTime) < this.statusChangeNotificationCooldown) {
        logger.debug(`Skipping status change notification due to cooldown`);
        return false;
      }
      
      logger.info(`Sending printer status change notification for frame #${frameNumber}`);
      
      // Get machine status texts for change description
      const currentMachineText = currentStatus.status?.machine?.text || 'Unknown';
      const previousMachineText = previousStatus?.status?.machine?.text || 'Unknown';
      const currentMachineCode = currentStatus.status?.machine?.code;
      const previousMachineCode = previousStatus?.status?.machine?.code;
      
      // Format status message with change information
      let message = `🔄 **Printer Status Change Detected**\n`;
      message += `Frame: #${frameNumber}\n`;
      message += `Time: ${new Date().toLocaleString()}\n\n`;
      
      // Show what changed
      message += `📋 **Changed:** ${previousMachineText} → ${currentMachineText}\n`;
      
      if (currentStatus.printer?.name) {
        message += `🖨️ ${currentStatus.printer.name}\n`;
      }
      
      // Show current machine status (already shown in Changed field, but include for clarity)
      message += `📋 Machine: ${currentMachineText}\n`;
      
      if (currentStatus.status?.print?.text) {
        message += `🖨️ Print: ${currentStatus.status.print.text}\n`;
      }
      
      if (currentStatus.status?.print?.filename) {
        message += `📄 File: ${currentStatus.status.print.filename}\n`;
      }
      
      if (currentStatus.progress?.percent) {
        message += `📊 Progress: ${currentStatus.progress.percent}% (Layer ${currentStatus.progress.currentLayer}/${currentStatus.progress.totalLayers})\n`;
      }
      
      if (currentStatus.time?.remaining) {
        message += `⏱️ ETA: ${currentStatus.time.remaining}\n`;
      }
      
      // Send to console
      await this.consoleNotifier.sendStatusChangeNotification({
        frameNumber,
        message,
        status: currentStatus,
        previousStatus: previousStatus,
        imageBuffer
      });
      
      // Send to Telegram if configured
      let telegramSent = false;
      if (this.telegramNotifier.isConfigured()) {
        telegramSent = await this.telegramNotifier.sendStatusChangeNotification({
          frameNumber,
          message,
          status: currentStatus,
          previousStatus: previousStatus,
          imageBuffer
        });
      }
      
      this.lastNotificationTime = now;
      this.stats.statusChangesDetected++;
      if (telegramSent) {
        this.stats.statusNotificationsSent++;
      }
      
      return true;
      
    } catch (error) {
      logger.error(`Failed to send status change notification: ${error.message}`);
      return false;
    }
  }

  async initialize() {
    try {
      logger.info('=== Elegoo Print Monitor Initializing ===');
      
      // Validate configuration
      this.config.validate();
      
      logger.info(`Stream URL: ${this.config.mjpegStreamUrl}`);
      logger.info(`Capture interval: ${this.config.frameCaptureInterval}ms`);
      logger.info(`LLM Mode: ${this.config.llmMode}`);
      
      if (this.config.llmMode === 'enabled') {
        logger.info(`LLM Model: ${this.config.llmModel}`);
        logger.info(`LLM URL: ${this.config.openaiUrl}`);
        logger.info(`Notification threshold: ${this.config.notificationThreshold}`);
      } else {
        logger.info('LLM processing: DISABLED - will only capture frames and show printer status');
      }
      
      if (this.telegramNotifier.isConfigured()) {
        logger.info('Telegram notifications: ENABLED');
      } else {
        logger.warn('Telegram notifications: DISABLED (credentials not provided)');
      }
      
      // Check for console mode flag
      if (process.argv.includes('--console') || process.argv.includes('-c')) {
        this.consoleMode = true;
        logger.info('Console mode: ENABLED');
      }
      
      // Check for debug mode flag
      if (process.argv.includes('--debug') || process.argv.includes('-d')) {
        this.debugMode = true;
        logger.info('Debug mode: ENABLED');
        // Set log level to debug
        logger.level = 'debug';
      }
      
      // Test connections
      await this.testConnections();
      
      logger.info('=== Initialization Complete ===');
      return true;
      
    } catch (error) {
      logger.error(`Initialization failed: ${error.message}`);
      throw error;
    }
  }

  async testConnections() {
    logger.info('Testing connections...');
    
    // Test MJPEG stream connection
    const streamConnected = await this.capture.testConnection();
    if (!streamConnected) {
      logger.warn('MJPEG stream connection test failed - will attempt to connect during capture');
    } else {
      logger.info('MJPEG stream: CONNECTED');
    }
    
    let llmConnected = true; // Default to true if LLM mode is disabled
    
    // Test LLM API connection only if LLM mode is enabled
    if (this.config.llmMode === 'enabled') {
      llmConnected = await this.llmClient.testConnection();
      if (!llmConnected) {
        logger.warn('LLM API connection test failed - will attempt to connect during analysis');
      } else {
        logger.info('LLM API: CONNECTED');
      }
    } else {
      logger.info('LLM API: SKIPPED (LLM mode disabled)');
    }
    
    // Test Telegram if configured
    if (this.telegramNotifier.isConfigured()) {
      const telegramTest = await this.telegramNotifier.sendTestMessage();
      if (!telegramTest) {
        logger.warn('Telegram test failed - notifications may not work');
      } else {
        logger.info('Telegram: CONNECTED');
      }
    }
    
    return streamConnected && llmConnected;
  }

  async processFrame(frameBuffer) {
    this.frameCount++;
    const frameNumber = this.frameCount;
    
    logger.info(`Processing frame #${frameNumber}`);
    
    try {
      let analysis = null;
      
      if (this.config.llmMode === 'enabled') {
        // Check if we should skip LLM analysis for efficiency
        let skipLLMAnalysis = false;

        // Get printer status to check if we can skip analysis
        let printerStatus = null;
        if (this.printerModule) {
          try {
            printerStatus = await this.printerModule.getStatus();
            logger.debug(`Printer status for analysis decision: machine=${printerStatus?.status?.machine?.code}, print=${printerStatus?.status?.print?.code}, success=${printerStatus?.success}`);
          } catch (error) {
            logger.debug(`Could not get printer status for analysis decision: ${error.message}`);
          }
        }

        // Only perform LLM analysis when printer is actively printing
        let shouldAnalyze = false;

        if (printerStatus && printerStatus.success) {
          const machineStatus = printerStatus.status?.machine?.code;
          const machineText = printerStatus.status?.machine?.text || 'Unknown';

          logger.debug(`Checking analysis conditions: machineStatus=${machineStatus} (${machineText}), type: ${typeof machineStatus}`);

          // Only analyze when machine is actively printing (1)
          if (machineStatus === 1) {
            shouldAnalyze = true;
            logger.debug(`Performing LLM analysis - printer is actively printing (${machineText})`);
          } else {
            logger.info(`Skipping LLM analysis for frame ${frameNumber} - printer not actively printing (${machineText})`);
          }
        } else {
          logger.debug(`Skipping LLM analysis - no valid printer status available`);
        }

        // Skip LLM analysis unless printer is actively printing
        if (!shouldAnalyze) {
          skipLLMAnalysis = true;
        }

        if (!skipLLMAnalysis) {
          const startTime = Date.now();

          // Analyze frame with LLM
          analysis = await this.llmClient.analyzeImage(
            frameBuffer,
            prompts.systemPrompt,
            prompts.getUserPrompt(),
            this.debugMode
          );

          const analysisTime = Date.now() - startTime;
          this.lastAnalysisTime = Date.now();

          // Log analysis result
          logger.logAnalysisResult(frameNumber, analysis);
          logger.debug(`Analysis completed in ${analysisTime}ms`);

          // Display analysis results to console for normal mode
          if (!this.consoleMode) {
            this.consoleNotifier.displayFrameAnalysis(frameNumber, analysis);
          }

          // Check for problems that need notification
          const criticalProblems = analysis.problems.filter(
            problem => problem.confidence >= this.config.notificationThreshold
          );

          if (criticalProblems.length > 0) {
            this.stats.framesWithProblems++;
            this.stats.totalProblemsDetected += criticalProblems.length;

            logger.warn(`Detected ${criticalProblems.length} critical problems in frame ${frameNumber}`);

            // Log each critical problem
            criticalProblems.forEach(problem => {
              logger.logCriticalProblem(frameNumber, problem);
            });

            // Always send alert to console
            await this.consoleNotifier.sendAlert({
              frameNumber,
              problems: criticalProblems,
              overallStatus: analysis.overall_status,
              imageBuffer: frameBuffer,
              analysisSummary: {
                objectsCount: analysis.objects?.length || 0,
                problemsCount: analysis.problems?.length || 0,
                objects: analysis.objects || [], // Include full objects array for annotation
                analysis: analysis // Include full analysis for annotation
              }
            });

            // Also send to Telegram if configured
            if (this.telegramNotifier.isConfigured()) {
              const notificationSent = await this.telegramNotifier.sendAlert({
                frameNumber,
                problems: criticalProblems,
                overallStatus: analysis.overall_status,
                imageBuffer: frameBuffer,
                analysisSummary: {
                  objectsCount: analysis.objects?.length || 0,
                  problemsCount: analysis.problems?.length || 0,
                  objects: analysis.objects || [], // Include full objects array for annotation
                  analysis: analysis // Include full analysis for annotation
                }
              });

              if (notificationSent) {
                this.stats.notificationsSent++;
              }
            }
          }
        } else {
          // LLM analysis was skipped
          logger.debug(`Frame ${frameNumber} processed without LLM analysis (printer idle)`);
        }

        // Update statistics (count as processed regardless of LLM analysis)
        this.stats.framesProcessed++;
      } else {
        // LLM mode disabled - just capture frame and check for status changes
        logger.info(`Frame #${frameNumber} captured (LLM analysis disabled)`);
        this.stats.framesProcessed++;
        
        // Display simple frame capture message to console only (not Telegram)
        if (!this.consoleMode) {
          this.consoleNotifier.displayFrameCapture(frameNumber);
        }
        
        // Get printer status if available
        let printerStatus = null;
        if (this.printerModule) {
          try {
            printerStatus = await this.printerModule.getStatus();
            logger.debug(`Printer status retrieved for frame #${frameNumber}`);
            
            // Check if status has changed significantly
            const statusChanged = this.hasPrinterStatusChanged(printerStatus, this.lastPrinterStatus);
            
            if (statusChanged) {
              // Send status change notification with previous status for comparison
              await this.sendPrinterStatusChangeNotification(printerStatus, this.lastPrinterStatus, frameNumber, frameBuffer);
            }
            
            // Update last status
            this.lastPrinterStatus = printerStatus;
            this.lastPrinterStatusTime = Date.now();
            
          } catch (error) {
            logger.warn(`Failed to get printer status: ${error.message}`);
          }
        }
        
        // Only send simple console status (no Telegram) for regular frames
        // User can request status via commands when needed
        await this.consoleNotifier.sendSimpleStatus({
          frameNumber,
          imageBuffer: frameBuffer,
          printerStatus,
          llmEnabled: false,
          isStatusChange: false // Regular frame, not a status change
        });
      }
      
      // Periodic status update (every 10 frames)
      if (frameNumber % 10 === 0) {
        await this.sendStatusUpdate();
      }
      
      return analysis;
      
    } catch (error) {
      this.stats.lastError = {
        time: new Date().toISOString(),
        frameNumber,
        error: error.message
      };
      
      logger.error(`Frame ${frameNumber} processing failed: ${error.message}`);
      return null;
    }
  }

  async sendStatusUpdate() {
    const uptime = Date.now() - this.startTime;

    // Always send to console
    await this.consoleNotifier.sendStatusUpdate({
      frameCount: this.frameCount,
      uptime,
      lastAnalysis: this.lastAnalysisTime,
      systemStatus: 'operational'
    });

    // Status updates are not sent to Telegram to avoid spam
    // Users can request status manually via Telegram commands
  }

  start() {
    if (this.isRunning) {
      logger.warn('Monitor already running');
      return;
    }

    this.initialize().then(() => {
      this.isRunning = true;
      this.startTime = Date.now();
      this.lastAnalysisTime = Date.now();

      logger.info('=== Starting Print Monitor ===');

      // Start image cleanup service
      this.imageCleanup.start();

      // Start frame capture
      this.capture.startCapture(async (frameBuffer) => {
        await this.processFrame(frameBuffer);
      });

      logger.info('Print Monitor started successfully');

      // Start console mode if enabled
      if (this.consoleMode) {
        this.consoleNotifier.startInteractiveMode(this.capture, this.llmClient, prompts, this.debugMode, this, this.printerModule);
      }

      // Handle graceful shutdown
      this.setupShutdownHandlers();

    }).catch(error => {
      logger.error(`Failed to start monitor: ${error.message}`);
      this.shutdown(1);
    });
  }

  setupShutdownHandlers() {
    const shutdown = (signal) => {
      logger.info(`Received ${signal}, shutting down...`);
      this.stop();
    };
    
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGQUIT', () => shutdown('SIGQUIT'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error(`Uncaught exception: ${error.message}`, { stack: error.stack });
      this.shutdown(1);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      logger.error(`Unhandled promise rejection: ${reason}`);
    });
  }

  stop() {
    if (!this.isRunning) {
      logger.warn('Monitor not running');
      return;
    }

    logger.info('Shutting down Print Monitor...');

    this.isRunning = false;
    this.capture.stopCapture();

    // Stop image cleanup service
    this.imageCleanup.stop();

    // Log final statistics
    this.logFinalStatistics();

    logger.info('Print Monitor stopped');
    process.exit(0);
  }

  logFinalStatistics() {
    const uptime = Date.now() - this.startTime;
    const uptimeFormatted = this.formatUptime(uptime);
    
    logger.info('=== Final Statistics ===');
    logger.info(`Total runtime: ${uptimeFormatted}`);
    logger.info(`Frames processed: ${this.stats.framesProcessed}`);
    logger.info(`Frames with problems: ${this.stats.framesWithProblems}`);
    logger.info(`Total problems detected: ${this.stats.totalProblemsDetected}`);
    logger.info(`Notifications sent: ${this.stats.notificationsSent}`);
    logger.info(`Status changes detected: ${this.stats.statusChangesDetected}`);
    logger.info(`Status notifications sent: ${this.stats.statusNotificationsSent}`);
    
    if (this.stats.lastError) {
      logger.warn(`Last error (frame ${this.stats.lastError.frameNumber}): ${this.stats.lastError.error}`);
    }
  }

  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  shutdown(exitCode = 0) {
    this.stop();
    process.exit(exitCode);
  }
}

// Start the application
if (require.main === module) {
  const monitor = new PrintMonitor();
  monitor.start();
}

module.exports = PrintMonitor;