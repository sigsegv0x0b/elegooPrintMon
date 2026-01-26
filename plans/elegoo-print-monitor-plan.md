# Elegoo Centauri Carbon Print Monitor - LLM-Based System Design

## Project Overview
A Node.js application that monitors 3D prints in real-time using computer vision and LLM analysis, with automated anomaly detection and Telegram notifications.

## System Architecture

```mermaid
graph TB
    subgraph "Input Sources"
        MJPEG[MJPEG Stream<br/>192.168.10.179:3031/video]
        PrinterWS[Printer WebSocket<br/>SDCP Protocol]
    end
    
    subgraph "Core Monitoring System"
        FrameGrabber[Frame Grabber<br/>10-second intervals]
        ImageProcessor[Image Processor]
        LLMClient[LLM Client<br/>LM Studio Integration]
        Analyzer[Print Analyzer]
        Notifier[Telegram Notifier]
        PrinterStatus[Printer Status Module]
        Discovery[Printer Discovery]
    end
    
    subgraph "External Services"
        LMStudio[LM Studio Server<br/>smolvlm2-2.2b-instruct]
        Telegram[Telegram API]
    end
    
    subgraph "Configuration"
        Env[.env Configuration]
    end
    
    MJPEG --> FrameGrabber
    FrameGrabber --> ImageProcessor
    ImageProcessor --> LLMClient
    LLMClient --> LMStudio
    LMStudio --> Analyzer
    Analyzer --> Notifier
    Notifier --> Telegram
    PrinterWS --> PrinterStatus
    PrinterStatus --> Notifier
    PrinterStatus --> Analyzer
    Discovery --> PrinterStatus
    Env --> FrameGrabber
    Env --> LLMClient
    Env --> Notifier
    Env --> PrinterStatus
```

## Core Components

### 1. Frame Capture Module
- **Purpose**: Capture frames from MJPEG stream at configurable intervals
- **Technology**: Node.js with `node-fetch` or `axios` for HTTP streaming
- **Configuration**: Refresh time from `.env` (default: 10 seconds)
- **Output**: JPEG/PNG images for LLM analysis

### 2. LLM Integration Module
- **Purpose**: Communicate with LM Studio's OpenAI-compatible API
- **Model**: smolvlm2-2.2b-instruct (vision language model)
- **API**: OpenAI-compatible endpoints
- **Configuration**:
  - `OPENAI_URL`: LM Studio server URL
  - `OPENAI_TOKEN`: API token (if required)
  - `LLM_MODEL`: Model identifier

### 3. Print Analysis Engine
- **Purpose**: Analyze print images and detect issues
- **Output Structure**:
  ```json
  {
    "objects": [
      {
        "bounding_box": [x1, y1, x2, y2],
        "description": "string",
        "confidence": 0.95
      }
    ],
    "problems": [
      {
        "bounding_box": [x1, y1, x2, y2],
        "issue": "string",
        "reason": "string",
        "confidence": 0.85
      }
    ],
    "overall_status": "good|warning|critical"
  }
  ```

### 4. Notification System
- **Purpose**: Send alerts via Telegram when issues detected
- **Threshold**: Configurable confidence level for notifications
- **Content**: Include image, detected issues, and confidence scores

## Configuration (.env)
```
# Printer Configuration
MJPEG_STREAM_URL=http://192.168.10.179:3031/video
PRINTER_IP=192.168.10.179
FRAME_CAPTURE_INTERVAL=10

# LLM Configuration
OPENAI_URL=http://localhost:1234/v1
OPENAI_TOKEN=your-lm-studio-token
LLM_MODEL=smolvlm2-2.2b-instruct

# Telegram Configuration
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_CHAT_ID=your-chat-id
NOTIFICATION_THRESHOLD=0.8
ALERT_LEVEL=critical  # all, warning, critical, none

# Application Settings
LOG_LEVEL=info
MAX_RETRIES=3
RETRY_DELAY=5000
DEBUG_MODE=false
CONSOLE_MODE=false
```

