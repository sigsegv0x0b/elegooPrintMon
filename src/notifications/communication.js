const fs = require('fs').promises;
const path = require('path');
const config = require('../config/config');
const logger = require('../utils/logger');
const sharp = require('sharp');
const ImageAnnotator = require('../utils/image-annotator');

/**
 * Base communication class with common functionality for all notifiers
 * This class contains shared code that was duplicated between console and telegram handlers
 */
class BaseCommunication {
  constructor() {
    this.imagesDir = path.join(__dirname, '../../images');
    this.annotatedImagesDir = path.join(__dirname, '../../images/annotated');
    this.imageAnnotator = new ImageAnnotator();
    this.commandHandlers = new Map();
    
    // Common dependencies that will be set by subclasses
    this.capture = null;
    this.llmClient = null;
    this.prompts = null;
    this.printMonitor = null;
    this.printerModule = null;
  }

  /**
   * Common status emoji mapping used by both console and telegram
   */
  getStatusEmoji(status) {
    const statusEmoji = {
      'good': '✅',
      'warning': '⚠️',
      'critical': '🚨',
      'error': '❌'
    };
    return statusEmoji[status] || '❓';
  }

  /**
   * Common method to ensure images directory exists
   */
  async ensureImagesDirectory() {
    try {
      await fs.mkdir(this.imagesDir, { recursive: true });
      await fs.mkdir(this.annotatedImagesDir, { recursive: true });
      logger.info(`Images directory: ${this.imagesDir}`);
      logger.info(`Annotated images directory: ${this.annotatedImagesDir}`);
    } catch (error) {
      logger.error(`Failed to create images directory: ${error.message}`);
    }
  }

