const BaseCommunication = require('./communication');

class ConsoleNotifier extends BaseCommunication {
  constructor() {
    super();
    this.ensureImagesDirectory();
    this.setupCommandHandlers();
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
    const statusEmoji = this.getStatusEmoji(overallStatus);

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



  async handleStatusCommand(captureInstance, llmClient, prompts, debugMode = false, printMonitor = null, printerModule = null) {
    console.log('📊 Status Command Received');

    // First, get printer status immediately if printer module is available
    if (printerModule) {
      try {
        const printerStatus = await printerModule.getStatusText();
        console.log('\n=== Printer Status ===');
        console.log(printerStatus);
      } catch (printerError) {
        console.log(`⚠️  Printer status unavailable: ${printerError.message}`);
      }
    } else {
      console.log('\nℹ️  Printer status module not configured');
    }

    // Check if LLM is enabled
    const config = require('../config/config');
    const llmEnabled = config.llmMode === 'enabled';

    if (!llmEnabled) {
      console.log('\n🤖 LLM analysis: DISABLED');
      console.log('📸 Capturing frame only...');
      
      try {
        // Just capture frame without LLM analysis
        const frameBuffer = await captureInstance.captureFrame();
        if (!frameBuffer) {
          console.log('❌ Failed to capture frame');
          return;
        }

        const imagePath = await this.saveImage(frameBuffer, 'status', 'status');
        console.log(`✅ Status image saved: ${imagePath}`);
        console.log(`📁 Location: ${imagePath}`);
        
        return;
      } catch (error) {
        console.log(`❌ Status command failed: ${error.message}`);
        return;
      }
    }

    // LLM is enabled, proceed with analysis
    console.log('\n🤖 Now analyzing with AI...');
    console.log('Queuing request for visual analysis...');

    try {
      let result;
      
      // Use queue system if available
      if (printMonitor && printMonitor.queueLLMRequest) {
        try {
          result = await printMonitor.queueLLMRequest('status', {
            source: 'console'
          });
          console.log('✅ Analysis complete, processing results...');
        } catch (queueError) {
          console.log(`⚠️ Queue error: ${queueError.message}, falling back to direct processing...`);
          result = await this.processStatusDirectlyWithParams(captureInstance, llmClient, prompts, debugMode);
        }
      } else {
        console.log('⚠️ Queue not available, processing directly...');
        result = await this.processStatusDirectlyWithParams(captureInstance, llmClient, prompts, debugMode);
      }

      // Save the image
      const imagePath = await this.saveImage(result.frameBuffer, 'status', 'status');
      console.log(`📸 Status image saved: ${imagePath}`);

      // Display analysis results
      this.displayStatusAnalysis(result.analysis, imagePath);
      
      // Save annotated version if we have bounding boxes
      if ((result.analysis.objects && result.analysis.objects.length > 0) || 
          (result.analysis.problems && result.analysis.problems.length > 0)) {
        try {
          const annotatedPath = await this.saveAnnotatedImage(
            result.frameBuffer,
            result.analysis,
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

  // Fallback method for direct processing (console-specific version with parameters)
  async processStatusDirectlyWithParams(captureInstance, llmClient, prompts, debugMode = false) {
    // Capture current frame
    const frameBuffer = await captureInstance.captureFrame();
    if (!frameBuffer) {
      throw new Error('Failed to capture frame');
    }

    // Analyze with LLM
    const analysis = await llmClient.analyzeImage(
      frameBuffer,
      prompts.systemPrompt,
      prompts.getUserPrompt(),
      debugMode
    );

    return {
      frameBuffer,
      analysis,
      timestamp: Date.now()
    };
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

  // Display analysis results for regular frames (not alerts)
  displayFrameAnalysis(frameNumber, analysis) {
    const statusEmoji = this.getStatusEmoji(analysis.overall_status);

    console.log(`\n=== Frame ${frameNumber} Analysis ===`);
    console.log(`${statusEmoji} Status: ${analysis.overall_status.toUpperCase()}`);

    if (analysis.objects && analysis.objects.length > 0) {
      console.log(`👀 Objects: ${analysis.objects.length}`);
      analysis.objects.forEach((obj, index) => {
        if (index < 3) { // Show first 3 objects only
          console.log(`   ${obj.description} (${Math.round(obj.confidence * 100)}%)`);
        }
      });
      if (analysis.objects.length > 3) {
        console.log(`   ... and ${analysis.objects.length - 3} more`);
      }
    } else {
      console.log('👀 Objects: None detected');
    }

    if (analysis.problems && analysis.problems.length > 0) {
      console.log(`⚠️ Problems: ${analysis.problems.length}`);
      analysis.problems.forEach((problem, index) => {
        if (index < 2) { // Show first 2 problems only
          const confidencePercent = Math.round(problem.confidence * 100);
          console.log(`   ${problem.issue} (${confidencePercent}%)`);
        }
      });
      if (analysis.problems.length > 2) {
        console.log(`   ... and ${analysis.problems.length - 2} more`);
      }
    } else {
      console.log('✅ Problems: None detected');
    }

    console.log(`⏱️  Time: ${new Date().toLocaleTimeString()}`);
    console.log('');
  }

  // Display simple frame capture message (for LLM disabled mode)
  displayFrameCapture(frameNumber) {
    console.log(`\n=== Frame ${frameNumber} Captured ===`);
    console.log('📸 Frame captured successfully');
    console.log('🤖 LLM analysis: DISABLED');
    console.log(`⏱️  Time: ${new Date().toLocaleTimeString()}`);
    console.log('');
  }

  // Send simple status update (for LLM disabled mode)
  async sendSimpleStatus(statusData) {
    const {
      frameNumber,
      imageBuffer,
      printerStatus = null,
      llmEnabled = false,
      isStatusChange = false
    } = statusData;

    if (isStatusChange) {
      console.log(`\n🔄 Frame ${frameNumber} - Status Change Detected`);
    } else {
      console.log(`\n=== Frame ${frameNumber} Status ===`);
    }
    
    console.log('📸 Frame captured successfully');
    console.log(`🤖 LLM analysis: ${llmEnabled ? 'ENABLED' : 'DISABLED'}`);

    // Save image
    if (imageBuffer && imageBuffer.length > 0) {
      const imagePath = await this.saveImage(imageBuffer, frameNumber, 'frame');
      console.log(`📁 Image saved: ${imagePath}`);
    }

    // Display printer status if available
    if (printerStatus) {
      console.log('\n=== Printer Status ===');
      console.log(printerStatus);
    }

    console.log(`⏱️  Time: ${new Date().toLocaleTimeString()}`);
    console.log('');
    return true;
  }

  // Send printer status change notification
  async sendStatusChangeNotification(notificationData) {
    const {
      frameNumber,
      message,
      status,
      previousStatus = null,
      imageBuffer
    } = notificationData;

    console.log(`\n🔄 ===== PRINTER STATUS CHANGE =====`);
    console.log(`Frame: #${frameNumber}`);
    console.log(`Time: ${new Date().toLocaleString()}`);
    console.log('');
    
    // Display the formatted message (which already includes the change info)
    console.log(message);
    
    // Also show raw change info for debugging
    if (previousStatus && status?.status?.machine) {
      const currentMachine = status.status.machine.text || 'Unknown';
      const previousMachine = previousStatus?.status?.machine?.text || 'Unknown';
      const currentCode = status.status.machine.code;
      const previousCode = previousStatus?.status?.machine?.code;
      
      console.log(`\n📊 Change Details:`);
      console.log(`   Machine: ${previousMachine} (${previousCode}) → ${currentMachine} (${currentCode})`);
      
      // Check if this is the first status after startup
      if (!previousStatus.success) {
        console.log(`   📍 First valid status after startup`);
      }
    }
    
    // Save image if provided
    if (imageBuffer && imageBuffer.length > 0) {
      const imagePath = await this.saveImage(imageBuffer, frameNumber, 'status_change');
      console.log(`\n📸 Status change image saved: ${imagePath}`);
    }
    
    console.log(`\n====================================`);
    console.log('');
    return true;
  }

  // Send PrintGuard failure notification
  async sendPrintGuardFailureNotification(notificationData) {
    const {
      frameNumber,
      message,
      printGuardResult,
      printerStatus = null,
      imageBuffer
    } = notificationData;

    console.log(`\n🚨 ===== PRINTGUARD FAILURE DETECTED =====`);
    console.log(`Frame: #${frameNumber}`);
    console.log(`Time: ${new Date().toLocaleString()}`);
    console.log('');
    
    // Display the formatted message
    console.log(message);
    
    // Display detailed PrintGuard results
    console.log(`\n📊 PrintGuard Analysis Details:`);
    console.log(`   Initial prediction: ${printGuardResult.initialPrediction.className}`);
    console.log(`   Final prediction: ${printGuardResult.finalPrediction.className}`);
    console.log(`   Sensitivity: ${printGuardResult.sensitivity}x`);
    console.log(`   Sensitivity adjusted: ${printGuardResult.sensitivityAdjusted ? 'Yes' : 'No'}`);
    console.log(`   Processing time: ${printGuardResult.processingTime}ms`);
    
    // Display distances
    console.log(`\n📏 Distances to prototypes:`);
    printGuardResult.distances.forEach((distance, i) => {
      const className = printGuardResult.classNames[i] || `Class ${i}`;
      const isPredicted = i === printGuardResult.finalPrediction.index;
      const marker = isPredicted ? ' ← PREDICTED' : '';
      console.log(`   ${className}: ${distance.toFixed(4)}${marker}`);
    });
    
    // Display printer status if available
    if (printerStatus && printerStatus.success) {
      console.log(`\n🖨️ Printer Status:`);
      console.log(`   Machine: ${printerStatus.status?.machine?.text || 'Unknown'}`);
      
      if (printerStatus.status?.print?.text) {
        console.log(`   Print: ${printerStatus.status.print.text}`);
      }
      
      if (printerStatus.progress?.percent) {
        console.log(`   Progress: ${printerStatus.progress.percent}%`);
      }
    }
    
    // Save image if provided
    if (imageBuffer && imageBuffer.length > 0) {
      const imagePath = await this.saveImage(imageBuffer, frameNumber, 'printguard_failure');
      console.log(`\n📸 PrintGuard failure image saved: ${imagePath}`);
    }
    
    console.log(`\n==========================================`);
    console.log('');
    return true;
  }

  async handleCaptureCommand(captureInstance, llmClient, prompts, debugMode = false, printMonitor = null) {
    console.log('📸 Capture Command Received');
    console.log('Queuing frame capture request...');
    
    try {
      let frameBuffer;
      
      // Use queue system if available
      if (printMonitor && printMonitor.queueLLMRequest) {
        try {
          const result = await printMonitor.queueLLMRequest('frame', {
            source: 'console'
          });
          frameBuffer = result.frameBuffer;
          console.log('✅ Frame captured via queue');
        } catch (queueError) {
          console.log(`⚠️ Queue error: ${queueError.message}, falling back to direct capture...`);
          frameBuffer = await captureInstance.captureFrame();
        }
      } else {
        console.log('⚠️ Queue not available, capturing directly...');
        frameBuffer = await captureInstance.captureFrame();
      }

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

  async handleAnalyzeCommand(captureInstance, llmClient, prompts, debugMode = false, printMonitor = null) {
    console.log('🤖 Analyze Command Received');
    console.log('Queuing request for detailed analysis...');

    try {
      let result;
      
      // Use queue system if available
      if (printMonitor && printMonitor.queueLLMRequest) {
        try {
          result = await printMonitor.queueLLMRequest('analyze', {
            source: 'console'
          });
          console.log('✅ Analysis complete, processing results...');
        } catch (queueError) {
          console.log(`⚠️ Queue error: ${queueError.message}, falling back to direct processing...`);
          result = await this.processStatusDirectlyWithParams(captureInstance, llmClient, prompts, debugMode);
        }
      } else {
        console.log('⚠️ Queue not available, processing directly...');
        result = await this.processStatusDirectlyWithParams(captureInstance, llmClient, prompts, debugMode);
      }

      const imagePath = await this.saveImage(result.frameBuffer, 'analysis', 'analysis');
      console.log(`📸 Image saved: ${imagePath}`);

      this.displayAnalysisResults(result.analysis, imagePath);
      
      // Save annotated version if we have bounding boxes
      if ((result.analysis.objects && result.analysis.objects.length > 0) || 
          (result.analysis.problems && result.analysis.problems.length > 0)) {
        try {
          const annotatedPath = await this.saveAnnotatedImage(
            result.frameBuffer,
            result.analysis,
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

  handleHelpCommand(captureInstance, llmClient, prompts, debugMode = false, printMonitor = null) {
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
    if (printMonitor && printMonitor.queueLLMRequest) {
      console.log('');
      console.log('✅ Queue system: ENABLED');
      console.log('   - Requests are queued when LLM is busy');
      console.log('   - Prevents multiple simultaneous LLM requests');
    }
    console.log('');
  }

  async processCommand(command, captureInstance, llmClient, prompts, debugMode = false, printMonitor = null, printerModule = null) {
    const handler = this.commandHandlers.get(command.toLowerCase());
    if (handler) {
      // Pass printerModule to status command handler
      if (command.toLowerCase() === 'status' || command.toLowerCase() === '/status') {
        await handler(captureInstance, llmClient, prompts, debugMode, printMonitor, printerModule);
      } else {
        await handler(captureInstance, llmClient, prompts, debugMode, printMonitor);
      }
      return true;
    } else {
      console.log(`❌ Unknown command: ${command}`);
      console.log('Type "help" for available commands');
      return false;
    }
  }

  // Start interactive console mode
  startInteractiveMode(captureInstance, llmClient, prompts, debugMode = false, printMonitor = null, printerModule = null) {
    console.log('\n=== Console Mode Activated ===');
    console.log('Type commands to interact with the print monitor');
    console.log('Type "help" for available commands');
    if (debugMode) {
      console.log('⚠️  Debug mode: ENABLED (LLM responses will be shown)');
    }
    if (printMonitor && printMonitor.queueLLMRequest) {
      console.log('✅ Queue system: ENABLED (requests will be queued when LLM is busy)');
    } else {
      console.log('⚠️  Queue system: DISABLED (requests will be processed directly)');
    }
    if (printerModule) {
      console.log('🖨️  Printer status: ENABLED (status command will show printer job status)');
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

      await this.processCommand(command, captureInstance, llmClient, prompts, debugMode, printMonitor, printerModule);
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

}

module.exports = ConsoleNotifier;