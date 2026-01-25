const fs = require('fs').promises;
const path = require('path');
const config = require('../config/config');
const logger = require('../utils/logger');
const sharp = require('sharp');
const ImageAnnotator = require('../utils/image-annotator');

class ConsoleNotifier {
  constructor() {
    this.imagesDir = path.join(__dirname, '../../images');
    this.annotatedImagesDir = path.join(__dirname, '../../images/annotated');
    this.ensureImagesDirectory();
    this.commandHandlers = new Map();
    this.setupCommandHandlers();
    this.imageAnnotator = new ImageAnnotator();
  }

  async ensureImagesDirectory() {
    try {
      await fs.mkdir(this.imagesDir, { recursive: true });
      await fs.mkdir(this.annotatedImagesDir, { recursive: true });
      logger.info(`Console images directory: ${this.imagesDir}`);
      logger.info(`Annotated images directory: ${this.annotatedImagesDir}`);
    } catch (error) {
      logger.error(`Failed to create images directory: ${error.message}`);
    }
  }

  setupCommandHandlers() {
    this.commandHandlers.set('status', this.handleStatusCommand.bind(this));
    this.commandHandlers.set('/status', this.handleStatusCommand.bind(this));
    this.commandHandlers.set('help', this.handleHelpCommand.bind(this));
    this.commandHandlers.set('/help', this.handleHelpCommand.bind(this));
    this.commandHandlers.set('capture', this.handleCaptureCommand.bind(this));
    this.commandHandlers.set('/capture', this.handleCaptureCommand.bind(this));
    this.commandHandlers.set('analyze', this.handleAnalyzeCommand.bind(this));
    this.commandHandlers.set('/analyze', this.handleAnalyzeCommand.bind(this));
  }

  async sendAlert(alertData) {
    const {
      frameNumber,
      problems,
      overallStatus,
      imageBuffer,
      analysisSummary = null
    } = alertData;

    logger.info(`=== Console Alert - Frame ${frameNumber} ===`);

    // Display alert message
    this.displayAlertMessage(frameNumber, problems, overallStatus, analysisSummary);

    // Save image if provided
    if (imageBuffer && imageBuffer.length > 0) {
      const imagePath = await this.saveImage(imageBuffer, frameNumber, 'alert');
      console.log(`📸 Image saved: ${imagePath}`);
      
      // Also save annotated version if we have analysis data
      if (analysisSummary && (analysisSummary.objectsCount > 0 || analysisSummary.problemsCount > 0)) {
        // Use the full analysis object if available, otherwise create a simple one
        const annotationAnalysis = analysisSummary.analysis || {
          objects: analysisSummary.objects || [],
          problems: problems,
          overall_status: overallStatus
        };
        
        try {
          const annotatedPath = await this.saveAnnotatedImage(
            imageBuffer,
            annotationAnalysis,
            frameNumber,
            'alert_annotated'
          );
          console.log(`🎨 Annotated image saved: ${annotatedPath}`);
        } catch (error) {
          console.log(`⚠️  Failed to save annotated image: ${error.message}`);
        }
      }
    }

    // Display problem details
    if (problems.length > 0) {
      this.displayProblemsDetails(problems);
    }

    console.log('\n');
    return true;
  }

  displayAlertMessage(frameNumber, problems, overallStatus, analysisSummary = null) {
    const statusEmoji = {
      'good': '✅',
      'warning': '⚠️',
      'critical': '🚨',
      'error': '❌'
    }[overallStatus] || '❓';

    console.log(`${statusEmoji} 3D Print Alert`);
    console.log(`Frame: ${frameNumber}`);
    console.log(`Status: ${overallStatus.toUpperCase()}`);
    console.log(`Problems detected: ${problems.length}`);

    if (analysisSummary) {
      console.log(`Objects detected: ${analysisSummary.objectsCount || 0}`);
    }

    console.log(`Time: ${new Date().toLocaleString()}`);
    console.log('');
  }

