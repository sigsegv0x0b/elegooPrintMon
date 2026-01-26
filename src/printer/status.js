const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Elegoo Printer Status Module
 * Connects to Elegoo Centauri Carbon printer via SDCP WebSocket API
 * Returns structured printer status data for command integration
 */
class PrinterStatus {
    constructor(printerIP = null) {
        this.printerIP = printerIP || this.extractIPFromConfig();
        this.mainboardID = null;
        this.ws = null;
        this.statusData = null;
        this.attributesData = null;
        this.messageHandlers = new Map();
        this.timeout = 5000; // 5 second timeout
        this.connected = false;
        
        if (this.printerIP) {
            logger.info(`PrinterStatus initialized with IP: ${this.printerIP}`);
        } else {
            logger.warn('PrinterStatus initialized without IP - set with setPrinterIP() before connecting');
        }
    }

    /**
     * Extract printer IP from config
     */
    extractIPFromConfig() {
        try {
            const mjpegUrl = config.mjpegStreamUrl;
            const match = mjpegUrl.match(/http:\/\/([^:]+):/);
            if (match) {
                return match[1];
            }
        } catch (error) {
            logger.error(`Error extracting IP from config: ${error.message}`);
        }
        return null;
    }

    /**
     * Set printer IP manually
     */
    setPrinterIP(ip) {
        this.printerIP = ip;
        logger.info(`Printer IP set to: ${ip}`);
    }

    /**
     * Connect to printer WebSocket
     */
    async connect() {
        return new Promise((resolve, reject) => {
            if (!this.printerIP) {
                reject(new Error('Printer IP not set'));
                return;
            }

            const wsURL = `ws://${this.printerIP}:3030/websocket`;
            logger.info(`Connecting to printer WebSocket at ${wsURL}`);

            this.ws = new WebSocket(wsURL);

            let resolved = false;

            this.ws.on('open', () => {
                logger.info('Connected to printer WebSocket');
                this.connected = true;
                // Wait a bit for initial status messages to get mainboard ID
                setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        resolve();
                    }
                }, 1000);
            });

            this.ws.on('message', (data) => {
                this.handleMessage(data.toString());
            });

            this.ws.on('error', (error) => {
                logger.error(`WebSocket error: ${error.message}`);
                if (!resolved) {
                    resolved = true;
                    this.connected = false;
                    reject(error);
                }
            });

