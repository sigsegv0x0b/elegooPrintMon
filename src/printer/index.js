/**
 * Elegoo Printer Module
 * Main export for printer discovery and status functionality
 */

const PrinterDiscovery = require('./discovery');
const PrinterStatus = require('./status');

/**
 * Combined printer module with both discovery and status functionality
 */
class PrinterModule {
    constructor() {
        this.discovery = new PrinterDiscovery();
        this.status = null;
        this.printerIP = null;
    }

    /**
     * Initialize with printer IP
     */
    initialize(printerIP = null) {
        if (printerIP) {
            this.printerIP = printerIP;
            this.status = new PrinterStatus(printerIP);
        } else {
            // Try to extract from config
            this.status = new PrinterStatus();
            this.printerIP = this.status.printerIP;
        }
        return this;
    }

    /**
     * Discover printers on network
     */
    async discoverPrinters() {
        return await this.discovery.discoverPrinters();
    }

    /**
     * Get printer status
     */
    async getStatus() {
        if (!this.status) {
            throw new Error('Printer module not initialized. Call initialize() first.');
        }
        return await this.status.getStatus();
    }

    /**
     * Get formatted status text
     */
    async getStatusText() {
        const statusData = await this.getStatus();
        return this.status.formatStatusText(statusData);
    }

    /**
     * Update environment with discovered printer
     */
    async updateEnvWithDiscoveredPrinter(envPath = '.env') {
        const printers = await this.discoverPrinters();
        if (printers.length === 0) {
            throw new Error('No printers found to update environment');
        }
        
        const firstPrinter = printers[0];
        const updated = await this.discovery.updateEnvWithPrinter(firstPrinter, envPath);
        
        if (updated) {
            // Reinitialize with new IP
            this.initialize(firstPrinter.ip);
        }
        
        return {
            success: updated,
            printer: firstPrinter,
            message: updated ? 
                `Updated ${envPath} with printer IP: ${firstPrinter.ip}` :
                `Failed to update ${envPath}`
        };
    }

    /**
     * List files on printer
     */
    async listFiles() {
        if (!this.status) {
            throw new Error('Printer module not initialized. Call initialize() first.');
        }
        return await this.status.listFiles();
    }

    /**
     * Pause print job
     */
    async pausePrint() {
        if (!this.status) {
            throw new Error('Printer module not initialized. Call initialize() first.');
        }
        return await this.status.pausePrint();
    }

    /**
     * Resume print job
     */
    async resumePrint() {
        if (!this.status) {
            throw new Error('Printer module not initialized. Call initialize() first.');
        }
        return await this.status.resumePrint();
    }

    /**
     * Delete files from printer
     */
    async deleteFiles(filePaths) {
        if (!this.status) {
            throw new Error('Printer module not initialized. Call initialize() first.');
        }
        return await this.status.deleteFiles(filePaths);
    }

    /**
     * Check if printer is connected
     */
    isConnected() {
        return this.status ? this.status.isConnected() : false;
    }

    /**
     * Disconnect from printer
     */
    disconnect() {
        if (this.status) {
            this.status.disconnect();
        }
    }
}

// Export individual classes
module.exports = {
    PrinterModule,
    PrinterDiscovery,
    PrinterStatus,
    
    // Convenience function to create instance
    createPrinterModule: (printerIP = null) => {
        const module = new PrinterModule();
        return module.initialize(printerIP);
    }
};