  displayProblemsDetails(problems) {
    if (problems.length === 0) {
      console.log('No specific problems identified');
      return;
    }

    console.log('📋 Detected Problems:');
    console.log('');

    problems.forEach((problem, index) => {
      const confidencePercent = Math.round(problem.confidence * 100);
      const confidenceBar = '█'.repeat(Math.floor(confidencePercent / 10)) + 
                          '░'.repeat(10 - Math.floor(confidencePercent / 10));
      
      console.log(`${index + 1}. ${problem.issue}`);
      console.log(`   Reason: ${problem.reason}`);
      console.log(`   Confidence: ${confidenceBar} ${confidencePercent}%`);
      
      if (problem.bounding_box && Array.isArray(problem.bounding_box)) {
        const [x1, y1, x2, y2] = problem.bounding_box;
        console.log(`   Location: [${x1.toFixed(2)}, ${y1.toFixed(2)}] to [${x2.toFixed(2)}, ${y2.toFixed(2)}]`);
      }
      
      console.log('');
    });
  }

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

  async handleStatusCommand(captureInstance, llmClient, prompts, debugMode = false) {
    console.log('📊 Status Command Received');
    console.log('Capturing current frame...');

    try {
      // Capture current frame
      const frameBuffer = await captureInstance.captureFrame();
      if (!frameBuffer) {
        console.log('❌ Failed to capture frame');
        return;
      }

      // Save the image
      const imagePath = await this.saveImage(frameBuffer, 'status', 'status');
      console.log(`📸 Status image saved: ${imagePath}`);

      // Analyze with LLM
      console.log('🤖 Analyzing with AI...');
      const analysis = await llmClient.analyzeImage(
        frameBuffer,
        prompts.systemPrompt,
        prompts.getUserPrompt(),
        debugMode
      );

      // Display analysis results
      this.displayStatusAnalysis(analysis, imagePath);
      
      // Save annotated version if we have bounding boxes
      if ((analysis.objects && analysis.objects.length > 0) || 
          (analysis.problems && analysis.problems.length > 0)) {
        try {
          const annotatedPath = await this.saveAnnotatedImage(
            frameBuffer,
            analysis,
            'status',
            'status_annotated'
          );
          console.log(`🎨 Annotated status image saved: ${annotatedPath}`);
        } catch (error) {
          console.log(`⚠️  Failed to save annotated image: ${error.message}`);
        }
      }

    } catch (error) {
      console.log(`❌ Status command failed: ${error.message}`);
    }
  }

  displayStatusAnalysis(analysis, imagePath) {
    console.log('\n=== AI Analysis Results ===');
    console.log(`Image: ${imagePath}`);
    console.log(`Overall Status: ${analysis.overall_status.toUpperCase()}`);
    console.log('');

    if (analysis.objects && analysis.objects.length > 0) {
      console.log('👀 Objects Detected:');
      analysis.objects.forEach((obj, index) => {
        console.log(`${index + 1}. ${obj.description} (${Math.round(obj.confidence * 100)}%)`);
      });
      console.log('');
    }

    if (analysis.problems && analysis.problems.length > 0) {
      console.log('⚠️ Problems Detected:');
      analysis.problems.forEach((problem, index) => {
        console.log(`${index + 1}. ${problem.issue} - ${problem.reason} (${Math.round(problem.confidence * 100)}%)`);
      });
      console.log('');
    } else {
      console.log('✅ No problems detected');
      console.log('');
    }
  }

  async handleCaptureCommand(captureInstance) {
    console.log('📸 Capture Command Received');
    
    try {
      const frameBuffer = await captureInstance.captureFrame();
      if (!frameBuffer) {
        console.log('❌ Failed to capture frame');
        return;
      }

      const imagePath = await this.saveImage(frameBuffer, 'manual', 'capture');
      console.log(`✅ Image captured and saved: ${imagePath}`);
      console.log(`📁 Location: ${imagePath}`);

    } catch (error) {
      console.log(`❌ Capture command failed: ${error.message}`);
    }
  }