## Project Structure
```
elegooPrintMon/
├── src/
│   ├── index.js              # Main application entry point
│   ├── config/               # Configuration management
│   │   └── config.js
│   ├── capture/              # Frame capture module
│   │   └── mjpeg-capture.js
│   ├── llm/                  # LLM integration
│   │   ├── llm-client.js
│   │   ├── llm-response-parser.js
│   │   └── prompts.js
│   ├── analysis/             # Print analysis logic
│   │   └── print-analyzer.js
│   ├── notifications/        # Notification system
│   │   ├── telegram-notifier.js
│   │   └── console-notifier.js
│   ├── printer/              # Printer integration
│   │   ├── index.js
│   │   ├── status.js
│   │   └── discovery.js
│   └── utils/                # Utilities
│       ├── logger.js
│       ├── image-annotator.js
│       └── queue-manager.js
├── tests/                    # Test files
├── logs/                     # Application logs
├── .env                      # Environment configuration
├── .env.example              # Example configuration
├── package.json
├── README.md
├── get-telegram-chatid.sh    # Telegram setup script
├── .gitignore                # Git ignore file
└── plans/                    # Planning documents
    ├── elegoo-print-monitor-plan.md
    ├── implementation-details.md
    └── project-summary-and-next-steps.md
```

## Dependencies
```json
{
  "name": "elegoo-print-monitor",
  "version": "1.0.0",
  "description": "LLM-based print monitor for Elegoo Centauri Carbon printer",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "dev": "nodemon src/index.js",
    "test": "node test-basic.js"
  },
  "dependencies": {
    "dotenv": "^16.3.0",
    "node-telegram-bot-api": "^0.64.0",
    "winston": "^3.11.0",
    "sharp": "^0.33.0",
    "ws": "^8.16.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

## Prompt Engineering Strategy

### System Prompt
```
You are a 3D printing expert analyzing print quality from camera images.
Analyze the provided image and identify:
1. Visible objects/components in the print
2. Any potential printing issues or anomalies
3. Provide bounding boxes for each identified item
4. Rate confidence for each detection

Return JSON format with objects and problems arrays.
```

### Response Format
The LLM will be instructed to return structured JSON with:
- Objects array (normal print elements)
- Problems array (issues detected)
- Overall status assessment

## Error Handling & Resilience
1. **Stream Connection Failures**: Exponential backoff retry logic
2. **LLM API Errors**: Fallback to simpler analysis or skip frame
3. **Telegram Failures**: Queue notifications for retry
4. **Image Processing Errors**: Log and continue to next frame

## Monitoring & Logging
- Structured logging with Winston
- Performance metrics (frame capture time, LLM response time)
- Error tracking and alerting
- Periodic health checks

## Next Steps
✅ **All planned features implemented and tested**
✅ **Additional features added:**
   - Console interactive mode with command-line interface
   - Image annotation with bounding boxes (red for problems, green for objects)
   - Telegram bot command handling (status, capture, analyze, help, alertlevel)
   - Configurable alert levels (all, warning, critical, none)
   - Queue system for LLM requests to prevent overload
   - Printer status module with WebSocket integration
   - Printer discovery via UDP broadcast
   - Number formatting to 2 decimal places for clean output
   - GitHub repository setup with proper `.gitignore`

### 🚀 **Deployment Ready:**
1. **Configure environment variables** in `.env` file
2. **Start LM Studio** with desired vision language model
3. **Run the monitor** with `npm start` or `npm start -- --console` for interactive mode
4. **Monitor logs** in `logs/` directory for system status
5. **Use Telegram commands** for real-time control and status updates

### 🔮 **Future Enhancements:**
- Web dashboard interface for remote monitoring
- Historical analysis and trend detection
- Support for additional printer models
- Mobile app companion
- Automated print recovery actions