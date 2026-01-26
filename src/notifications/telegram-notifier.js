const TelegramBot = require('node-telegram-bot-api');
const config = require('../config/config');
const logger = require('../utils/logger');
const sharp = require('sharp');
const ImageAnnotator = require('../utils/image-annotator');

class TelegramNotifier {
  constructor() {
    this.botToken = config.telegramBotToken;
    this.chatId = config.telegramChatId;
    this.alertLevel = config.telegramAlertLevel || 'critical'; // 'all', 'warning', 'critical', 'none'
    this.bot = null;
    this.isInitialized = false;
    this.imageAnnotator = new ImageAnnotator();
    this.printerModule = null;
    
    this.initialize();
  }

  initialize() {
    // Check if Telegram credentials are provided
    if (!this.botToken || !this.chatId) {
      logger.warn('Telegram credentials not provided - notifications disabled');
      this.isInitialized = false;
      return;
    }

    try {
      this.bot = new TelegramBot(this.botToken, { polling: true });
      this.isInitialized = true;
      logger.info('Telegram notifier initialized successfully');
      
      // Setup command handlers
      this.setupCommandHandlers();
    } catch (error) {
      logger.error(`Failed to initialize Telegram bot: ${error.message}`);
      this.isInitialized = false;
    }
  }

  async sendAlert(alertData) {
    if (!this.isInitialized) {
      logger.warn('Telegram notifier not initialized - skipping notification');
      return false;
    }

    const {
      frameNumber,
      problems,
      overallStatus,
      imageBuffer,
      analysisSummary = null
    } = alertData;

    // Check if we should send alert based on alert level
    if (!this.shouldSendAlert(overallStatus)) {
      logger.info(`Skipping Telegram alert for frame ${frameNumber} - alert level '${this.alertLevel}' doesn't match status '${overallStatus}'`);
      return false;
    }

    try {
      logger.info(`Sending Telegram alert for frame ${frameNumber} with ${problems.length} problems`);

      // Prepare message
      const message = this.formatAlertMessage(frameNumber, problems, overallStatus, analysisSummary);
      
      // Send text message
      await this.bot.sendMessage(this.chatId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });

      // If we have an image buffer, send annotated version as a photo
      if (imageBuffer && imageBuffer.length > 0) {
        try {
          // Create annotated image if we have analysis data
          let imageToSend = imageBuffer;
          let caption = `Frame ${frameNumber} - Detected issues`;
          
          if (analysisSummary && analysisSummary.analysis && 
              ((analysisSummary.analysis.objects && analysisSummary.analysis.objects.length > 0) || 
               (analysisSummary.analysis.problems && analysisSummary.analysis.problems.length > 0))) {
            
            try {
              // Create annotated image
              const annotatedImage = await this.imageAnnotator.annotateImage(
                imageBuffer,
                analysisSummary.analysis,
                {
                  showLabels: true,
                  showConfidence: true,
                  showStatus: true,
                  borderWidth: 3,
                  fontSize: 16
                }
              );
              
              imageToSend = annotatedImage;
              caption = `Frame ${frameNumber} - Annotated analysis`;
              
              logger.info(`Created annotated image for Telegram (${annotatedImage.length} bytes)`);
            } catch (annotationError) {
              logger.warn(`Failed to create annotated image: ${annotationError.message}`);
              // Continue with original image
            }
          }
          
          // Resize image if it's too large for Telegram (max 10MB, but smaller is better)
          const resizedImage = await sharp(imageToSend)
            .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();

          await this.bot.sendPhoto(this.chatId, resizedImage, {
            caption: caption
          });
          
          logger.info(`Sent ${caption.toLowerCase()} to Telegram`);
        } catch (imageError) {
          logger.warn(`Failed to send image with Telegram alert: ${imageError.message}`);
          // Continue without image
        }
      }

      // Send detailed problem information
      if (problems.length > 0) {
        const problemsMessage = this.formatProblemsDetails(problems);
        await this.bot.sendMessage(this.chatId, problemsMessage, {
          parse_mode: 'HTML',
          disable_web_page_preview: true
        });
      }

      logger.logNotificationSent(frameNumber, problems.length);
      return true;

    } catch (error) {
      logger.logNotificationFailed(frameNumber, error);
      return false;
    }
  }

  formatAlertMessage(frameNumber, problems, overallStatus, analysisSummary = null) {
    const statusEmoji = {
      'good': '✅',
      'warning': '⚠️',
      'critical': '🚨',
      'error': '❌'
    }[overallStatus] || '❓';

    let message = `<b>${statusEmoji} 3D Print Alert</b>\n`;
    message += `Frame: <code>${frameNumber}</code>\n`;
    message += `Status: <b>${overallStatus.toUpperCase()}</b>\n`;
    message += `Problems detected: <b>${problems.length}</b>\n`;
    message += `Time: ${new Date().toLocaleString()}\n`;

    if (analysisSummary) {
      message += `Objects detected: ${analysisSummary.objectsCount || 0}\n`;
    }

    return message;
  }

  formatProblemsDetails(problems) {
    if (problems.length === 0) {
      return '<i>No specific problems identified</i>';
    }

    let message = '<b>📋 Detected Problems:</b>\n\n';

    problems.forEach((problem, index) => {
      const confidencePercent = Math.round(problem.confidence * 100);
      const confidenceColor = problem.confidence >= 0.8 ? '🟢' : 
                            problem.confidence >= 0.6 ? '🟡' : '🔴';
      
      message += `<b>${index + 1}. ${problem.issue}</b>\n`;
      message += `   Reason: ${problem.reason}\n`;
      message += `   Confidence: ${confidenceColor} ${confidencePercent}%\n`;
      
      if (problem.bounding_box && Array.isArray(problem.bounding_box)) {
        const [x1, y1, x2, y2] = problem.bounding_box;
        message += `   Location: [${x1.toFixed(2)}, ${y1.toFixed(2)}] to [${x2.toFixed(2)}, ${y2.toFixed(2)}]\n`;
      }
      
      message += '\n';
    });

    return message;
  }

  async sendTestMessage() {
    if (!this.isInitialized) {
      logger.warn('Telegram notifier not initialized - cannot send test message');
      return false;
    }

    try {
      const testMessage = `<b>✅ Elegoo Print Monitor Test</b>\n\n` +
                         `This is a test message from your 3D print monitoring system.\n` +
                         `Time: ${new Date().toLocaleString()}\n` +
                         `System: Operational ✅`;

      await this.bot.sendMessage(this.chatId, testMessage, {
        parse_mode: 'HTML'
      });

      logger.info('Test message sent successfully to Telegram');
      return true;
    } catch (error) {
      logger.error(`Failed to send test message: ${error.message}`);
      return false;
    }
  }

  async sendStatusUpdate(statusData) {
    if (!this.isInitialized) {
      return false;
    }

    const {
      frameCount,
      uptime,
      lastAnalysis,
      systemStatus = 'operational'
    } = statusData;

    try {
      const statusEmoji = systemStatus === 'operational' ? '✅' : '⚠️';
      const uptimeFormatted = this.formatUptime(uptime);

      const message = `<b>${statusEmoji} System Status Update</b>\n\n` +
                     `Frames processed: <b>${frameCount}</b>\n` +
                     `Uptime: <code>${uptimeFormatted}</code>\n` +
                     `Last analysis: ${lastAnalysis ? new Date(lastAnalysis).toLocaleTimeString() : 'N/A'}\n` +
                     `Status: <b>${systemStatus.toUpperCase()}</b>\n` +
                     `Time: ${new Date().toLocaleString()}`;

      await this.bot.sendMessage(this.chatId, message, {
        parse_mode: 'HTML'
      });

      logger.info('Status update sent to Telegram');
      return true;
    } catch (error) {
      logger.error(`Failed to send status update: ${error.message}`);
      return false;
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

  // Check if Telegram is configured and working
  isConfigured() {
    return this.isInitialized;
  }

  // Setup command handlers for Telegram bot
  setupCommandHandlers() {
    if (!this.bot) return;

    // Help command
    this.bot.onText(/\/help|help/i, (msg) => {
      this.handleHelpCommand(msg);
    });

    // Status command
    this.bot.onText(/\/status|status/i, (msg) => {
      this.handleStatusCommand(msg);
    });

    // Capture command
    this.bot.onText(/\/capture|capture/i, (msg) => {
      this.handleCaptureCommand(msg);
    });

    // Analyze command
    this.bot.onText(/\/analyze|analyze/i, (msg) => {
      this.handleAnalyzeCommand(msg);
    });

    // Start command
    this.bot.onText(/\/start|start/i, (msg) => {
      this.handleStartCommand(msg);
    });

    // Alert level command
    this.bot.onText(/\/alertlevel/i, (msg) => {
      this.handleAlertLevelCommand(msg);
    });

    logger.info('Telegram bot command handlers registered');
  }

  // Handle help command
  async handleHelpCommand(msg) {
    const chatId = msg.chat.id;
    const helpMessage = `
🤖 <b>Elegoo Print Monitor Bot Commands</b>

Available commands:

<b>📊 Status & Monitoring</b>
• <code>/status</code> or <code>status</code> - Get current print status with AI analysis
• <code>/capture</code> or <code>capture</code> - Capture and send current frame
• <code>/analyze</code> or <code>analyze</code> - Capture, analyze, and send detailed AI analysis

<b>🔔 Alert Configuration</b>
• <code>/alertlevel</code> - Configure automatic notification settings
  - <code>/alertlevel all</code> - Send alerts for all statuses
  - <code>/alertlevel warning</code> - Send alerts for warning+
  - <code>/alertlevel critical</code> - Send alerts only for critical+ (default)
  - <code>/alertlevel none</code> - Disable all automatic alerts

<b>ℹ️ Information</b>
• <code>/help</code> or <code>help</code> - Show this help message
• <code>/start</code> or <code>start</code> - Welcome message

<b>🔧 System Info</b>
• System automatically monitors prints 24/7
• Sends alerts based on configured alert level
• All images include annotated bounding boxes
• Commands work regardless of alert level setting

Type any command to interact with your print monitor!
    `;

    try {
      await this.bot.sendMessage(chatId, helpMessage, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
    } catch (error) {
      logger.error(`Failed to send help message: ${error.message}`);
    }
  }

  // Handle start command
  async handleStartCommand(msg) {
    const chatId = msg.chat.id;
    const welcomeMessage = `
🎉 <b>Welcome to Elegoo Print Monitor!</b>

Your 3D print monitoring system is now connected via Telegram.

I will monitor your Elegoo Centauri Carbon printer 24/7 and send alerts when issues are detected.

<b>Quick Start:</b>
1. I'm already monitoring your printer automatically
2. Use <code>/status</code> to check current print status
3. Use <code>/help</code> to see all available commands

<b>Features:</b>
• Real-time print monitoring
• AI-powered issue detection
• Annotated images with bounding boxes
• Instant Telegram notifications

Happy printing! 🖨️
    `;

    try {
      await this.bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
    } catch (error) {
      logger.error(`Failed to send welcome message: ${error.message}`);
    }
  }

  // Handle status command - uses queue system
  async handleStatusCommand(msg) {
    const chatId = msg.chat.id;
    
    try {
      await this.bot.sendMessage(chatId, '📊 <b>Status Command Received</b>\nGetting printer status...', {
        parse_mode: 'HTML'
      });

      // First, get printer status immediately if printer module is available
      let printerStatusMessage = '';
      if (this.printerModule) {
        try {
          const printerStatus = await this.printerModule.getStatusText();
          printerStatusMessage = `<b>🖨️ Printer Status:</b>\n${printerStatus}`;
          
          // Send printer status immediately
          await this.bot.sendMessage(chatId, printerStatusMessage, {
            parse_mode: 'HTML',
            disable_web_page_preview: true
          });
          
        } catch (printerError) {
          logger.warn(`Failed to get printer status: ${printerError.message}`);
          await this.bot.sendMessage(chatId, '⚠️ <i>Printer status unavailable</i>', {
            parse_mode: 'HTML'
          });
        }
      } else {
        await this.bot.sendMessage(chatId, 'ℹ️ <i>Printer status module not configured</i>', {
          parse_mode: 'HTML'
        });
      }

      // Now proceed with LLM analysis
      await this.bot.sendMessage(chatId, '🤖 <b>Now analyzing with AI...</b>\nQueuing request for visual analysis...', {
        parse_mode: 'HTML'
      });

      // Check if we have the required dependencies for LLM analysis
      if (!this.capture || !this.llmClient || !this.prompts) {
        await this.bot.sendMessage(chatId, '⚠️ <b>System Not Ready</b>\nCommand handling dependencies not available. Please ensure the main application is running.', {
          parse_mode: 'HTML'
        });
        return;
      }

      // Use queue system if available, otherwise fall back to direct processing
      let result;
      if (this.printMonitor && this.printMonitor.queueLLMRequest) {
        try {
          // Queue the request
          result = await this.printMonitor.queueLLMRequest('status', {
            source: 'telegram',
            chatId
          });
          
          await this.bot.sendMessage(chatId, '✅ <b>Analysis Complete</b>\nProcessing results...', {
            parse_mode: 'HTML'
          });
          
        } catch (queueError) {
          logger.error(`Queue request failed: ${queueError.message}`);
          await this.bot.sendMessage(chatId, '⚠️ <b>Queue Error</b>\nFalling back to direct processing...', {
            parse_mode: 'HTML'
          });
          
          // Fall back to direct processing
          result = await this.processStatusDirectly();
        }
      } else {
        // Fall back to direct processing
        await this.bot.sendMessage(chatId, '⚠️ <b>Queue Not Available</b>\nProcessing directly...', {
          parse_mode: 'HTML'
        });
        result = await this.processStatusDirectly();
      }

      // Format AI analysis message
      const statusMessage = this.formatStatusMessage(result.analysis);
      
      // Send AI analysis message
      await this.bot.sendMessage(chatId, statusMessage, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });

      // Send annotated image if we have analysis data
      if (result.analysis && (result.analysis.objects?.length > 0 || result.analysis.problems?.length > 0)) {
        try {
          const annotatedImage = await this.imageAnnotator.annotateImage(
            result.frameBuffer,
            result.analysis,
            {
              showLabels: true,
              showConfidence: true,
              showStatus: true,
              borderWidth: 3,
              fontSize: 16
            }
          );
          
          // Resize for Telegram
          const resizedImage = await sharp(annotatedImage)
            .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
          
          await this.bot.sendPhoto(chatId, resizedImage, {
            caption: '📊 AI Analysis - Annotated Results'
          });
          
        } catch (annotationError) {
          logger.warn(`Failed to create annotated image for status: ${annotationError.message}`);
          // Send original image as fallback
          const resizedImage = await sharp(result.frameBuffer)
            .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
          
          await this.bot.sendPhoto(chatId, resizedImage, {
            caption: '📊 AI Analysis - Original Frame'
          });
        }
      } else {
        // Send original image if no analysis data
        const resizedImage = await sharp(result.frameBuffer)
          .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();
        
        await this.bot.sendPhoto(chatId, resizedImage, {
          caption: '📊 AI Analysis'
        });
      }

    } catch (error) {
      logger.error(`Failed to handle status command: ${error.message}`);
      await this.bot.sendMessage(chatId, '❌ Failed to process status command. Please try again later.', {
        parse_mode: 'HTML'
      });
    }
  }

  // Fallback method for direct processing (without queue)
  async processStatusDirectly() {
    // Capture current frame
    const frameBuffer = await this.capture.captureFrame();
    if (!frameBuffer) {
      throw new Error('Failed to capture frame');
    }

    // Analyze with LLM
    const analysis = await this.llmClient.analyzeImage(
      frameBuffer,
      this.prompts.systemPrompt,
      this.prompts.getUserPrompt(),
      false // debug mode
    );

    return {
      frameBuffer,
      analysis,
      timestamp: Date.now()
    };
  }

  // Handle capture command - uses queue system for frame capture
  async handleCaptureCommand(msg) {
    const chatId = msg.chat.id;
    
    try {
      await this.bot.sendMessage(chatId, '📸 <b>Capture Command Received</b>\nQueuing frame capture request...', {
        parse_mode: 'HTML'
      });

      // Check if we have the required dependencies
      if (!this.capture) {
        await this.bot.sendMessage(chatId, '⚠️ <b>System Not Ready</b>\nCapture module not available. Please ensure the main application is running.', {
          parse_mode: 'HTML'
        });
        return;
      }

      // Use queue system if available, otherwise fall back to direct processing
      let frameBuffer;
      if (this.printMonitor && this.printMonitor.queueLLMRequest) {
        try {
          // Queue the frame capture request
          const result = await this.printMonitor.queueLLMRequest('frame', {
            source: 'telegram',
            chatId
          });
          
          frameBuffer = result.frameBuffer;
          await this.bot.sendMessage(chatId, '✅ <b>Frame Captured</b>\nProcessing image...', {
            parse_mode: 'HTML'
          });
          
        } catch (queueError) {
          logger.error(`Queue request failed: ${queueError.message}`);
          await this.bot.sendMessage(chatId, '⚠️ <b>Queue Error</b>\nFalling back to direct capture...', {
            parse_mode: 'HTML'
          });
          
          // Fall back to direct capture
          frameBuffer = await this.capture.captureFrame();
        }
      } else {
        // Fall back to direct capture
        await this.bot.sendMessage(chatId, '⚠️ <b>Queue Not Available</b>\nCapturing directly...', {
          parse_mode: 'HTML'
        });
        frameBuffer = await this.capture.captureFrame();
      }

      if (!frameBuffer) {
        await this.bot.sendMessage(chatId, '❌ <b>Capture Failed</b>\nCould not capture frame from printer. Check connection.', {
          parse_mode: 'HTML'
        });
        return;
      }

      // Send captured image
      const resizedImage = await sharp(frameBuffer)
        .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      
      await this.bot.sendPhoto(chatId, resizedImage, {
        caption: '📸 Captured Frame - Current Print View'
      });

      await this.bot.sendMessage(chatId, '✅ <b>Frame captured successfully!</b>\nImage sent above shows current print status.', {
        parse_mode: 'HTML'
      });

    } catch (error) {
      logger.error(`Failed to handle capture command: ${error.message}`);
      await this.bot.sendMessage(chatId, '❌ Failed to capture frame. Please try again later.', {
        parse_mode: 'HTML'
      });
    }
  }

  // Handle analyze command - uses queue system
  async handleAnalyzeCommand(msg) {
    const chatId = msg.chat.id;
    
    try {
      await this.bot.sendMessage(chatId, '🤖 <b>Analyze Command Received</b>\nQueuing request for detailed analysis...', {
        parse_mode: 'HTML'
      });

      // Check if we have the required dependencies
      if (!this.capture || !this.llmClient || !this.prompts) {
        await this.bot.sendMessage(chatId, '⚠️ <b>System Not Ready</b>\nAnalysis dependencies not available. Please ensure the main application is running.', {
          parse_mode: 'HTML'
        });
        return;
      }

      // Use queue system if available, otherwise fall back to direct processing
      let result;
      if (this.printMonitor && this.printMonitor.queueLLMRequest) {
        try {
          // Queue the request
          result = await this.printMonitor.queueLLMRequest('analyze', {
            source: 'telegram',
            chatId
          });
          
          await this.bot.sendMessage(chatId, '✅ <b>Analysis Complete</b>\nProcessing detailed results...', {
            parse_mode: 'HTML'
          });
          
        } catch (queueError) {
          logger.error(`Queue request failed: ${queueError.message}`);
          await this.bot.sendMessage(chatId, '⚠️ <b>Queue Error</b>\nFalling back to direct processing...', {
            parse_mode: 'HTML'
          });
          
          // Fall back to direct processing
          result = await this.processStatusDirectly();
        }
      } else {
        // Fall back to direct processing
        await this.bot.sendMessage(chatId, '⚠️ <b>Queue Not Available</b>\nProcessing directly...', {
          parse_mode: 'HTML'
        });
        result = await this.processStatusDirectly();
      }

      // Format detailed analysis message
      const analysisMessage = this.formatDetailedAnalysis(result.analysis);
      
      // Send analysis message
      await this.bot.sendMessage(chatId, analysisMessage, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });

      // Send annotated image
      if (result.analysis && (result.analysis.objects?.length > 0 || result.analysis.problems?.length > 0)) {
        try {
          const annotatedImage = await this.imageAnnotator.annotateImage(
            result.frameBuffer,
            result.analysis,
            {
              showLabels: true,
              showConfidence: true,
              showStatus: true,
              borderWidth: 3,
              fontSize: 16
            }
          );
          
          // Resize for Telegram
          const resizedImage = await sharp(annotatedImage)
            .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
          
          await this.bot.sendPhoto(chatId, resizedImage, {
            caption: '🤖 AI Analysis - Annotated Results'
          });
          
        } catch (annotationError) {
          logger.warn(`Failed to create annotated image for analysis: ${annotationError.message}`);
          // Send original image as fallback
          const resizedImage = await sharp(result.frameBuffer)
            .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
          
          await this.bot.sendPhoto(chatId, resizedImage, {
            caption: '🤖 AI Analysis - Original Frame'
          });
        }
      }

      await this.bot.sendMessage(chatId, '✅ <b>Analysis completed successfully!</b>', {
        parse_mode: 'HTML'
      });

    } catch (error) {
      logger.error(`Failed to handle analyze command: ${error.message}`);
      await this.bot.sendMessage(chatId, '❌ Failed to analyze frame. Please try again later.', {
        parse_mode: 'HTML'
      });
    }
  }

  // Format status message from analysis
  formatStatusMessage(analysis) {
    if (!analysis) {
      return '❌ <b>Analysis Failed</b>\nCould not analyze the current frame.';
    }

    const statusEmoji = {
      'good': '✅',
      'warning': '⚠️',
      'critical': '🚨',
      'error': '❌'
    }[analysis.overall_status] || '❓';

    let message = `<b>${statusEmoji} Current Print Status</b>\n\n`;
    message += `<b>Overall Status:</b> ${analysis.overall_status.toUpperCase()}\n`;
    message += `<b>Objects Detected:</b> ${analysis.objects?.length || 0}\n`;
    message += `<b>Problems Found:</b> ${analysis.problems?.length || 0}\n\n`;

    if (analysis.objects && analysis.objects.length > 0) {
      message += `<b>👀 Detected Objects:</b>\n`;
      analysis.objects.slice(0, 3).forEach((obj, index) => {
        const confidencePercent = Math.round(obj.confidence * 100);
        message += `${index + 1}. ${obj.description} (${confidencePercent}%)\n`;
      });
      if (analysis.objects.length > 3) {
        message += `... and ${analysis.objects.length - 3} more\n`;
      }
      message += '\n';
    }

    if (analysis.problems && analysis.problems.length > 0) {
      message += `<b>⚠️ Detected Problems:</b>\n`;
      analysis.problems.slice(0, 3).forEach((problem, index) => {
        const confidencePercent = Math.round(problem.confidence * 100);
        const confidenceColor = problem.confidence >= 0.8 ? '🟢' : 
                              problem.confidence >= 0.6 ? '🟡' : '🔴';
        message += `${index + 1}. ${problem.issue} ${confidenceColor} ${confidencePercent}%\n`;
      });
      if (analysis.problems.length > 3) {
        message += `... and ${analysis.problems.length - 3} more\n`;
      }
    } else {
      message += '✅ <b>No problems detected!</b>\n';
    }

    message += `\n<i>Analysis completed at ${new Date().toLocaleTimeString()}</i>`;
    return message;
  }

  // Format detailed analysis message
  formatDetailedAnalysis(analysis) {
    if (!analysis) {
      return '❌ <b>Analysis Failed</b>\nCould not analyze the current frame.';
    }

    const statusEmoji = {
      'good': '✅',
      'warning': '⚠️',
      'critical': '🚨',
      'error': '❌'
    }[analysis.overall_status] || '❓';

    let message = `<b>${statusEmoji} Detailed AI Analysis</b>\n\n`;
    message += `<b>Overall Status:</b> ${analysis.overall_status.toUpperCase()}\n\n`;

    if (analysis.objects && analysis.objects.length > 0) {
      message += `<b>📋 Objects Detected (${analysis.objects.length}):</b>\n`;
      analysis.objects.forEach((obj, index) => {
        const confidencePercent = Math.round(obj.confidence * 100);
        message += `<b>${index + 1}. ${obj.description}</b>\n`;
        message += `   Confidence: ${confidencePercent}%\n`;
        if (obj.bounding_box && Array.isArray(obj.bounding_box)) {
          const [x1, y1, x2, y2] = obj.bounding_box;
          message += `   Location: [${x1.toFixed(2)}, ${y1.toFixed(2)}] to [${x2.toFixed(2)}, ${y2.toFixed(2)}]\n`;
        }
        message += '\n';
      });
    } else {
      message += '👀 <b>No objects detected in this frame.</b>\n\n';
    }

    if (analysis.problems && analysis.problems.length > 0) {
      message += `<b>🚨 Problems Detected (${analysis.problems.length}):</b>\n`;
      analysis.problems.forEach((problem, index) => {
        const confidencePercent = Math.round(problem.confidence * 100);
        const confidenceColor = problem.confidence >= 0.8 ? '🟢' : 
                              problem.confidence >= 0.6 ? '🟡' : '🔴';
        message += `<b>${index + 1}. ${problem.issue}</b> ${confidenceColor} ${confidencePercent}%\n`;
        message += `   Reason: ${problem.reason}\n`;
        if (problem.bounding_box && Array.isArray(problem.bounding_box)) {
          const [x1, y1, x2, y2] = problem.bounding_box;
          message += `   Location: [${x1.toFixed(2)}, ${y1.toFixed(2)}] to [${x2.toFixed(2)}, ${y2.toFixed(2)}]\n`;
        }
        message += '\n';
      });
    } else {
      message += '✅ <b>No problems detected in this frame!</b>\n\n';
    }

    message += `<i>Detailed analysis completed at ${new Date().toLocaleTimeString()}</i>`;
    return message;
  }

  // Check if we should send alert based on alert level and overall status
  shouldSendAlert(overallStatus) {
    const statusPriority = {
      'good': 0,
      'warning': 1,
      'critical': 2,
      'error': 3
    };
    
    const alertLevelPriority = {
      'none': -1,
      'critical': 2,
      'warning': 1,
      'all': 0
    };
    
    const currentStatusPriority = statusPriority[overallStatus] || 0;
    const requiredPriority = alertLevelPriority[this.alertLevel] || 2; // Default to 'critical'
    
    return currentStatusPriority >= requiredPriority;
  }

  // Handle alert level command
  async handleAlertLevelCommand(msg) {
    const chatId = msg.chat.id;
    const text = msg.text || '';
    
    // Extract the alert level from the command
    const match = text.match(/\/alertlevel\s+(\w+)/i);
    if (!match) {
      // Show current alert level and options
      const message = `
<b>🔔 Current Alert Level: ${this.alertLevel.toUpperCase()}</b>

Available alert levels:
• <code>/alertlevel all</code> - Send alerts for all statuses (good, warning, critical, error)
• <code>/alertlevel warning</code> - Send alerts for warning, critical, and error
• <code>/alertlevel critical</code> - Send alerts only for critical and error (default)
• <code>/alertlevel none</code> - Disable all automatic alerts (use commands only)

Current setting means:
• Automatic alerts: ${this.shouldSendAlert('good') ? '✅ GOOD' : '❌ GOOD'}
• Automatic alerts: ${this.shouldSendAlert('warning') ? '✅ WARNING' : '❌ WARNING'}
• Automatic alerts: ${this.shouldSendAlert('critical') ? '✅ CRITICAL' : '❌ CRITICAL'}
• Automatic alerts: ${this.shouldSendAlert('error') ? '✅ ERROR' : '❌ ERROR'}

Note: Commands like <code>/status</code>, <code>/capture</code>, <code>/analyze</code> always work regardless of alert level.
      `;
      
      try {
        await this.bot.sendMessage(chatId, message, {
          parse_mode: 'HTML',
          disable_web_page_preview: true
        });
      } catch (error) {
        logger.error(`Failed to send alert level info: ${error.message}`);
      }
      return;
    }
    
    const newLevel = match[1].toLowerCase();
    const validLevels = ['all', 'warning', 'critical', 'none'];
    
    if (!validLevels.includes(newLevel)) {
      await this.bot.sendMessage(chatId, `❌ Invalid alert level: ${newLevel}\nValid levels: all, warning, critical, none`, {
        parse_mode: 'HTML'
      });
      return;
    }
    
    // Update alert level
    this.alertLevel = newLevel;
    logger.info(`Telegram alert level changed to: ${newLevel}`);
    
    const message = `
✅ <b>Alert Level Updated</b>

New alert level: <code>${newLevel.toUpperCase()}</code>

Automatic alerts will now be sent for:
${this.shouldSendAlert('good') ? '• ✅ GOOD status' : '• ❌ GOOD status'}
${this.shouldSendAlert('warning') ? '• ✅ WARNING status' : '• ❌ WARNING status'}
${this.shouldSendAlert('critical') ? '• ✅ CRITICAL status' : '• ❌ CRITICAL status'}
${this.shouldSendAlert('error') ? '• ✅ ERROR status' : '• ❌ ERROR status'}

Commands like <code>/status</code>, <code>/capture</code>, <code>/analyze</code> always work regardless of alert level.
    `;
    
    try {
      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
    } catch (error) {
      logger.error(`Failed to send alert level update: ${error.message}`);
    }
  }

  // Method to set dependencies for command handling
  setDependencies(capture, llmClient, prompts, printMonitor = null, printerModule = null) {
    this.capture = capture;
    this.llmClient = llmClient;
    this.prompts = prompts;
    this.printMonitor = printMonitor;
    this.printerModule = printerModule;
    logger.info('Telegram notifier dependencies set for command handling');
    if (printerModule) {
      logger.info('Printer module configured for status commands');
    }
  }
}

module.exports = TelegramNotifier;