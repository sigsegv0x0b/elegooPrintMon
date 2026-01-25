#!/usr/bin/env node

const config = require('./config/config');
const logger = require('./utils/logger');
const MjpegCapture = require('./capture/mjpeg-capture');
const LLMClient = require('./llm/llm-client');
const TelegramNotifier = require('./notifications/telegram-notifier');
const ConsoleNotifier = require('./notifications/console-notifier');
const prompts = require('./llm/prompts');

class PrintMonitor {
  constructor() {
    this.config = config;
    this.capture = new MjpegCapture();
    this.llmClient = new LLMClient();
    this.telegramNotifier = new TelegramNotifier();
    this.consoleNotifier = new ConsoleNotifier();
    
    // Pass dependencies to Telegram notifier for command handling
    this.telegramNotifier.setDependencies(this.capture, this.llmClient, prompts);
    
    this.isRunning = false;
    this.frameCount = 0;
    this.startTime = null;
    this.lastAnalysisTime = null;
    this.consoleMode = false;
    this.debugMode = false;
    
    // Statistics
    this.stats = {
      framesProcessed: 0,
      framesWithProblems: 0,
      totalProblemsDetected: 0,
      notificationsSent: 0,
      lastError: null
    };
  }

  async initialize() {
    try {
      logger.info('=== Elegoo Print Monitor Initializing ===');
      
      // Validate configuration
      this.config.validate();
      
      logger.info(`Stream URL: ${this.config.mjpegStreamUrl}`);
      logger.info(`Capture interval: ${this.config.frameCaptureInterval}ms`);
      logger.info(`LLM Model: ${this.config.llmModel}`);
      logger.info(`LLM URL: ${this.config.openaiUrl}`);
      logger.info(`Notification threshold: ${this.config.notificationThreshold}`);
      
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
    
    // Test LLM API connection
    const llmConnected = await this.llmClient.testConnection();
    if (!llmConnected) {
      logger.warn('LLM API connection test failed - will attempt to connect during analysis');
    } else {
      logger.info('LLM API: CONNECTED');
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
      const startTime = Date.now();
      
      // Analyze frame with LLM
      const analysis = await this.llmClient.analyzeImage(
        frameBuffer,
        prompts.systemPrompt,
        prompts.getUserPrompt(),
        this.debugMode
      );
      
      const analysisTime = Date.now() - startTime;
      this.lastAnalysisTime = Date.now();
      
      // Update statistics
      this.stats.framesProcessed++;
      
      // Log analysis result
      logger.logAnalysisResult(frameNumber, analysis);
      logger.debug(`Analysis completed in ${analysisTime}ms`);
      
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
    
    // Also send to Telegram if configured
    if (this.telegramNotifier.isConfigured()) {
      await this.telegramNotifier.sendStatusUpdate({
        frameCount: this.frameCount,
        uptime,
        lastAnalysis: this.lastAnalysisTime,
        systemStatus: 'operational'
      });
    }
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
      
      // Start frame capture
      this.capture.startCapture(async (frameBuffer) => {
        await this.processFrame(frameBuffer);
      });
      
      logger.info('Print Monitor started successfully');
      
      // Start console mode if enabled
      if (this.consoleMode) {
        this.consoleNotifier.startInteractiveMode(this.capture, this.llmClient, prompts, this.debugMode);
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