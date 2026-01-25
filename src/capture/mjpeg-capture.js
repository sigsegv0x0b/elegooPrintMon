const config = require('../config/config');
const logger = require('../utils/logger');

class MjpegCapture {
  constructor() {
    this.streamUrl = config.mjpegStreamUrl;
    this.interval = config.frameCaptureInterval;
    this.isCapturing = false;
    this.captureInterval = null;
    this.retryCount = 0;
    this.maxRetries = config.maxRetries;
    this.retryDelay = config.retryDelay;
    this.llmCooldownMs = config.llmCooldownSeconds * 1000;
  }

  async captureFrame() {
    try {
      logger.debug(`Attempting to capture frame from ${this.streamUrl}`);
      
      const response = await fetch(this.streamUrl, {
        headers: {
          'Accept': 'multipart/x-mixed-replace; boundary=--foo',
          'User-Agent': 'ElegooPrintMonitor/1.0'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Read the MJPEG stream and extract the first complete JPEG frame
      const reader = response.body.getReader();
      let receivedBytes = 0;
      const chunks = [];
      const maxBytes = 500000; // Maximum bytes to read before giving up
      
      logger.debug('Reading MJPEG stream...');
      
      while (receivedBytes < maxBytes) {
        const { done, value } = await reader.read();
        
        if (done) {
          throw new Error('Stream ended before finding JPEG frame');
        }
        
        receivedBytes += value.length;
        chunks.push(Buffer.from(value));
        
        // Combine chunks and look for JPEG markers
        const buffer = Buffer.concat(chunks);
        
        // Look for JPEG start marker (0xFF 0xD8)
        const jpegStart = buffer.indexOf(Buffer.from([0xFF, 0xD8]));
        
        if (jpegStart !== -1) {
          // Look for JPEG end marker (0xFF 0xD9) after the start
          const jpegEnd = buffer.indexOf(Buffer.from([0xFF, 0xD9]), jpegStart);
          
          if (jpegEnd !== -1) {
            // We found a complete JPEG frame
            const jpegData = buffer.slice(jpegStart, jpegEnd + 2);
            
            // Cancel the reader to stop the stream
            reader.cancel();
            
            // Reset retry count on successful capture
            this.retryCount = 0;
            
            logger.debug(`Frame captured successfully (${jpegData.length} bytes)`);
            return jpegData;
          }
        }
        
        // If we've collected enough data but still no JPEG, continue
        if (receivedBytes > 100000 && chunks.length > 20) {
          // Combine and look one more time
          const combinedBuffer = Buffer.concat(chunks);
          const finalJpegStart = combinedBuffer.indexOf(Buffer.from([0xFF, 0xD8]));
          
          if (finalJpegStart !== -1) {
            const finalJpegEnd = combinedBuffer.indexOf(Buffer.from([0xFF, 0xD9]), finalJpegStart);
            if (finalJpegEnd !== -1) {
              const jpegData = combinedBuffer.slice(finalJpegStart, finalJpegEnd + 2);
              reader.cancel();
              this.retryCount = 0;
              logger.debug(`Frame captured from large buffer (${jpegData.length} bytes)`);
              return jpegData;
            }
          }
        }
      }
      
      // If we get here, we didn't find a JPEG frame
      reader.cancel();
      throw new Error(`Could not find JPEG frame in ${receivedBytes} bytes of data`);
      
    } catch (error) {
      this.retryCount++;
      logger.error(`Failed to capture frame (attempt ${this.retryCount}/${this.maxRetries}): ${error.message}`);
      
      if (this.retryCount >= this.maxRetries) {
        throw new Error(`Max retries (${this.maxRetries}) exceeded for frame capture`);
      }
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, this.retryDelay));
      return this.captureFrame(); // Retry
    }
  }

  startCapture(callback) {
    if (this.isCapturing) {
      logger.warn('Capture already running');
      return;
    }

    this.isCapturing = true;
    logger.info(`Starting frame capture every ${this.interval}ms from ${this.streamUrl}`);

    const captureLoop = async () => {
      if (!this.isCapturing) return;

      const loopStartTime = Date.now();
      
      try {
        const frame = await this.captureFrame();
        const captureTime = Date.now() - loopStartTime;
        
        logger.debug(`Frame capture took ${captureTime}ms`);
        
        // Call the callback (which will process with LLM)
        // AWAIT the callback to ensure LLM processing completes before scheduling next capture
        await callback(frame);
        
      } catch (error) {
        logger.error(`Frame capture failed: ${error.message}`);
        
        // If we get a fatal error, stop capturing
        if (error.message.includes('Max retries')) {
          logger.error('Stopping capture due to persistent failures');
          this.stopCapture();
          return;
        }
      }

      // Schedule next capture - ensure we wait at least llmCooldownMs AFTER LLM processing completes
      // Since elapsedTime includes LLM processing time, we need to wait from now
      if (this.isCapturing) {
        const elapsedTime = Date.now() - loopStartTime;
        // Wait at least the cooldown period OR the configured interval, whichever is longer
        // This prevents LLM overload while respecting user configuration
        const minimumWait = Math.max(this.llmCooldownMs, this.interval);
        const nextCaptureDelay = Math.max(minimumWait, 5000); // At least 5 seconds as safety
        logger.debug(`LLM processing complete. Scheduling next capture in ${nextCaptureDelay}ms (elapsed: ${elapsedTime}ms, cooldown: ${this.llmCooldownMs}ms, interval: ${this.interval}ms)`);
        setTimeout(captureLoop, nextCaptureDelay);
      }
    };

    // Start the capture loop
    captureLoop();
  }

  stopCapture() {
    if (!this.isCapturing) {
      logger.warn('Capture not running');
      return;
    }

    this.isCapturing = false;
    logger.info('Frame capture stopped');
  }

  // Test connection to stream
  async testConnection() {
    try {
      logger.info(`Testing connection to ${this.streamUrl}`);
      
      const response = await fetch(this.streamUrl, {
        method: 'HEAD',
        timeout: 5000
      });
      
      if (response.ok) {
        logger.info(`Connection test successful (HTTP ${response.status})`);
        return true;
      } else {
        logger.warn(`Connection test failed (HTTP ${response.status})`);
        return false;
      }
    } catch (error) {
      logger.error(`Connection test failed: ${error.message}`);
      return false;
    }
  }
}

module.exports = MjpegCapture;