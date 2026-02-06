#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('./src/config/config');
const logger = require('./src/utils/logger');

class VideoRecorder {
  constructor() {
    this.streamUrl = config.mjpegStreamUrl;
    this.isRecording = false;
    this.ffmpegProcess = null;
  }

  /**
   * Record video from printer stream using ffmpeg
   * @param {number} durationSeconds - Duration in seconds (default: 5)
   * @param {string} outputFile - Output video file path (default: video_YYYYMMDD_HHMMSS.mp4)
   * @returns {Promise<string>} Path to the recorded video file
   */
  async record(durationSeconds = 5, outputFile = null) {
    if (this.isRecording) {
      throw new Error('Already recording');
    }

    this.isRecording = true;
    
    // Create output filename if not provided
    if (!outputFile) {
      const timestamp = new Date().toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .slice(0, 19);
      // Save to images/videos directory by default
      const videosDir = path.join('images', 'videos');
      outputFile = path.join(videosDir, `video_${timestamp}.mp4`);
    }

    // Ensure output directory exists
    const outputDir = path.dirname(outputFile);
    if (outputDir && !fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    logger.info(`Recording ${durationSeconds} seconds of video from ${this.streamUrl}`);
    logger.info(`Output file: ${outputFile}`);

    return new Promise((resolve, reject) => {
      // Use ffmpeg to capture directly from MJPEG stream
      // Using -frames:v for exact frame count (more reliable than -t for MJPEG)
      // Also specify output frame rate with -r to ensure correct duration
      const targetFps = 25; // Printer specification
      const framesNeeded = durationSeconds * targetFps;
      
      const ffmpegArgs = [
        '-y', // Overwrite output file
        '-i', this.streamUrl, // Input stream URL
        '-frames:v', framesNeeded.toString(), // Exact number of frames to capture
        '-r', targetFps.toString(), // Output frame rate (ensures correct duration)
        '-c:v', 'libx264', // Video codec
        '-preset', 'fast', // Encoding preset
        '-crf', '23', // Constant Rate Factor (quality)
        '-pix_fmt', 'yuv420p', // Pixel format
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', // Ensure even dimensions
        '-movflags', '+faststart', // Optimize for web streaming
        outputFile
      ];
      
      logger.info(`Capturing ${framesNeeded} frames at ${targetFps}fps (${durationSeconds}s total)`);

      // Show the exact ffmpeg command being executed
      const ffmpegCommand = `ffmpeg ${ffmpegArgs.map(arg => arg.includes(' ') ? `"${arg}"` : arg).join(' ')}`;
      console.log(`\n🔧 Running ffmpeg command:\n${ffmpegCommand}\n`);
      logger.info(`Executing ffmpeg command: ${ffmpegCommand}`);
      
      this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
      
      let stderrOutput = '';
      let stdoutOutput = '';
      
      // Capture ffmpeg output for debugging
      this.ffmpegProcess.stdout.on('data', (data) => {
        stdoutOutput += data.toString();
      });
      
      this.ffmpegProcess.stderr.on('data', (data) => {
        stderrOutput += data.toString();
        // Log progress messages (frame numbers, bitrate, etc.)
        const line = data.toString().trim();
        if (line.includes('frame=') || line.includes('bitrate=')) {
          logger.debug(`ffmpeg: ${line}`);
        }
      });
      
      // Set timeout: Based on expected time to capture frames + buffer
      // If capturing at 25fps, but stream might be slower, use conservative estimate
      // Minimum 2x expected time + 15 second buffer
      const expectedTimeMs = durationSeconds * 2000; // 2x expected duration (conservative)
      const timeoutMs = expectedTimeMs + 15000; // 2x duration + 15 seconds
      logger.info(`Timeout set to ${timeoutMs/1000}s (2x expected ${durationSeconds}s + 15s buffer)`);
      const timeoutId = setTimeout(() => {
        if (this.ffmpegProcess) {
          logger.warn(`ffmpeg process timeout after ${timeoutMs}ms - killing process`);
          this.ffmpegProcess.kill('SIGKILL');
          reject(new Error(`ffmpeg process timeout after ${durationSeconds}s recording`));
        }
      }, timeoutMs);
      
      this.ffmpegProcess.on('close', (code) => {
        clearTimeout(timeoutId);
        this.ffmpegProcess = null;
        this.isRecording = false;
        
        if (code === 0) {
          logger.info(`Video recording completed successfully`);
          
          // Check if file was created
          if (fs.existsSync(outputFile)) {
            const stats = fs.statSync(outputFile);
            logger.info(`Video saved: ${outputFile} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
            resolve(outputFile);
          } else {
            reject(new Error(`Output file was not created: ${outputFile}`));
          }
        } else {
          logger.error(`ffmpeg failed with code ${code}`);
          if (stderrOutput) {
            // Extract error message from ffmpeg output
            const errorLines = stderrOutput.split('\n').filter(line => 
              line.includes('Error') || line.includes('error') || line.includes('failed')
            );
            if (errorLines.length > 0) {
              logger.error(`ffmpeg errors: ${errorLines.join('; ')}`);
            } else {
              // Log last few lines of stderr for debugging
              const stderrLines = stderrOutput.split('\n').filter(line => line.trim());
              const lastLines = stderrLines.slice(-5).join('; ');
              if (lastLines) {
                logger.error(`ffmpeg last output: ${lastLines}`);
              }
            }
          }
          reject(new Error(`ffmpeg failed with code ${code}`));
        }
      });
      
      this.ffmpegProcess.on('error', (error) => {
        clearTimeout(timeoutId);
        this.ffmpegProcess = null;
        this.isRecording = false;
        logger.error(`Failed to start ffmpeg: ${error.message}`);
        reject(error);
      });
      
      logger.info(`Recording started for ${durationSeconds} seconds...`);
    });
  }

  /**
   * Stop recording immediately
   */
  stop() {
    if (this.isRecording && this.ffmpegProcess) {
      logger.info('Stopping recording...');
      this.ffmpegProcess.kill('SIGTERM');
      this.ffmpegProcess = null;
      this.isRecording = false;
    }
  }
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  let duration = 5; // Default 5 seconds
  let outputFile = null;
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--duration' || arg === '-d') {
      if (i + 1 < args.length) {
        duration = parseInt(args[i + 1], 10);
        if (isNaN(duration) || duration <= 0) {
          console.error('Error: Duration must be a positive number');
          process.exit(1);
        }
        i++; // Skip next argument
      } else {
        console.error('Error: --duration requires a value');
        process.exit(1);
      }
    } else if (arg === '--output' || arg === '-o') {
      if (i + 1 < args.length) {
        outputFile = args[i + 1];
        i++; // Skip next argument
      } else {
        console.error('Error: --output requires a value');
        process.exit(1);
      }
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith('-')) {
      console.error(`Error: Unknown option ${arg}`);
      printHelp();
      process.exit(1);
    } else if (!outputFile) {
      // First non-option argument is output file
      outputFile = arg;
    }
  }
  
  return { duration, outputFile };
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
Video Recorder for Elegoo Printer Stream

Usage: node record-video.js [options] [output-file]

Options:
  -d, --duration SECONDS   Recording duration in seconds (default: 5)
  -o, --output FILE        Output video file path
  -h, --help               Show this help message

Examples:
  node record-video.js                        # Record 5 seconds to auto-named file
  node record-video.js -d 10 myvideo.mp4      # Record 10 seconds to myvideo.mp4
  node record-video.js --duration 30 --output videos/long_recording.mp4
  `);
}

/**
 * Main function
 */
async function main() {
  try {
    const { duration, outputFile } = parseArgs();
    
    console.log(`=== Elegoo Printer Video Recorder ===\n`);
    console.log(`Duration: ${duration} seconds`);
    console.log(`Output: ${outputFile || 'auto-generated filename'}`);
    console.log(`Frame rate: 10 fps\n`);
    
    const recorder = new VideoRecorder();
    
    // Handle Ctrl+C to stop recording gracefully
    process.on('SIGINT', () => {
      console.log('\n\nReceived SIGINT, stopping recording...');
      recorder.stop();
      process.exit(0);
    });
    
    // Start recording
    const videoFile = await recorder.record(duration, outputFile);
    
    console.log(`\n✅ Video recording completed successfully!`);
    console.log(`📁 Video saved to: ${videoFile}`);
    console.log(`📊 File size: ${(fs.statSync(videoFile).size / 1024 / 1024).toFixed(2)} MB`);
    
    process.exit(0);
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    if (error.stack) {
      console.error(`Stack trace: ${error.stack}`);
    }
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = VideoRecorder;