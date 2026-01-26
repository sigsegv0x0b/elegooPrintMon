const dgram = require('dgram');
const logger = require('../utils/logger');

/**
 * Elegoo Printer Discovery Module
 * Discovers Elegoo printers on the network using UDP broadcast
 */
class PrinterDiscovery {
    constructor() {
        this.timeout = 5000; // 5 second timeout
    }

    /**
     * Discover printers on the network using UDP broadcast
     */
    async discoverPrinters() {
        return new Promise((resolve, reject) => {
            logger.info('Discovering Elegoo printers on network...');
            
            const udpSocket = dgram.createSocket('udp4');
            const broadcastMessage = 'M99999';
            const discovered = [];
            
            // Calculate broadcast address (try common network ranges)
            const interfaces = require('os').networkInterfaces();
            let broadcastAddress = null;
            
            for (const interfaceName of Object.keys(interfaces)) {
                const iface = interfaces[interfaceName];
                for (const addr of iface) {
                    if (addr.family === 'IPv4' && !addr.internal) {
                        // Calculate broadcast address for this subnet
                        const parts = addr.address.split('.');
                        broadcastAddress = `${parts[0]}.${parts[1]}.${parts[2]}.255`;
                        logger.info(`Using broadcast address: ${broadcastAddress}`);
                        break;
                    }
                }
                if (broadcastAddress) break;
            }
            
            if (!broadcastAddress) {
                // Fallback to common broadcast addresses
                broadcastAddress = '192.168.1.255';
                logger.info(`Using fallback broadcast address: ${broadcastAddress}`);
            }
            
            udpSocket.on('message', (msg, rinfo) => {
                try {
                    const data = JSON.parse(msg.toString());
                    
                    const printerInfo = {
                        name: data.Data?.Name || 'Unknown',
                        machineName: data.Data?.MachineName || 'Unknown',
                        brandName: data.Data?.BrandName || 'Unknown',
                        ip: data.Data?.MainboardIP || rinfo.address,
                        mainboardID: data.Data?.MainboardID || 'Unknown',
                        firmwareVersion: data.Data?.FirmwareVersion || 'Unknown',
                        protocolVersion: data.Data?.ProtocolVersion || 'Unknown'
                    };
                    
                    discovered.push(printerInfo);
                    
                    logger.debug(`Discovered printer: ${printerInfo.name} at ${printerInfo.ip}`);
                    
                } catch (error) {
                    logger.warn(`Received non-JSON response from ${rinfo.address}: ${msg.toString().substring(0, 100)}`);
                }
            });
            
            udpSocket.on('error', (error) => {
                logger.error(`UDP socket error: ${error.message}`);
                reject(error);
            });
            
            udpSocket.on('listening', () => {
                const address = udpSocket.address();
                logger.info(`UDP discovery listening on ${address.address}:${address.port}`);
                logger.info(`Sending discovery broadcast: "${broadcastMessage}"`);
                
                udpSocket.setBroadcast(true);
                udpSocket.send(broadcastMessage, 3000, broadcastAddress, (err) => {
                    if (err) {
                        logger.error(`Failed to send broadcast: ${err.message}`);
                        reject(err);
                    }
                });
            });
            
            udpSocket.bind(() => {
                // Start listening for responses
                setTimeout(() => {
                    udpSocket.close();
                    
                    if (discovered.length === 0) {
                        logger.warn('No printers found on the network');
                    } else {
                        logger.info(`Found ${discovered.length} printer(s) on network`);
                    }
                    
                    resolve(discovered);
                }, this.timeout);
            });
        });
    }

    /**
     * Format discovered printers for display
     */
    formatDiscoveredPrinters(printers) {
        if (printers.length === 0) {
            return '❌ No printers found on the network';
        }

        let output = `✅ Found ${printers.length} printer(s):\n`;
        output += '='.repeat(60) + '\n';
        
        printers.forEach((printer, index) => {
            output += `${index + 1}. ${printer.name}\n`;
            output += `   📛 Machine: ${printer.machineName}\n`;
            output += `   🏭 Brand: ${printer.brandName}\n`;
            output += `   🌐 IP: ${printer.ip}\n`;
            output += `   🆔 Mainboard ID: ${printer.mainboardID}\n`;
            output += `   💾 Firmware: ${printer.firmwareVersion}\n`;
            output += `   🔌 Protocol: ${printer.protocolVersion}\n`;
            if (index < printers.length - 1) output += '\n';
        });
        
        output += '='.repeat(60);
        return output;
    }

    /**
     * Get the first discovered printer (for auto-configuration)
     */
    getFirstPrinter(printers) {
        if (printers.length === 0) {
            return null;
        }
        return printers[0];
    }

    /**
     * Update environment file with discovered printer IP
     */
    async updateEnvWithPrinter(printer, envPath = '.env') {
        try {
            const fs = require('fs');
            const path = require('path');
            
            let envContent = fs.readFileSync(envPath, 'utf8');
            
            // Update MJPEG_STREAM_URL
            const mjpegRegex = /MJPEG_STREAM_URL=http:\/\/[^:]+:/;
            if (mjpegRegex.test(envContent)) {
                envContent = envContent.replace(mjpegRegex, `MJPEG_STREAM_URL=http://${printer.ip}:`);
                fs.writeFileSync(envPath, envContent);
                logger.info(`Updated ${envPath} with printer IP: ${printer.ip}`);
                return true;
            } else {
                logger.warn(`Could not find MJPEG_STREAM_URL in ${envPath}`);
                return false;
            }
        } catch (error) {
            logger.error(`Failed to update ${envPath}: ${error.message}`);
            return false;
        }
    }
}

module.exports = PrinterDiscovery;