  async handleAnalyzeCommand(captureInstance, llmClient, prompts, debugMode = false) {
    console.log('🤖 Analyze Command Received');
    console.log('Capturing and analyzing frame...');

    try {
      const frameBuffer = await captureInstance.captureFrame();
      if (!frameBuffer) {
        console.log('❌ Failed to capture frame');
        return;
      }

      const imagePath = await this.saveImage(frameBuffer, 'analysis', 'analysis');
      console.log(`📸 Image saved: ${imagePath}`);

      const analysis = await llmClient.analyzeImage(
        frameBuffer,
        prompts.systemPrompt,
        prompts.getUserPrompt(),
        debugMode
      );

      this.displayAnalysisResults(analysis, imagePath);
      
      // Save annotated version if we have bounding boxes
      if ((analysis.objects && analysis.objects.length > 0) || 
          (analysis.problems && analysis.problems.length > 0)) {
        try {
          const annotatedPath = await this.saveAnnotatedImage(
            frameBuffer,
            analysis,
            'analysis',
            'analysis_annotated'
          );
          console.log(`🎨 Annotated analysis image saved: ${annotatedPath}`);
        } catch (error) {
          console.log(`⚠️  Failed to save annotated image: ${error.message}`);
        }
      }

    } catch (error) {
      console.log(`❌ Analyze command failed: ${error.message}`);
    }
  }

  displayAnalysisResults(analysis, imagePath) {
    console.log('\n=== Detailed Analysis ===');
    console.log(`Image: ${imagePath}`);
    console.log('');

    // Display raw JSON for detailed inspection
    console.log('📋 Full Analysis JSON:');
    console.log(JSON.stringify(analysis, null, 2));
    console.log('');
  }

  handleHelpCommand() {
    console.log('\n=== Console Mode Help ===');
    console.log('Available commands:');
    console.log('');
    console.log('  status or /status    - Capture current frame and show AI analysis');
    console.log('  capture or /capture  - Capture and save current frame');
    console.log('  analyze or /analyze  - Capture, save, and show detailed analysis');
    console.log('  help or /help        - Show this help message');
    console.log('');
    console.log('Images are saved to: images/ directory');
    console.log('Automatic alerts will also save images when problems are detected');
    console.log('');
  }

  async processCommand(command, captureInstance, llmClient, prompts, debugMode = false) {
    const handler = this.commandHandlers.get(command.toLowerCase());
    if (handler) {
      await handler(captureInstance, llmClient, prompts, debugMode);
      return true;
    } else {
      console.log(`❌ Unknown command: ${command}`);
      console.log('Type "help" for available commands');
      return false;
    }
  }

  // Start interactive console mode
  startInteractiveMode(captureInstance, llmClient, prompts, debugMode = false) {
    console.log('\n=== Console Mode Activated ===');
    console.log('Type commands to interact with the print monitor');
    console.log('Type "help" for available commands');
    if (debugMode) {
      console.log('⚠️  Debug mode: ENABLED (LLM responses will be shown)');
    }
    console.log('');

    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'print-monitor> '
    });

    rl.prompt();

    rl.on('line', async (line) => {
      const command = line.trim();
      if (command === 'exit' || command === 'quit') {
        console.log('Exiting console mode...');
        rl.close();
        return;
      }

      await this.processCommand(command, captureInstance, llmClient, prompts, debugMode);
      rl.prompt();
    }).on('close', () => {
      console.log('Console mode ended');
      process.exit(0);
    });
  }

  // Send status update to console
  async sendStatusUpdate(statusData) {
    const {
      frameCount,
      uptime,
      lastAnalysis,
      systemStatus = 'operational'
    } = statusData;

    const uptimeFormatted = this.formatUptime(uptime);

    console.log('\n=== System Status Update ===');
    console.log(`Frames processed: ${frameCount}`);
    console.log(`Uptime: ${uptimeFormatted}`);
    console.log(`Last analysis: ${lastAnalysis ? new Date(lastAnalysis).toLocaleTimeString() : 'N/A'}`);
    console.log(`Status: ${systemStatus.toUpperCase()}`);
    console.log(`Time: ${new Date().toLocaleString()}`);
    console.log('');
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
}

module.exports = ConsoleNotifier;