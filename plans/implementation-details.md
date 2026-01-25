# Implementation Details - Elegoo Print Monitor

## Updated Dependencies (Using Native Fetch)
```json
{
  "name": "elegoo-print-monitor",
  "version": "1.0.0",
  "description": "LLM-based print monitor for Elegoo Centauri Carbon printer",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "dev": "nodemon src/index.js",
    "test": "jest"
  },
  "dependencies": {
    "dotenv": "^16.3.0",
    "node-telegram-bot-api": "^0.64.0",
    "winston": "^3.11.0",
    "sharp": "^0.33.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.0",
    "jest": "^29.7.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

## File Structure with Implementation Details

### 1. Configuration System (`src/config/config.js`)
```javascript
// Load environment variables
require('dotenv').config();

const config = {
  // Printer stream
  mjpegStreamUrl: process.env.MJPEG_STREAM_URL || 'http://192.168.10.179:3031/video',
  frameCaptureInterval: parseInt(process.env.FRAME_CAPTURE_INTERVAL || '10000'),
  
  // LLM Configuration
  openaiUrl: process.env.OPENAI_URL || 'http://localhost:1234/v1',
  openaiToken: process.env.OPENAI_TOKEN || '',
  llmModel: process.env.LLM_MODEL || 'smolvlm2-2.2b-instruct',
  
  // Telegram Configuration
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  notificationThreshold: parseFloat(process.env.NOTIFICATION_THRESHOLD || '0.8'),
  
  // Application Settings
  logLevel: process.env.LOG_LEVEL || 'info',
  maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
  retryDelay: parseInt(process.env.RETRY_DELAY || '5000'),
  
  // Validation
  validate: function() {
    const errors = [];
    
    if (!this.mjpegStreamUrl) errors.push('MJPEG_STREAM_URL is required');
    
    // Telegram is optional - warn if not configured but don't fail
    if (!this.telegramBotToken || !this.telegramChatId) {
      console.warn('Telegram credentials not configured - notifications will be logged only');
    }
    
    if (errors.length > 0) {
      throw new Error(`Configuration errors:\n${errors.join('\n')}`);
    }
    
    return true;
  }
};

module.exports = config;
```

### 2. MJPEG Frame Capture (`src/capture/mjpeg-capture.js`)
```javascript
const config = require('../config/config');
const logger = require('../utils/logger');

class MjpegCapture {
  constructor() {
    this.streamUrl = config.mjpegStreamUrl;
    this.interval = config.frameCaptureInterval;
    this.isCapturing = false;
    this.captureInterval = null;
  }

  async captureFrame() {
    try {
      const response = await fetch(this.streamUrl, {
        headers: {
          'Accept': 'multipart/x-mixed-replace; boundary=--myboundary'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Parse MJPEG stream and extract a single frame
      const buffer = await response.arrayBuffer();
      return Buffer.from(buffer);
      
    } catch (error) {
      logger.error(`Failed to capture frame: ${error.message}`);
      throw error;
    }
  }

  startCapture(callback) {
    if (this.isCapturing) {
      logger.warn('Capture already running');
      return;
    }

    this.isCapturing = true;
    logger.info(`Starting frame capture every ${this.interval}ms`);

    this.captureInterval = setInterval(async () => {
      try {
        const frame = await this.captureFrame();
        callback(frame);
      } catch (error) {
        logger.error(`Frame capture failed: ${error.message}`);
      }
    }, this.interval);
  }

  stopCapture() {
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }
    this.isCapturing = false;
    logger.info('Frame capture stopped');
  }
}

module.exports = MjpegCapture;
```

### 3. LLM Client with Native Fetch (`src/llm/llm-client.js`)
```javascript
const config = require('../config/config');
const logger = require('../utils/logger');

class LLMClient {
  constructor() {
    this.baseUrl = config.openaiUrl;
    this.apiKey = config.openaiToken;
    this.model = config.llmModel;
  }

  async analyzeImage(imageBuffer, prompt) {
    try {
      // Convert image buffer to base64
      const base64Image = imageBuffer.toString('base64');
      
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
              ]
            }
          ],
          max_tokens: 1000,
          temperature: 0.1
        })
      });

      if (!response.ok) {
        throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return this.parseLLMResponse(data.choices[0].message.content);
      
    } catch (error) {
      logger.error(`LLM analysis failed: ${error.message}`);
      throw error;
    }
  }

  parseLLMResponse(responseText) {
    try {
      // Extract JSON from response (LLM might wrap it in markdown or add text)
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                       responseText.match(/{[\s\S]*}/);
      
      if (jsonMatch) {
        const jsonStr = jsonMatch[0].replace(/```json\n|\n```/g, '');
        return JSON.parse(jsonStr);
      }
      
      // Try parsing the whole response as JSON
      return JSON.parse(responseText);
    } catch (error) {
      logger.error(`Failed to parse LLM response: ${error.message}`);
      return {
        objects: [],
        problems: [],
        overall_status: "error",
        raw_response: responseText
      };
    }
  }
}

