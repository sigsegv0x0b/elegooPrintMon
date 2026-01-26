#!/usr/bin/env node

const { PrinterModule } = require('./src/printer');

/**
 * Elegoo Printer Status Checker (CLI)
 * Uses the modular printer status system to check printer status
 */
class PrinterStatusCLI {
    constructor() {
        this.printerModule = new PrinterModule();
    }

    /**
     * Display help message
     */
    displayHelp() {
        console.log(`
🚀 Elegoo Printer Status Checker

USAGE:
  node printer-status.js [OPTIONS]

OPTIONS:
  --discover, -d    Discover printers on the network using UDP broadcast
  --help, -h        Show this help message
  --update-env      Discover printers and update .env file with first found printer

EXAMPLES:
  node printer-status.js              # Check status of printer from .env
  node printer-status.js --discover   # Discover printers on network
  node printer-status.js --update-env # Discover and update .env automatically

DESCRIPTION:
  This tool connects to Elegoo Centauri Carbon printers via the SDCP WebSocket API
  and displays current print status, temperatures, progress, and printer attributes.
  
  In discover mode, it sends UDP broadcast messages to find printers on the local
  network and can automatically update the .env file with the discovered printer IP.
        `);
    }

    /**
     * Run discovery mode
     */
    async runDiscovery() {
        console.log('🔍 Running in discovery mode...\n');
        
        try {
            const printers = await this.printerModule.discoverPrinters();
            
            if (printers.length === 0) {
                console.log('\n❌ No printers found on the network');
                console.log('💡 Make sure:');
                console.log('   - Your Elegoo printer is powered on');
                console.log('   - The printer is connected to the same network');
                console.log('   - No firewall is blocking UDP port 3000');
                return;
            }
            
            console.log(`\n✅ Found ${printers.length} printer(s):`);
            console.log('='.repeat(60));
            
            printers.forEach((printer, index) => {
                console.log(`${index + 1}. ${printer.name}`);
                console.log(`   📛 Machine: ${printer.machineName}`);
                console.log(`   🏭 Brand: ${printer.brandName}`);
                console.log(`   🌐 IP: ${printer.ip}`);
                console.log(`   🆔 Mainboard ID: ${printer.mainboardID}`);
                console.log(`   💾 Firmware: ${printer.firmwareVersion}`);
                console.log(`   🔌 Protocol: ${printer.protocolVersion}`);
                if (index < printers.length - 1) console.log('');
            });
            
            console.log('='.repeat(60));
            
        } catch (error) {
            console.error('✗ Discovery error:', error.message);
        }
    }

    /**
     * Update .env file with discovered printer
     */
    async updateEnvWithDiscoveredPrinter() {
        console.log('🔧 Discovering printers and updating .env file...\n');
        
        try {
            const result = await this.printerModule.updateEnvWithDiscoveredPrinter();
            
            if (result.success) {
                console.log(`\n✅ Updated .env file with printer: ${result.printer.name}`);
                console.log(`   IP: ${result.printer.ip}`);
                console.log(`   Mainboard ID: ${result.printer.mainboardID}`);
                console.log(`   Firmware: ${result.printer.firmwareVersion}`);
            } else {
                console.log('\n⚠️  Could not update .env file');
                console.log('   Make sure MJPEG_STREAM_URL is defined in your .env file');
            }
            
        } catch (error) {
            console.error('✗ Error updating .env:', error.message);
        }
    }

    /**
     * Check printer status
     */
    async checkStatus() {
        console.log('🚀 Elegoo Printer Status Checker\n');
        
        try {
            // Initialize the module (will load IP from config)
            this.printerModule.initialize();
            
            console.log('📡 Connecting to printer...');
            const statusText = await this.printerModule.getStatusText();
            
            console.log('\n' + statusText);
            
        } catch (error) {
            console.error('✗ Error:', error.message);
            console.log('\n💡 Troubleshooting tips:');
            console.log('   1. Make sure your printer is powered on and connected to the network');
            console.log('   2. Check that the IP in your .env file is correct');
            console.log('   3. Try running with --discover to find printers on your network');
            console.log('   4. Ensure no firewall is blocking WebSocket port 3030');
            process.exit(1);
        } finally {
            // Cleanup
            this.printerModule.disconnect();
        }
    }

    /**
     * Main execution function
     */
    async run() {
        const args = process.argv.slice(2);
        
        // Check for help flag
        if (args.includes('--help') || args.includes('-h')) {
            this.displayHelp();
            process.exit(0);
        }
        
        // Check for discover mode
        if (args.includes('--discover') || args.includes('-d')) {
            await this.runDiscovery();
            return;
        }
        
        // Check for update-env mode
        if (args.includes('--update-env')) {
            await this.updateEnvWithDiscoveredPrinter();
            return;
        }
        
        // Default: check status
        await this.checkStatus();
    }
}

// Run the CLI
if (require.main === module) {
    const cli = new PrinterStatusCLI();
    cli.run().catch(console.error);
}

module.exports = PrinterStatusCLI;