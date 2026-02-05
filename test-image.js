#!/usr/bin/env node

/**
 * PrintGuard Image Testing Tool - Node.js version
 * Command-line tool to test a sample image using PrintGuard's inference engine.
 * 
 * Usage:
 *     node test-image.js <image_path> [--sensitivity=1.0] [--prototypes-dir=./model/prototypes]
 * 
 * Example:
 *     node test-image.js my_print.jpg
 *     node test-image.js my_print.jpg --sensitivity=1.2
 *     node test-image.js my_print.jpg --prototypes-dir=./my_prototypes
 */

const { PrintGuardInference } = require('./printguard');
const fs = require('fs');
const path = require('path');

// Default constants from PrintGuard's config
const SUCCESS_LABEL = "success";
const SENSITIVITY = 1.0;

/**
 * Setup logging
 */
function setupLogging(verbose = false) {
    // Simple logging to console
    const logLevel = verbose ? 'debug' : 'info';
    return {
        info: (...args) => console.log(...args),
        debug: (...args) => verbose && console.log(...args),
        error: (...args) => console.error(...args),
        warning: (...args) => console.warn(...args)
    };
}

/**
 * Parse command line arguments
 */
function parseArguments() {
    const args = process.argv.slice(2);
    let imagePath = null;
    let sensitivity = SENSITIVITY;
    let prototypesDir = null;
    let modelPath = null;
    let verbose = false;

    for (const arg of args) {
        if (arg.startsWith('--sensitivity=')) {
            sensitivity = parseFloat(arg.split('=')[1]);
        } else if (arg.startsWith('--prototypes-dir=')) {
            prototypesDir = arg.split('=')[1];
        } else if (arg.startsWith('--model-path=')) {
            modelPath = arg.split('=')[1];
        } else if (arg === '--verbose' || arg === '-v') {
            verbose = true;
        } else if (arg.startsWith('--')) {
            // Ignore other flags
        } else if (!imagePath) {
            imagePath = arg;
        }
    }

    return { imagePath, sensitivity, prototypesDir, modelPath, verbose };
}

/**
 * Validate image path
 */
function validateImagePath(imagePath) {
    if (!fs.existsSync(imagePath)) {
        throw new Error(`Image file not found: ${imagePath}`);
    }

    if (!fs.accessSync || !fs.accessSync(imagePath, fs.constants.R_OK)) {
        try {
            fs.accessSync(imagePath, fs.constants.R_OK);
        } catch {
            throw new Error(`Cannot read image file: ${imagePath}`);
        }
    }

    // Check if it's a valid image file (basic check)
    const validExtensions = ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif'];
    const ext = path.extname(imagePath).toLowerCase();
    if (!validExtensions.includes(ext)) {
        console.warn(`Warning: File ${imagePath} doesn't have a common image extension`);
    }

    return imagePath;
}

/**
 * Get model path (same as PrintGuard's get_model_path)
 */
function getModelPath() {
    // Try to use the model from the PrintGuard package
    const modelPath = path.join(__dirname, '..', 'model', 'model.onnx');
    if (fs.existsSync(modelPath)) {
        return modelPath;
    }
    
    // Fallback to onnx-node-example model
    const localModelPath = path.join(__dirname, 'model.onnx');
    if (fs.existsSync(localModelPath)) {
        return localModelPath;
    }
    
    throw new Error('Model not found. Please ensure model.onnx exists in either ../model/ or ./');
}

/**
 * Get prototypes directory (same as PrintGuard's get_prototypes_dir)
 */
function getPrototypesDir() {
    // Try to use the prototypes from the PrintGuard package
    const prototypesDir = path.join(__dirname, '..', 'model', 'prototypes');
    if (fs.existsSync(prototypesDir)) {
        return prototypesDir;
    }
    
    // Fallback to test_prototypes
    const testPrototypesDir = path.join(__dirname, '..', 'test_prototypes');
    if (fs.existsSync(testPrototypesDir)) {
        return testPrototypesDir;
    }
    
    throw new Error('Prototypes directory not found');
}

/**
 * Load prototypes from directory or JSON file
 */
async function loadPrototypes(prototypesDir, modelPath, inference) {
    // Check if prototypes.json exists in the onnx-node-example directory
    const prototypesJsonPath = path.join(__dirname, 'prototypes.json');
    if (fs.existsSync(prototypesJsonPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(prototypesJsonPath, 'utf8'));
            console.log(`Loaded prototypes from ${prototypesJsonPath}`);
            return data;
        } catch (error) {
            console.error(`Error loading prototypes.json: ${error.message}`);
        }
    }

    // If prototypes directory exists with success/defect images, compute prototypes
    const successDir = path.join(prototypesDir, 'success');
    const defectDir = path.join(prototypesDir, 'defect');
    
    if (fs.existsSync(successDir) && fs.existsSync(defectDir)) {
        console.log(`Computing prototypes from: ${prototypesDir}`);
        
        // Get all image files from directories
        const getImageFiles = (dir) => {
            if (!fs.existsSync(dir)) return [];
            return fs.readdirSync(dir)
                .filter(file => /\.(jpg|jpeg|png|bmp|tiff|tif)$/i.test(file))
                .map(file => path.join(dir, file));
        };
        
        const successImages = getImageFiles(successDir);
        const defectImages = getImageFiles(defectDir);
        
        if (successImages.length === 0 || defectImages.length === 0) {
            throw new Error(`Need at least one image in both success/ and defect/ directories`);
        }
        
        // Use the createPrototypesFromImages function from printguard.js
        const { createPrototypesFromImages } = require('./printguard');
        return await createPrototypesFromImages(modelPath, successImages, defectImages);
    }
    
    // Fallback to default simulated prototypes
    console.warn('Using default prototypes (for demonstration)');
    console.warn('In real usage, create prototypes from your success/defect example images');
    
    // Simulated 1024-dimensional prototypes
    const successPrototype = new Array(1024).fill(0).map(() => Math.random() * 0.1);
    const defectPrototype = new Array(1024).fill(0).map(() => Math.random() * 0.1 + 0.9);
    
    return {
        prototypes: [successPrototype, defectPrototype],
        classNames: ['success', 'defect'],
        defectIdx: 1
    };
}