            this.ws.on('close', () => {
                logger.info('WebSocket connection closed');
                this.connected = false;
            });

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    this.connected = false;
                    reject(new Error('Connection timeout'));
                }
            }, this.timeout);
        });
    }

    /**
     * Handle incoming WebSocket messages
     */
    handleMessage(data) {
        try {
            const message = JSON.parse(data);
            
            // Extract mainboard ID from topic if not already known
            if (!this.mainboardID && message.Topic) {
                const match = message.Topic.match(/sdcp\/[^\/]+\/([^\/]+)/);
                if (match) {
                    this.mainboardID = match[1];
                    logger.info(`Detected mainboard ID: ${this.mainboardID}`);
                }
            }

            // Handle different message types
            if (message.Topic?.includes('/status/')) {
                this.statusData = message.Data || message.Status;
                if (this.messageHandlers.has('status')) {
                    this.messageHandlers.get('status')(this.statusData);
                }
            } else if (message.Topic?.includes('/attributes/')) {
                this.attributesData = message.Data || message.Attributes;
                if (this.messageHandlers.has('attributes')) {
                    this.messageHandlers.get('attributes')(this.attributesData);
                }
            } else if (message.Topic?.includes('/response/')) {
                if (this.messageHandlers.has('response')) {
                    this.messageHandlers.get('response')(message.Data);
                }
            }

        } catch (error) {
            logger.error(`Error parsing WebSocket message: ${error.message}`);
        }
    }

    /**
     * Send command to printer
     */
    sendCommand(cmd, data = {}) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket not connected');
        }

        // Use the discovered mainboard ID or a generic one if not yet known
        const boardID = this.mainboardID || '00000000000000000000000000000000';
        
        logger.debug(`Sending command ${cmd} to ${boardID}`);

        const command = {
            Id: uuidv4(),
            Data: {
                Cmd: cmd,
                Data: data,
                RequestID: uuidv4(),
                MainboardID: boardID,
                TimeStamp: Math.floor(Date.now() / 1000),
                From: 0 // SDCP_FROM_PC
            },
            Topic: `sdcp/request/${boardID}`
        };

        this.ws.send(JSON.stringify(command));
    }

    /**
     * Request status refresh (Cmd: 0)
     */
    async requestStatus() {
        return new Promise((resolve, reject) => {
            let resolved = false;
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    this.messageHandlers.delete('status');
                    reject(new Error('Status request timeout'));
                }
            }, this.timeout);

            this.messageHandlers.set('status', (data) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    this.messageHandlers.delete('status');
                    resolve(data);
                }
            });

            this.sendCommand(0, {}); // Status refresh command
            
            // Also listen for any status updates that might come automatically
            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    if (message.Topic?.includes('/status/') && !resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        this.messageHandlers.delete('status');
                        resolve(message.Data || message.Status);
                    }
                } catch (error) {
                    // Ignore parse errors
                }
            });
        });
    }

    /**
     * Request attributes (Cmd: 1)
     */
    async requestAttributes() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.messageHandlers.delete('attributes');
                reject(new Error('Attributes request timeout'));
            }, this.timeout);

            this.messageHandlers.set('attributes', (data) => {
                clearTimeout(timeout);
                this.messageHandlers.delete('attributes');
                resolve(data);
            });

            this.sendCommand(1, {}); // Attributes command
        });
    }

    /**
     * Get formatted status for commands
     */
    async getStatus() {
        try {
            // Connect if not already connected
            if (!this.connected) {
                await this.connect();
            }

            // Request status and attributes
            const status = await this.requestStatus();
            const attributes = await this.requestAttributes();

            // Format the data for command responses
            return this.formatStatusData(status, attributes);
            
        } catch (error) {
            logger.error(`Failed to get printer status: ${error.message}`);
            throw error;
        }
    }

    /**
     * Format status data for command responses
     */
    formatStatusData(status, attributes) {
        if (!status) {
            return {
                success: false,
                error: 'No status data available',
                timestamp: new Date().toISOString()
            };
        }

        // Get machine status
        const machineStatus = status.Status?.CurrentStatus || status.CurrentStatus || 0;
        const machineStatusText = this.getMachineStatusText(machineStatus);

        // Get print info
        const printInfo = status.Status?.PrintInfo || status.PrintInfo;
        let printStatus = 0;
        let printStatusText = 'Idle';
        let filename = null;
        let progress = null;
        let timeInfo = null;

        if (printInfo) {
            printStatus = printInfo.Status || 0;
            printStatusText = this.getPrintStatusText(printStatus);
            filename = printInfo.Filename || null;
            
            if (printInfo.CurrentLayer && printInfo.TotalLayer) {
                const progressPercent = ((printInfo.CurrentLayer / printInfo.TotalLayer) * 100).toFixed(2);
                progress = {
                    currentLayer: printInfo.CurrentLayer,
                    totalLayers: printInfo.TotalLayer,
                    percent: progressPercent
                };
            }
            
            if (printInfo.CurrentTicks && printInfo.TotalTicks) {
                const timeProgress = ((printInfo.CurrentTicks / printInfo.TotalTicks) * 100).toFixed(2);
                const elapsed = this.formatTime(printInfo.CurrentTicks);
                const total = this.formatTime(printInfo.TotalTicks);
                const remaining = this.formatTime(printInfo.TotalTicks - printInfo.CurrentTicks);
                timeInfo = {
                    elapsed,
                    total,
                    remaining,
                    progressPercent: timeProgress
                };
            }
        }

        // Temperature information
        const nozzleTemp = status.Status?.TempOfNozzle || status.TempOfNozzle;
        const nozzleTarget = status.Status?.TempTargetNozzle || status.TempTargetNozzle;
        const bedTemp = status.Status?.TempOfHotbed || status.TempOfHotbed;
        const bedTarget = status.Status?.TempTargetHotbed || status.TempTargetHotbed;

        // Position information
        const coords = status.Status?.CurrenCoord || status.CurrenCoord || status.CurrentCoord;

        // Print speed
        const printSpeed = status.Status?.PrintSpeed || status.PrintSpeed;

        // Attributes
        const printerName = attributes?.Name || 'Unknown';
        const firmwareVersion = attributes?.FirmwareVersion || 'Unknown';
        const buildVolume = attributes?.XYZsize || 'Unknown';

        return {
            success: true,
            timestamp: new Date().toISOString(),
            printer: {
                name: printerName,
                firmware: firmwareVersion,
                buildVolume: buildVolume,
                ip: this.printerIP,
                mainboardID: this.mainboardID
            },
            status: {
                machine: {
                    code: machineStatus,
                    text: machineStatusText
                },
                print: {
                    code: printStatus,
                    text: printStatusText,
                    filename: filename
                }
            },
            progress: progress,
            time: timeInfo,
            temperatures: {
                nozzle: {
                    current: nozzleTemp,
                    target: nozzleTarget
                },
                bed: {
                    current: bedTemp,
                    target: bedTarget
                }
            },
            position: coords,
            speed: printSpeed,
            raw: {
                status: status,
                attributes: attributes
            }
        };
    }

    /**
     * Get machine status text from code
     */
    getMachineStatusText(status) {
        const statusMap = {
            0: 'Idle',
            1: 'Printing',
            2: 'File Transferring',
            3: 'Calibrating',
            4: 'Device Testing'
        };
        return statusMap[status] || `Unknown (${status})`;
    }

    /**
     * Get print status text from code
     */
    getPrintStatusText(status) {
        const statusMap = {
            0: 'Idle',
            1: 'Homing',
            2: 'Dropping',
            3: 'Exposing',
            4: 'Lifting',
            5: 'Pausing',
            6: 'Paused',
            7: 'Stopping',
            8: 'Stopped',
            9: 'Complete',
            10: 'File Checking'
        };
        return statusMap[status] || `Unknown (${status})`;
    }

    /**
     * Format time in seconds to human readable format
     */
    formatTime(seconds) {
        if (!seconds || seconds <= 0) return '0s';
        
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        if (hours > 0) {
            return `${hours}h ${minutes}m ${secs}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }

    /**
     * Format status for text output (for commands)
     */
    formatStatusText(statusData) {
        if (!statusData.success) {
            return `❌ Error: ${statusData.error}`;
        }

        const { printer, status, progress, time, temperatures, position, speed } = statusData;
        
        let output = `🖨️ **${printer.name}**\n`;
        output += `🌐 IP: ${printer.ip}\n`;
        output += `💾 Firmware: ${printer.firmware}\n`;
        output += `📏 Build Volume: ${printer.buildVolume}\n\n`;
        
        output += `📋 **Status**\n`;
        output += `   Machine: ${status.machine.text}\n`;
        output += `   Print: ${status.print.text}\n`;
        
        if (status.print.filename) {
            output += `   File: ${status.print.filename}\n`;
        }
        
        if (progress) {
            // Round progress percentage to 2 decimal places
            const progressPercent = parseFloat(progress.percent).toFixed(2);
            output += `   Progress: Layer ${progress.currentLayer}/${progress.totalLayers} (${progressPercent}%)\n`;
        }
        
        if (time) {
            // Round time progress percentage to 2 decimal places
            const timeProgressPercent = parseFloat(time.progressPercent).toFixed(2);
            output += `   Time: ${time.elapsed}/${time.total} (${timeProgressPercent}%)\n`;
            output += `   ETA: ${time.remaining}\n`;
        }
        
        output += `\n🌡️ **Temperatures**\n`;
        if (temperatures.nozzle.current !== undefined) {
            // Round temperatures to 2 decimal places
            const nozzleCurrent = parseFloat(temperatures.nozzle.current).toFixed(2);
            const nozzleTarget = parseFloat(temperatures.nozzle.target).toFixed(2);
            output += `   Nozzle: ${nozzleCurrent}°C/${nozzleTarget}°C\n`;
        }
        if (temperatures.bed.current !== undefined) {
            // Round temperatures to 2 decimal places
            const bedCurrent = parseFloat(temperatures.bed.current).toFixed(2);
            const bedTarget = parseFloat(temperatures.bed.target).toFixed(2);
            output += `   Bed: ${bedCurrent}°C/${bedTarget}°C\n`;
        }
        
        if (position) {
            // Format position coordinates to 2 decimal places
            let formattedPosition = position;
            if (typeof position === 'string') {
                // Try to parse and format if it's a coordinate string
                const coords = position.split(',').map(coord => {
                    const num = parseFloat(coord.trim());
                    return isNaN(num) ? coord.trim() : num.toFixed(2);
                });
                formattedPosition = coords.join(', ');
            }
            output += `\n📍 Position: ${formattedPosition}\n`;
        }
        
        if (speed !== undefined) {
            output += `⚡ Speed: ${speed}%\n`;
        }
        
        output += `\n⏰ Last updated: ${new Date(statusData.timestamp).toLocaleString()}`;
        
        return output;
    }

    /**
     * Close connection
     */
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
            this.connected = false;
        }
    }

    /**
     * Check if connected
     */
    isConnected() {
        return this.connected;
    }
}

module.exports = PrinterStatus;