  /**
   * Common method to save image to disk
   */
  async saveImage(imageBuffer, frameNumber, type = 'frame') {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${type}_${frameNumber}_${timestamp}.jpg`;
      const filepath = path.join(this.imagesDir, filename);

      // Ensure image is in JPEG format
      const jpegBuffer = await sharp(imageBuffer)
        .jpeg({ quality: 90 })
        .toBuffer();

      await fs.writeFile(filepath, jpegBuffer);
      return filepath;
    } catch (error) {
      logger.error(`Failed to save image: ${error.message}`);
      return null;
    }
  }

  /**
   * Common method to save annotated image
   */
  async saveAnnotatedImage(imageBuffer, analysis, frameNumber, type = 'annotated') {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${type}_${frameNumber}_${timestamp}.jpg`;
      const filepath = path.join(this.annotatedImagesDir, filename);

      // Annotate the image with bounding boxes
      const annotatedBuffer = await this.imageAnnotator.annotateImage(
        imageBuffer,
        analysis,
        {
          showLabels: true,
          showConfidence: true,
          showStatus: true,
          borderWidth: 3,
          fontSize: 20
        }
      );

      await fs.writeFile(filepath, annotatedBuffer);
      return filepath;
    } catch (error) {
      logger.error(`Failed to save annotated image: ${error.message}`);
      return null;
    }
  }

  /**
   * Common method to format alert message (abstract - must be implemented by subclass)
   */
  formatAlertMessage(frameNumber, problems, overallStatus, analysisSummary = null) {
    throw new Error('formatAlertMessage must be implemented by subclass');
  }

  /**
   * Common method to format problems details (abstract - must be implemented by subclass)
   */
  formatProblemsDetails(problems) {
    throw new Error('formatProblemsDetails must be implemented by subclass');
  }

  /**
   * Common method to check if we should send alert based on alert level
   * Used by TelegramNotifier, ConsoleNotifier sends all alerts
   */
  shouldSendAlert(overallStatus, alertLevel = 'critical') {
    const statusPriority = {
      'good': 0,
      'warning': 1,
      'critical': 2,
      'error': 3
    };
    
    const alertLevelPriority = {
      'none': 999, // Very high number so nothing meets it
      'critical': 2,
      'warning': 1,
      'all': 0
    };
    
    const currentStatusPriority = statusPriority[overallStatus] || 0;
    const requiredPriority = alertLevelPriority.hasOwnProperty(alertLevel) ? alertLevelPriority[alertLevel] : 2;
    
    return currentStatusPriority >= requiredPriority;
  }

  /**
   * Common method to format uptime
   */
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

  /**
   * Common method to process status directly (without queue)
   */
  async processStatusDirectly() {
    if (!this.capture || !this.llmClient || !this.prompts) {
      throw new Error('Dependencies not set for processStatusDirectly');
    }

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

  /**
   * Common method to format status message from analysis
   */
  formatStatusMessage(analysis) {
    if (!analysis) {
      return '❌ Analysis Failed\nCould not analyze the current frame.';
    }

    const statusEmoji = this.getStatusEmoji(analysis.overall_status);

    let message = `${statusEmoji} Current Print Status\n\n`;
    message += `Overall Status: ${analysis.overall_status.toUpperCase()}\n`;
    message += `Objects Detected: ${analysis.objects?.length || 0}\n`;
    message += `Problems Found: ${analysis.problems?.length || 0}\n\n`;

    if (analysis.objects && analysis.objects.length > 0) {
      message += `👀 Detected Objects:\n`;
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
      message += `⚠️ Detected Problems:\n`;
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
      message += '✅ No problems detected!\n';
    }

    message += `\nAnalysis completed at ${new Date().toLocaleTimeString()}`;
    return message;
  }

  /**
   * Common method to format detailed analysis
   */
  formatDetailedAnalysis(analysis) {
    if (!analysis) {
      return '❌ Analysis Failed\nCould not analyze the current frame.';
    }

    const statusEmoji = this.getStatusEmoji(analysis.overall_status);

    let message = `${statusEmoji} Detailed AI Analysis\n\n`;
    message += `Overall Status: ${analysis.overall_status.toUpperCase()}\n\n`;

    if (analysis.objects && analysis.objects.length > 0) {
      message += `📋 Objects Detected (${analysis.objects.length}):\n`;
      analysis.objects.forEach((obj, index) => {
        const confidencePercent = Math.round(obj.confidence * 100);
        message += `${index + 1}. ${obj.description}\n`;
        message += `   Confidence: ${confidencePercent}%\n`;
        if (obj.bounding_box && Array.isArray(obj.bounding_box)) {
          const [x1, y1, x2, y2] = obj.bounding_box;
          message += `   Location: [${x1.toFixed(2)}, ${y1.toFixed(2)}] to [${x2.toFixed(2)}, ${y2.toFixed(2)}]\n`;
        }
        message += '\n';
      });
    } else {
      message += '👀 No objects detected in this frame.\n\n';
    }

    if (analysis.problems && analysis.problems.length > 0) {
      message += `🚨 Problems Detected (${analysis.problems.length}):\n`;
      analysis.problems.forEach((problem, index) => {
        const confidencePercent = Math.round(problem.confidence * 100);
        const confidenceColor = problem.confidence >= 0.8 ? '🟢' : 
                              problem.confidence >= 0.6 ? '🟡' : '🔴';
        message += `${index + 1}. ${problem.issue} ${confidenceColor} ${confidencePercent}%\n`;
        message += `   Reason: ${problem.reason}\n`;
        if (problem.bounding_box && Array.isArray(problem.bounding_box)) {
          const [x1, y1, x2, y2] = problem.bounding_box;
          message += `   Location: [${x1.toFixed(2)}, ${y1.toFixed(2)}] to [${x2.toFixed(2)}, ${y2.toFixed(2)}]\n`;
        }
        message += '\n';
      });
    } else {
      message += '✅ No problems detected in this frame!\n\n';
    }

    message += `Detailed analysis completed at ${new Date().toLocaleTimeString()}`;
    return message;
  }

  /**
   * Common method to set dependencies for command handling
   */
  setDependencies(capture, llmClient, prompts, printMonitor = null, printerModule = null) {
    this.capture = capture;
    this.llmClient = llmClient;
    this.prompts = prompts;
    this.printMonitor = printMonitor;
    this.printerModule = printerModule;
    logger.info(`${this.constructor.name} dependencies set for command handling`);
    if (printerModule) {
      logger.info('Printer module configured for status commands');
    }
  }

  /**
   * Common method to setup command handlers
   * Subclasses should override this to set up their specific handlers
   */
  setupCommandHandlers() {
    throw new Error('setupCommandHandlers must be implemented by subclass');
  }

  /**
   * Common method to process command
   * Subclasses should implement their own command processing logic
   */
  async processCommand(command, ...args) {
    throw new Error('processCommand must be implemented by subclass');
  }

  /**
   * Abstract method for sending alerts - must be implemented by subclass
   */
  async sendAlert(alertData) {
    throw new Error('sendAlert must be implemented by subclass');
  }

  /**
   * Abstract method for sending status updates - must be implemented by subclass
   */
  async sendStatusUpdate(statusData) {
    throw new Error('sendStatusUpdate must be implemented by subclass');
  }

  /**
   * Abstract method for sending simple status - must be implemented by subclass
   */
  async sendSimpleStatus(statusData) {
    throw new Error('sendSimpleStatus must be implemented by subclass');
  }

  /**
   * Abstract method for sending status change notifications - must be implemented by subclass
   */
  async sendStatusChangeNotification(notificationData) {
    throw new Error('sendStatusChangeNotification must be implemented by subclass');
  }
}

module.exports = BaseCommunication;