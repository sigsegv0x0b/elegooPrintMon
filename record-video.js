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
   * Parse ffmpeg stderr line to extract frame count, time, and calculate actual FPS
   * @param {string} line - ffmpeg stderr line
   * @returns {Object} Parsed data including actual FPS
   */
  parseFfmpegLine(line) {
    const result = {
      frame: null,
      timeSeconds: null,
      reportedFps: null,
      speed: null,
      actualFps: null
    };

    // Parse frame count: frame=   93
    const frameMatch = line.match(/frame=\s*(\d+)/);
    if (frameMatch) {
      result.frame = parseInt(frameMatch[1], 10);
    }

    // Parse reported FPS: fps=9.9 (this is processing FPS, not stream FPS)
    const fpsMatch = line.match(/fps=\s*([\d.]+)/);
    if (fpsMatch) {
      result.reportedFps = parseFloat(fpsMatch[1]);
    }

    // Parse time: time=00:00:03.60
    const timeMatch = line.match(/time=\s*(\d+):(\d+):([\d.]+)/);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const seconds = parseFloat(timeMatch[3]);
      result.timeSeconds = hours * 3600 + minutes * 60 + seconds;
    }

    // Parse speed: speed=0.384x (processing speed relative to realtime)
    const speedMatch = line.match(/speed=\s*([\d.]+)x/);
    if (speedMatch) {
      result.speed = parseFloat(speedMatch[1]);
    }

    // Calculate actual FPS from frame count and time (more accurate)
    if (result.frame && result.timeSeconds && result.timeSeconds > 0) {
      result.actualFps = result.frame / result.timeSeconds;
    }

    return result;
  }

  /**
   * Calculate frames needed based on actual FPS measurement
   * @param {number} targetDurationSeconds - Desired video duration
   * @param {number} actualFps - Measured FPS from stream
   * @param {number} targetFps - Target/output FPS (default: 25)
   * @returns {Object} Calculation results
   */
  calculateFrameAdjustment(targetDurationSeconds, actualFps, targetFps = 25) {
    if (!actualFps || actualFps <= 0) {
      // If we can't determine actual FPS, use target FPS
      const frames = Math.round(targetDurationSeconds * targetFps);
      return {
        frames,
        actualFps: targetFps,
        adjustmentFactor: 1.0,
        note: 'Using target FPS (actual FPS not available)'
      };
    }

    // Calculate frames needed based on actual stream FPS
    const frames = Math.round(targetDurationSeconds * actualFps);
    const adjustmentFactor = actualFps / targetFps;
    
    return {
      frames,
      actualFps,
      adjustmentFactor,
      note: adjustmentFactor < 0.8 || adjustmentFactor > 1.2 
        ? `Stream FPS differs from target: ${actualFps.toFixed(2)} vs ${targetFps}`
        : 'Stream FPS close to target'
    };
  }

  /**
   * Update MP4 metadata with actual FPS information
   * @param {string} videoFile - Path to MP4 file
   * @param {number} actualFps - Measured FPS
   * @param {number} targetFps - Target FPS
   */
  async updateVideoMetadata(videoFile, actualFps, targetFps = 25) {
    try {
      // Use ffmpeg to update metadata without re-encoding
      const tempFile = videoFile.replace('.mp4', '_temp.mp4');
      const ffmpegArgs = [
        '-y',
        '-i', videoFile,
        '-metadata', `comment=Actual FPS: ${actualFps.toFixed(2)}, Target FPS: ${targetFps}`,
        '-c', 'copy', // Copy streams without re-encoding
        tempFile
      ];
      
      return new Promise((resolve, reject) => {
        const process = spawn('ffmpeg', ffmpegArgs);
        let stderr = '';
        
        process.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        
        process.on('close', (code) => {
          if (code === 0) {
            // Replace original file with updated one
            fs.renameSync(tempFile, videoFile);
            logger.info(`Updated video metadata with actual FPS: ${actualFps.toFixed(2)}`);
            resolve(true);
          } else {
            logger.warn(`Failed to update video metadata: ${stderr}`);
            // Clean up temp file if it exists
            if (fs.existsSync(tempFile)) {
              fs.unlinkSync(tempFile);
            }
            resolve(false); // Don't fail the whole recording
          }
        });
        
        process.on('error', (error) => {
          logger.warn(`Error updating metadata: ${error.message}`);
          resolve(false);
        });
      });
    } catch (error) {
      logger.warn(`Failed to update video metadata: ${error.message}`);
      return false;
    }
  }

  /**
   * Record video from printer stream using real-time frame monitoring
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

    logger.info(`🎥 Recording ${durationSeconds} seconds of video from ${this.streamUrl}`);
    logger.info(`📁 Output file: ${outputFile}`);

    return new Promise((resolve, reject) => {
      // Use ffmpeg to capture continuously, we'll monitor frames and stop when we have enough
      const targetFps = 25; // Printer specification (for output encoding)
      
      const ffmpegArgs = [
        '-y', // Overwrite output file
        '-i', this.streamUrl, // Input stream URL
        '-r', targetFps.toString(), // Output frame rate
        '-c:v', 'libx264', // Video codec
        '-preset', 'fast', // Encoding preset
        '-crf', '23', // Constant Rate Factor (quality)
        '-pix_fmt', 'yuv420p', // Pixel format
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', // Ensure even dimensions
        '-movflags', '+faststart', // Optimize for web streaming
        outputFile
      ];
      
      logger.info(`📊 Target duration: ${durationSeconds} seconds`);
      logger.info(`🎯 Will monitor frames in real-time and stop when we have enough for ${durationSeconds}s`);
      logger.info(`🔍 Using actual stream FPS measurement for precise stopping`);

      // Show the exact ffmpeg command being executed
      const ffmpegCommand = `ffmpeg ${ffmpegArgs.map(arg => arg.includes(' ') ? `"${arg}"` : arg).join(' ')}`;
      console.log(`\n🔧 Running ffmpeg command:\n${ffmpegCommand}\n`);
      console.log(`💡 Note: No -frames:v parameter - will monitor and stop with 'q' command`);
      logger.info(`Executing ffmpeg command: ${ffmpegCommand}`);
      
      this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
        stdio: ['pipe', 'pipe', 'pipe'] // Enable stdin for sending 'q' command
      });
      
      let stderrOutput = '';
      let stdoutOutput = '';
      let fpsMeasurements = [];
      let finalActualFps = null;
      let framesRecorded = 0;
      let timeRecorded = 0;
      let targetFramesNeeded = null;
      let stopTimeout = null;
      let hasStopped = false;
      
      // Function to gracefully stop ffmpeg by sending 'q' to stdin
      const stopRecording = () => {
        if (hasStopped || !this.ffmpegProcess) return;
        
        hasStopped = true;
        logger.info(`⏹️ Stopping recording - sending 'q' to ffmpeg stdin`);
        console.log(`\n⏹️ Stopping recording at ${framesRecorded} frames (${timeRecorded.toFixed(2)}s)`);
        
        // Send 'q' to ffmpeg stdin to gracefully stop
        this.ffmpegProcess.stdin.write('q');
        this.ffmpegProcess.stdin.end();
        
        // Clear any pending timeout
        if (stopTimeout) {
          clearTimeout(stopTimeout);
          stopTimeout = null;
        }
      };
      
      // Capture ffmpeg output for debugging and FPS measurement
      this.ffmpegProcess.stdout.on('data', (data) => {
        stdoutOutput += data.toString();
      });
      
      this.ffmpegProcess.stderr.on('data', (data) => {
        stderrOutput += data.toString();
        const line = data.toString().trim();
        
        // Parse ffmpeg progress line
        if (line.includes('frame=') && line.includes('time=')) {
          const parsed = this.parseFfmpegLine(line);
          framesRecorded = parsed.frame || framesRecorded;
          timeRecorded = parsed.timeSeconds || timeRecorded;
          
          // Collect FPS measurements for averaging
          if (parsed.actualFps && parsed.timeSeconds && parsed.timeSeconds > 1) {
            fpsMeasurements.push(parsed.actualFps);
            
            // Keep only last 5 measurements for responsive average
            if (fpsMeasurements.length > 5) {
              fpsMeasurements.shift();
            }
            
            // Calculate average FPS
            const avgFps = fpsMeasurements.reduce((sum, fps) => sum + fps, 0) / fpsMeasurements.length;
            finalActualFps = avgFps;
            
            // Calculate target frames needed based on actual FPS
            if (avgFps > 0 && !targetFramesNeeded) {
              targetFramesNeeded = Math.round(durationSeconds * avgFps);
              logger.info(`🎯 Target frames calculated: ${targetFramesNeeded} (${durationSeconds}s × ${avgFps.toFixed(2)}fps)`);
              console.log(`\n🎯 Target: ${targetFramesNeeded} frames for ${durationSeconds}s at ${avgFps.toFixed(2)}fps`);
            }
            
            // Log progress every second
            if (parsed.timeSeconds % 1 < 0.1 || fpsMeasurements.length === 1) {
              const progressPercent = targetFramesNeeded ? (framesRecorded / targetFramesNeeded * 100) : 0;
              const timeRemaining = targetFramesNeeded ? (targetFramesNeeded - framesRecorded) / avgFps : 0;
              
              console.log(`\n📈 Progress: ${framesRecorded}${targetFramesNeeded ? `/${targetFramesNeeded}` : ''} frames (${progressPercent.toFixed(1)}%)`);
              console.log(`   Time: ${timeRecorded.toFixed(1)}s / ${durationSeconds}s`);
              console.log(`   Actual stream FPS: ${parsed.actualFps.toFixed(2)} (avg: ${avgFps.toFixed(2)})`);
              console.log(`   Processing: ${parsed.reportedFps || 'N/A'} fps at ${parsed.speed || 'N/A'}x speed`);
              if (timeRemaining > 0) {
                console.log(`   Time remaining: ${timeRemaining.toFixed(1)}s`);
              }
              
              logger.info(`Progress: ${framesRecorded} frames, FPS: ${avgFps.toFixed(2)}, Time: ${timeRecorded.toFixed(1)}s`);
            }
            
            // Check if we have enough frames for the requested duration
            if (targetFramesNeeded && framesRecorded >= targetFramesNeeded && !hasStopped) {
              console.log(`\n✅ Reached target: ${framesRecorded} frames (enough for ${durationSeconds}s)`);
              logger.info(`Reached target frames: ${framesRecorded} >= ${targetFramesNeeded}`);
              stopRecording();
            }
          }
          
          // Log progress messages
          logger.debug(`ffmpeg: ${line}`);
        }
      });
      
      // Set timeout: Based on expected time to capture frames + buffer
      const expectedTimeMs = durationSeconds * 2000; // 2x expected duration (conservative)
      const timeoutMs = expectedTimeMs + 15000; // 2x duration + 15 seconds
      logger.info(`⏱️ Timeout set to ${timeoutMs/1000}s (2x expected ${durationSeconds}s + 15s buffer)`);
      const timeoutId = setTimeout(() => {
        if (this.ffmpegProcess) {
          logger.warn(`ffmpeg process timeout after ${timeoutMs}ms - killing process`);
          this.ffmpegProcess.kill('SIGKILL');
          reject(new Error(`ffmpeg process timeout after ${durationSeconds}s recording`));
        }
      }, timeoutMs);
      
      this.ffmpegProcess.on('close', async (code) => {
        clearTimeout(timeoutId);
        this.ffmpegProcess = null;
        this.isRecording = false;
        
        if (code === 0 || (hasStopped && code === null)) {
          logger.info(`✅ Video recording completed successfully`);
          
          // Check if file was created
          if (fs.existsSync(outputFile)) {
            const stats = fs.statSync(outputFile);
            const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
            logger.info(`📁 Video saved: ${outputFile} (${fileSizeMB} MB)`);
            
            // Update metadata with actual FPS if we measured it
            if (finalActualFps) {
              logger.info(`📊 Measured actual FPS: ${finalActualFps.toFixed(2)} (target: ${targetFps})`);
              await this.updateVideoMetadata(outputFile, finalActualFps, targetFps);
              
              // Log final calculation
              const adjustment = this.calculateFrameAdjustment(durationSeconds, finalActualFps, targetFps);
              console.log(`\n🎬 Video Recording Complete!`);
              console.log(`   File: ${outputFile}`);
              console.log(`   Size: ${fileSizeMB} MB`);
              console.log(`   Target duration: ${durationSeconds}s`);
              console.log(`   Actual stream FPS: ${finalActualFps.toFixed(2)}`);
              console.log(`   Frames captured: ${framesRecorded}`);
              console.log(`   Target frames needed: ${targetFramesNeeded || 'N/A'}`);
              console.log(`   Actual recording time: ${timeRecorded.toFixed(2)}s`);
              console.log(`   Adjustment factor: ${adjustment.adjustmentFactor.toFixed(2)}x`);
              console.log(`   Video duration accuracy: ${Math.abs(timeRecorded - durationSeconds).toFixed(2)}s difference`);
              
              // Show how many frames were captured for the requested duration
              console.log(`\n📊 Frame Capture Summary:`);
              console.log(`   Requested: ${durationSeconds}s video`);
              console.log(`   Captured: ${framesRecorded} frames`);
              console.log(`   At ${finalActualFps.toFixed(2)}fps = ${(framesRecorded / finalActualFps).toFixed(2)}s video`);
              console.log(`   For exact ${durationSeconds}s: need ${adjustment.frames} frames`);
            }
            
            resolve(outputFile);
          } else {
            reject(new Error(`Output file was not created: ${outputFile}`));
          }
        } else {
          logger.error(`❌ ffmpeg failed with code ${code}`);
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
        logger.error(`❌ Failed to start ffmpeg: ${error.message}`);
        reject(error);
      });
      
      logger.info(`▶️ Recording started for ${durationSeconds} seconds...`);
    });
  }

  /**
   * Stop recording immediately
   */
  stop() {
    if (this.isRecording && this.ffmpegProcess) {
      logger.info('⏹️ Stopping recording...');
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

Features:
  • Measures actual stream FPS during recording
  • Updates video metadata with measured FPS
  • Uses exact frame count for precise duration
  • Outputs at 25fps (printer specification)
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
    console.log(`Target frame rate: 25 fps\n`);
    
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
