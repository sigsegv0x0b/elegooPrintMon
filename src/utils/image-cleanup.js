const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

/**
 * Image Cleanup Utility
 * Cleans up old image files from the images directory
 */
class ImageCleanup {
    constructor(imagesDir = 'images') {
        this.imagesDir = imagesDir;
        this.maxAgeHours = 1; // Delete files older than 1 hour
        this.cleanupIntervalMinutes = 30; // Run cleanup every 30 minutes
        this.intervalId = null;
        this.isRunning = false;
    }

    /**
     * Start the cleanup scheduler
     */
    start() {
        if (this.isRunning) {
            logger.warn('Image cleanup already running');
            return;
        }

        this.isRunning = true;
        logger.info(`Starting image cleanup service (max age: ${this.maxAgeHours}h, interval: ${this.cleanupIntervalMinutes}min)`);

        // Run initial cleanup
        this.runCleanup();

        // Schedule periodic cleanup
        this.intervalId = setInterval(() => {
            this.runCleanup();
        }, this.cleanupIntervalMinutes * 60 * 1000); // Convert minutes to milliseconds
    }

    /**
     * Stop the cleanup scheduler
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        logger.info('Image cleanup service stopped');
    }

    /**
     * Run a single cleanup operation
     */
    async runCleanup() {
        try {
            logger.info('Starting image cleanup operation');

            const stats = {
                scanned: 0,
                deleted: 0,
                errors: 0,
                totalSizeFreed: 0
            };

            // Clean main images directory
            const mainStats = await this.cleanupDirectory(this.imagesDir);
            stats.scanned += mainStats.scanned;
            stats.deleted += mainStats.deleted;
            stats.errors += mainStats.errors;
            stats.totalSizeFreed += mainStats.totalSizeFreed;

            // Clean annotated subdirectory
            const annotatedDir = path.join(this.imagesDir, 'annotated');
            try {
                const annotatedStats = await this.cleanupDirectory(annotatedDir);
                stats.scanned += annotatedStats.scanned;
                stats.deleted += annotatedStats.deleted;
                stats.errors += annotatedStats.errors;
                stats.totalSizeFreed += annotatedStats.totalSizeFreed;
            } catch (error) {
                // Annotated directory might not exist, that's okay
                if (error.code !== 'ENOENT') {
                    logger.warn(`Error cleaning annotated directory: ${error.message}`);
                    stats.errors++;
                }
            }

            logger.info(`Image cleanup completed: scanned ${stats.scanned} files, deleted ${stats.deleted} files, freed ${this.formatBytes(stats.totalSizeFreed)}, ${stats.errors} errors`);

        } catch (error) {
            logger.error(`Image cleanup failed: ${error.message}`);
        }
    }

    /**
     * Clean up files in a specific directory
     */
    async cleanupDirectory(dirPath) {
        const stats = {
            scanned: 0,
            deleted: 0,
            errors: 0,
            totalSizeFreed: 0
        };

        try {
            // Check if directory exists
            await fs.access(dirPath);

            // Read directory contents
            const files = await fs.readdir(dirPath);
            stats.scanned = files.length;

            const now = Date.now();
            const maxAgeMs = this.maxAgeHours * 60 * 60 * 1000; // Convert hours to milliseconds

            for (const file of files) {
                const filePath = path.join(dirPath, file);

                try {
                    // Get file stats
                    const fileStats = await fs.stat(filePath);

                    // Only process files (not directories)
                    if (!fileStats.isFile()) {
                        continue;
                    }

                    // Check if file is old enough to delete
                    const fileAgeMs = now - fileStats.mtime.getTime();
                    if (fileAgeMs > maxAgeMs) {
                        // Delete the file
                        await fs.unlink(filePath);
                        stats.deleted++;
                        stats.totalSizeFreed += fileStats.size;

                        // Log the deletion
                        const ageHours = (fileAgeMs / (60 * 60 * 1000)).toFixed(2);
                        logger.info(`Deleted old image: ${filePath} (${this.formatBytes(fileStats.size)}, ${ageHours}h old)`);
                    }

                } catch (error) {
                    logger.warn(`Error processing file ${filePath}: ${error.message}`);
                    stats.errors++;
                }
            }

        } catch (error) {
            if (error.code === 'ENOENT') {
                // Directory doesn't exist, that's okay
                logger.debug(`Directory ${dirPath} does not exist, skipping cleanup`);
            } else {
                logger.error(`Error cleaning directory ${dirPath}: ${error.message}`);
                stats.errors++;
            }
        }

        return stats;
    }

    /**
     * Format bytes to human readable format
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';

        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Get cleanup status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            imagesDir: this.imagesDir,
            maxAgeHours: this.maxAgeHours,
            cleanupIntervalMinutes: this.cleanupIntervalMinutes,
            nextCleanup: this.intervalId ? new Date(Date.now() + (this.cleanupIntervalMinutes * 60 * 1000)).toISOString() : null
        };
    }
}

module.exports = ImageCleanup;