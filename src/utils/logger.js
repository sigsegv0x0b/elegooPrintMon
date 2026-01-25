const winston = require('winston');
const path = require('path');
const config = require('../config/config');

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../../logs');

// Create logger instance
const logger = winston.createLogger({
  level: config.logLevel,
  format: logFormat,
  defaultMeta: { service: 'elegoo-print-monitor' },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, service }) => {
          return `[${timestamp}] ${service} ${level}: ${message}`;
        })
      )
    }),
    // File transport for errors
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // File transport for all logs
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// Add a stream for Morgan compatibility
logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  }
};

// Helper methods for structured logging
logger.logAnalysisResult = function(frameNumber, analysis) {
  this.info(`Frame ${frameNumber} analysis completed`, {
    frameNumber,
    objectsCount: analysis.objects?.length || 0,
    problemsCount: analysis.problems?.length || 0,
    overallStatus: analysis.overall_status || 'unknown'
  });
};

logger.logCriticalProblem = function(frameNumber, problem) {
  this.warn(`Critical problem detected in frame ${frameNumber}`, {
    frameNumber,
    issue: problem.issue,
    confidence: problem.confidence,
    boundingBox: problem.bounding_box
  });
};

logger.logNotificationSent = function(frameNumber, problemsCount) {
  this.info(`Telegram notification sent for frame ${frameNumber}`, {
    frameNumber,
    problemsCount
  });
};

logger.logNotificationFailed = function(frameNumber, error) {
  this.error(`Failed to send Telegram notification for frame ${frameNumber}`, {
    frameNumber,
    error: error.message
  });
};

module.exports = logger;