module.exports = LLMClient;
```

### 4. Prompt Engineering (`src/llm/prompts.js`)
```javascript
const prompts = {
  systemPrompt: `You are a 3D printing expert analyzing print quality from camera images.
Analyze the provided image and identify:

1. Visible objects/components in the print bed
2. Any potential printing issues or anomalies
3. Provide bounding boxes for each identified item (format: [x1, y1, x2, y2] where coordinates are 0-1 normalized)
4. Rate confidence for each detection (0-1)

Return JSON format with this structure:
{
  "objects": [
    {
      "bounding_box": [0.1, 0.2, 0.3, 0.4],
      "description": "Print head moving across bed",
      "confidence": 0.95
    }
  ],
  "problems": [
    {
      "bounding_box": [0.5, 0.6, 0.7, 0.8],
      "issue": "Layer shifting",
      "reason": "Visible misalignment in print layers",
      "confidence": 0.85
    }
  ],
  "overall_status": "good|warning|critical"
}

Consider these common 3D printing issues:
- Warping/lifting from bed
- Stringing/oozing
- Layer shifting/misalignment
- Under-extrusion
- Over-extrusion
- Poor bed adhesion
- Clogged nozzle symptoms
- Support structure failures`,

  getUserPrompt: function() {
    return `Analyze this 3D print image. Identify all visible objects and any printing issues.
Return only the JSON response, no additional text.`;
  }
};

module.exports = prompts;
```

### 5. Main Application Loop (`src/index.js`)
```javascript
const config = require('./config/config');
const logger = require('./utils/logger');
const MjpegCapture = require('./capture/mjpeg-capture');
const LLMClient = require('./llm/llm-client');
const PrintAnalyzer = require('./analysis/print-analyzer');
const TelegramNotifier = require('./notifications/telegram-notifier');
const prompts = require('./llm/prompts');

class PrintMonitor {
  constructor() {
    this.config = config;
    this.capture = new MjpegCapture();
    this.llmClient = new LLMClient();
    this.analyzer = new PrintAnalyzer();
    this.notifier = new TelegramNotifier();
    
    this.isRunning = false;
    this.frameCount = 0;
  }

  async initialize() {
    try {
      // Validate configuration
      this.config.validate();
      
      logger.info('Print Monitor initialized');
      logger.info(`Stream URL: ${this.config.mjpegStreamUrl}`);
      logger.info(`Capture interval: ${this.config.frameCaptureInterval}ms`);
      logger.info(`LLM Model: ${this.config.llmModel}`);
      
      return true;
    } catch (error) {
      logger.error(`Initialization failed: ${error.message}`);
      throw error;
    }
  }

  async processFrame(frameBuffer) {
    this.frameCount++;
    logger.info(`Processing frame #${this.frameCount}`);
    
    try {
      // Analyze frame with LLM
      const analysis = await this.llmClient.analyzeImage(
        frameBuffer,
        prompts.getUserPrompt()
      );
      
      logger.debug(`Analysis result: ${JSON.stringify(analysis, null, 2)}`);
      
      // Check for problems that need notification
      const criticalProblems = analysis.problems.filter(
        problem => problem.confidence >= this.config.notificationThreshold
      );
      
      if (criticalProblems.length > 0) {
        logger.warn(`Detected ${criticalProblems.length} critical problems`);
        
        // Send notification if Telegram is configured
        if (this.config.telegramBotToken && this.config.telegramChatId) {
          await this.notifier.sendAlert({
            frameNumber: this.frameCount,
            problems: criticalProblems,
            overallStatus: analysis.overall_status,
            imageBuffer: frameBuffer
          });
        } else {
          logger.warn('Telegram not configured - logging issues only');
          logger.info(`Critical problems: ${JSON.stringify(criticalProblems)}`);
        }
      }
      
      return analysis;
      
    } catch (error) {
      logger.error(`Frame processing failed: ${error.message}`);
      return null;
    }
  }

  start() {
    if (this.isRunning) {
      logger.warn('Monitor already running');
      return;
    }
    
    this.initialize().then(() => {
      this.isRunning = true;
      
      // Start frame capture
      this.capture.startCapture(async (frameBuffer) => {
        await this.processFrame(frameBuffer);
      });
      
      logger.info('Print Monitor started successfully');
      
      // Handle graceful shutdown
      process.on('SIGINT', () => this.stop());
      process.on('SIGTERM', () => this.stop());
      
    }).catch(error => {
      logger.error(`Failed to start monitor: ${error.message}`);
      process.exit(1);
    });
  }

  stop() {
    logger.info('Shutting down Print Monitor...');
    this.isRunning = false;
    this.capture.stopCapture();
    process.exit(0);
  }
}

// Start the application
if (require.main === module) {
  const monitor = new PrintMonitor();
  monitor.start();
}

module.exports = PrintMonitor;
```

## Testing Strategy
1. **Unit Tests**: Test individual modules in isolation
2. **Integration Tests**: Test frame capture → LLM → notification flow
3. **Mock Testing**: Use mock MJPEG streams and LLM responses
4. **Performance Testing**: Measure frame processing latency

## Deployment Considerations
1. **Process Management**: Use PM2 or systemd for production
2. **Resource Monitoring**: Monitor memory usage and CPU
3. **Log Rotation**: Implement log rotation for long-term operation
4. **Health Checks**: Add HTTP health endpoint for monitoring

## Next Implementation Steps
1. Create the project structure with all directories
2. Implement each module according to the specifications
3. Create test files for each component
4. Set up development environment with nodemon
5. Test with sample images before connecting to live stream