/**
 * Test a single image and return the prediction
 */
async function testImage(imagePath, inference, prototypes, sensitivity) {
    console.log(`Testing image: ${imagePath}`);
    
    // Set prototypes in inference engine
    inference.setPrototypes(prototypes);
    inference.sensitivity = sensitivity;
    
    // Classify image
    const result = await inference.classify(imagePath);
    
    // Format results similar to Python version
    return {
        prediction: result.finalPrediction.className,
        prediction_idx: result.finalPrediction.index,
        distances: result.distances,
        class_names: prototypes.classNames,
        defect_idx: prototypes.defectIdx,
        sensitivity: sensitivity,
        is_defect: result.isFailure,
        embedding: result.embedding,
        initial_prediction: result.initialPrediction,
        final_prediction: result.finalPrediction,
        sensitivity_adjusted: result.sensitivityAdjusted
    };
}

/**
 * Print results in a readable format (similar to Python version)
 */
function printResults(results, verbose = false) {
    if (!results) {
        console.log("❌ No prediction results available");
        return;
    }
    
    const separator = "=".repeat(60);
    console.log("\n" + separator);
    console.log("PRINTGUARD IMAGE TEST RESULTS");
    console.log(separator);
    
    const prediction = results.prediction;
    const isDefect = results.is_defect;
    
    // Print decision
    if (isDefect) {
        console.log("🚨 DEFECT DETECTED - PRINT FAILURE");
    } else {
        console.log("✅ PRINT DEFECT NOT DETECTED - PRINT SUCCESSFUL");
    }
    
    console.log(`\nPrediction: ${prediction}`);
    console.log(`Sensitivity: ${results.sensitivity}`);
    
    // Print detailed information if available
    if (results.distances && verbose) {
        console.log("\nDetailed distances to prototypes:");
        for (let i = 0; i < results.class_names.length; i++) {
            const className = results.class_names[i];
            const distance = results.distances[i];
            const marker = i === results.prediction_idx ? " ← PREDICTED" : "";
            const defectMarker = i === results.defect_idx ? " (DEFECT)" : "";
            console.log(`  ${className}${defectMarker}: ${distance.toFixed(4)}${marker}`);
        }
    }
    
    // Explain sensitivity adjustment if applicable
    if (results.distances && results.defect_idx >= 0) {
        const distances = results.distances;
        const defectIdx = results.defect_idx;
        const sensitivity = results.sensitivity;
        
        const minDistance = Math.min(...distances);
        const distToDefect = distances[defectIdx];
        
        console.log(`\nSensitivity check:`);
        console.log(`  Distance to defect: ${distToDefect.toFixed(4)}`);
        console.log(`  Minimum distance: ${minDistance.toFixed(4)}`);
        console.log(`  Threshold (min_distance × ${sensitivity}): ${(minDistance * sensitivity).toFixed(4)}`);
        
        if (distToDefect <= minDistance * sensitivity) {
            console.log(`  ✓ Defect distance ≤ threshold → Marked as defect`);
        } else {
            console.log(`  ✗ Defect distance > threshold → Keep initial prediction`);
        }
    }
    
    console.log(separator);
}

/**
 * Main function
 */
async function main() {
    const args = parseArguments();
    const logger = setupLogging(args.verbose);
    
    try {
        // Validate image path
        const imagePath = validateImagePath(args.imagePath);
        
        // Get paths
        const modelPath = args.modelPath || getModelPath();
        const prototypesDir = args.prototypesDir || getPrototypesDir();
        
        // Validate paths
        if (!fs.existsSync(modelPath)) {
            throw new Error(`Model not found: ${modelPath}`);
        }
        
        if (!fs.existsSync(prototypesDir)) {
            throw new Error(`Prototypes directory not found: ${prototypesDir}`);
        }
        
        console.log(`Model: ${modelPath}`);
        console.log(`Prototypes directory: ${prototypesDir}`);
        console.log(`Sensitivity: ${args.sensitivity}`);
        
        // Initialize inference engine
        console.log("Initializing PrintGuard inference engine...");
        const inference = new PrintGuardInference(modelPath, {
            sensitivity: args.sensitivity
        });
        await inference.init();
        
        // Load prototypes
        const prototypes = await loadPrototypes(prototypesDir, modelPath, inference);
        
        // Test the image
        const results = await testImage(imagePath, inference, prototypes, args.sensitivity);
        
        // Print results
        printResults(results, args.verbose);
        
        // Return exit code based on defect detection
        if (results && results.is_defect) {
            process.exit(1); // Defect detected
        } else {
            process.exit(0); // No defect detected
        }
        
    } catch (error) {
        console.error(`\nError: ${error.message}`);
        if (args.verbose && error.stack) {
            console.error(`Stack: ${error.stack}`);
        }
        console.error("\nMake sure:");
        console.error("  1. The image file exists and is readable");
        console.error("  2. PrintGuard model files are in place");
        console.error("  3. Prototypes directory exists with success/defect example images");
        process.exit(2);
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error(`Fatal error: ${error.message}`);
        process.exit(2);
    });
}

// Export for programmatic use
module.exports = {
    testImage,
    loadPrototypes,
    getModelPath,
    getPrototypesDir,
    printResults,
    main
};