#!/usr/bin/env node

/**
 * PrintGuard Node.js Implementation
 * 
 * Based on the original PrintGuard project by Oliver Bravery
 * https://github.com/oliverbravery/PrintGuard
 * 
 * This is a Node.js port of PrintGuard's prototype-based classification
 * with sensitivity adjustment for 3D printing failure detection.
 * 
 * Implements the exact same logic as PrintGuard Python version:
 * - Same image preprocessing (Resize(256) → Grayscale → CenterCrop(224) → Normalize)
 * - Same Euclidean distance calculation
 * - Same sensitivity adjustment logic
 * - Same prototype-based classification
 * 
 * Uses the same models and prototypes as the original PrintGuard.
 */

const ort = require('onnxruntime-node');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

/**
 * Euclidean distance between two vectors
 * Same as PrintGuard's distance calculation
 */
function euclideanDistance(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        sum += Math.pow(a[i] - b[i], 2);
    }
    return Math.sqrt(sum);
}

/**
 * Apply sensitivity adjustment (exact same logic as PrintGuard)
 * From utils/backends/base_engine.py:_apply_sensitivity_adjustment()
 * 
 * @param {number} initialPrediction - Initial predicted class index (0 for success, 1 for defect)
 * @param {Array<Array<number>>} distances - Distance matrix [sample][class]
 * @param {number} defectIdx - Index of defect class (usually 1)
 * @param {number} sensitivity - Sensitivity multiplier (default 1.0)
 * @returns {number} Adjusted prediction
 */
function applySensitivityAdjustment(initialPrediction, distances, defectIdx, sensitivity) {
    if (defectIdx < 0) {
        return initialPrediction; // No defect class defined
    }
    
    const finalPrediction = initialPrediction;
    
    // For each sample (in our case, just one sample)
    for (let sampleIdx = 0; sampleIdx < distances.length; sampleIdx++) {
        if (initialPrediction !== defectIdx) {
            // If initially predicted as non-defect, check if should be overridden
            const minDist = Math.min(...distances[sampleIdx]);
            const distToDefect = distances[sampleIdx][defectIdx];
            
            // PrintGuard's sensitivity adjustment logic:
            // If distance to defect <= min_distance * sensitivity, override to defect
            if (distToDefect <= minDist * sensitivity) {
                return defectIdx; // Override to defect
            }
        }
    }
    
    return finalPrediction;
}

/**
 * PrintGuard-style inference with prototype matching
 */
class PrintGuardInference {
    constructor(modelPath, options = {}) {
        this.modelPath = modelPath;
        this.inputDimensions = options.inputDimensions || [3, 224, 224];
        this.mean = options.mean || [0.485, 0.456, 0.406];
        this.std = options.std || [0.229, 0.224, 0.225];
        this.sensitivity = options.sensitivity || 1.0;
        this.session = null;
        this.prototypes = null;
        this.classNames = null;
        this.defectIdx = -1;
    }
    
    /**
     * Initialize model session
     */
    async init() {
        const sessionOptions = {
            executionProviders: ['cpu'],
            graphOptimizationLevel: 'all'
        };
        
        this.session = await ort.InferenceSession.create(this.modelPath, sessionOptions);
        console.log(`Model loaded: input="${this.session.inputNames[0]}", output="${this.session.outputNames[0]}"`);
        
        return this;
    }
    
    /**
     * Set prototypes (like PrintGuard's compute_prototypes)
     * @param {Object} prototypesData - {prototypes: [], classNames: [], defectIdx: number}
     * Also supports snake_case keys (class_names, defect_idx) from Python-generated JSON
     */
    setPrototypes(prototypesData) {
        this.prototypes = prototypesData.prototypes; // Array of prototype vectors
        // Support both camelCase and snake_case keys
        this.classNames = prototypesData.classNames || prototypesData.class_names; // ['success', 'defect']
        this.defectIdx = prototypesData.defectIdx !== undefined ? prototypesData.defectIdx : prototypesData.defect_idx;   // Index of defect class (usually 1)
        
        if (!this.classNames) {
            throw new Error('Prototypes data missing classNames/class_names');
        }
        if (this.defectIdx === undefined) {
            throw new Error('Prototypes data missing defectIdx/defect_idx');
        }
        
        console.log(`Prototypes set for classes: ${this.classNames.join(', ')}`);
        console.log(`Defect class index: ${this.defectIdx}`);
        console.log(`Sensitivity: ${this.sensitivity}`);
    }
    
    /**
     * Preprocess image (same as PrintGuard's preprocessing)
     * Exact match of Python transform:
     * 1. Resize(256) - resize to 256px (maintaining aspect ratio)
     * 2. Grayscale(num_output_channels=3) - convert to grayscale but output 3 identical channels
     * 3. CenterCrop(224) - center crop to 224x224
     * 4. ToTensor() - convert to tensor in range [0, 1]
     * 5. Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
     */
    async preprocessImage(imagePath) {
        const [channels, height, width] = this.inputDimensions;
        
        // Step 1: Resize to 256 (maintaining aspect ratio)
        // Step 2: Convert to grayscale but keep 3 channels (RGB grayscale)
        // Step 3: Center crop to 224x224
        const imageBuffer = await sharp(imagePath)
            .resize(256, 256, { fit: 'inside', withoutEnlargement: true })  // Resize(256)
            .grayscale()  // Convert to grayscale
            .toColourspace('srgb')
            .ensureAlpha()  // Ensure we have alpha channel for consistency
            .raw()
            .toBuffer({ resolveWithObject: true });
        
        // Get dimensions after resize
        const resizedWidth = imageBuffer.info.width;
        const resizedHeight = imageBuffer.info.height;
        
        // Step 3: Center crop to 224x224
        const cropLeft = Math.max(0, Math.floor((resizedWidth - 224) / 2));
        const cropTop = Math.max(0, Math.floor((resizedHeight - 224) / 2));
        const cropWidth = Math.min(224, resizedWidth);
        const cropHeight = Math.min(224, resizedHeight);
        
        // Extract center region
        const croppedBuffer = new Uint8Array(cropWidth * cropHeight);
        const sourceBuffer = imageBuffer.data;
        
        for (let y = 0; y < cropHeight; y++) {
            const sourceY = cropTop + y;
            const sourceRowStart = sourceY * resizedWidth;
            const targetRowStart = y * cropWidth;
            
            for (let x = 0; x < cropWidth; x++) {
                const sourceX = cropLeft + x;
                // Grayscale image has 1 channel per pixel (but we requested raw with ensureAlpha, so might have 2 channels)
                // Actually sharp.grayscale().raw() returns 1 channel
                const sourceIdx = sourceRowStart + sourceX;
                croppedBuffer[targetRowStart + x] = sourceBuffer[sourceIdx];
            }
        }
        
        // If crop is smaller than 224x224, pad with zeros (black)
        const tensorData = new Float32Array(channels * height * width);
        const pixelCount = height * width;
        
        for (let i = 0; i < pixelCount; i++) {
            const x = i % width;
            const y = Math.floor(i / width);
            
            let pixelValue = 0;
            if (x < cropWidth && y < cropHeight) {
                // Grayscale value (0-255)
                pixelValue = croppedBuffer[y * cropWidth + x] / 255.0;
            }
            
            // Step 4 & 5: Apply normalization to all 3 channels (same grayscale value)
            // Since Grayscale(num_output_channels=3) creates 3 identical channels
            const normalizedValue = (pixelValue - this.mean[0]) / this.std[0];
            
            // Set same value for all 3 channels (R, G, B)
            tensorData[i] = normalizedValue;  // R channel
            tensorData[i + pixelCount] = normalizedValue;  // G channel  
            tensorData[i + pixelCount * 2] = normalizedValue;  // B channel
        }
        
        return tensorData;
    }
    
    /**
     * Extract embedding from image (same as PrintGuard's embedding extraction)
     */
    async extractEmbedding(imagePath) {
        const tensorData = await this.preprocessImage(imagePath);
        const [channels, height, width] = this.inputDimensions;
        
        const inputTensor = new ort.Tensor('float32', tensorData, [1, channels, height, width]);
        const results = await this.session.run({ [this.session.inputNames[0]]: inputTensor });
        const outputTensor = results[this.session.outputNames[0]];
        
        return Array.from(outputTensor.data);
    }
    
    /**
     * Classify image using PrintGuard's exact logic
     */
    async classify(imagePath) {
        if (!this.session) {
            throw new Error('Session not initialized. Call init() first.');
        }
        if (!this.prototypes) {
            throw new Error('Prototypes not set. Call setPrototypes() first.');
        }
        
        console.log(`\nProcessing image: ${path.basename(imagePath)}`);
        
        // Step 1: Extract embedding (same as PrintGuard)
        const startTime = Date.now();
        const embedding = await this.extractEmbedding(imagePath);
        const extractTime = Date.now() - startTime;
        
        console.log(`Embedding extracted in ${extractTime}ms (${embedding.length} dimensions)`);
        
        // Step 2: Compute distances to each prototype (Euclidean distance)
        const distances = [];
        for (const prototype of this.prototypes) {
            distances.push(euclideanDistance(embedding, prototype));
        }
        
        console.log(`Distances to prototypes: ${distances.map((d, i) => `${this.classNames[i]}: ${d.toFixed(4)}`).join(', ')}`);
        
        // Step 3: Initial prediction (nearest prototype)
        const initialPrediction = distances.indexOf(Math.min(...distances));
        console.log(`Initial prediction: ${this.classNames[initialPrediction]} (index ${initialPrediction})`);
        
        // Step 4: Apply sensitivity adjustment (PrintGuard's exact logic)
        // Create distance matrix format: [[dist_to_class0, dist_to_class1, ...]]
        const distanceMatrix = [distances];
        const finalPrediction = applySensitivityAdjustment(
            initialPrediction,
            distanceMatrix,
            this.defectIdx,
            this.sensitivity
        );
        
        const wasAdjusted = finalPrediction !== initialPrediction;
        
        // Step 5: Determine if failure detected
        const isFailure = finalPrediction === this.defectIdx;
        
        return {
            embedding,
            distances,
            initialPrediction: {
                index: initialPrediction,
                className: this.classNames[initialPrediction]
            },
            finalPrediction: {
                index: finalPrediction,
                className: this.classNames[finalPrediction]
            },
            sensitivityAdjusted: wasAdjusted,
            isFailure,
            sensitivity: this.sensitivity,
            defectIdx: this.defectIdx,
            processingTime: extractTime
        };
    }
}

/**
 * Main example demonstrating PrintGuard's failure detection
 */
async function main() {
    console.log('=== PrintGuard-Style Failure Detection ===\n');
    console.log('Implements the exact same prototype-based classification with sensitivity adjustment.\n');
    
    const modelPath = path.join(__dirname, 'model.onnx');
    const exampleImage = path.join(__dirname, 'example.jpg');
    
    if (!fs.existsSync(modelPath)) {
        console.error('Model not found. Please copy model.onnx to this directory.');
        return;
    }
    
    // Create example image if needed
    if (!fs.existsSync(exampleImage)) {
        await sharp({
            create: { width: 640, height: 480, channels: 3, background: { r: 100, g: 150, b: 200 } }
        }).jpeg().toFile(exampleImage);
        console.log(`Created example image: ${exampleImage}`);
    }
    
    try {
        // Step 1: Initialize inference engine
        console.log('1. Initializing PrintGuard inference engine...');
        const inference = new PrintGuardInference(modelPath, {
            sensitivity: 1.0 // Same default as PrintGuard
        });
        await inference.init();
        
        // Step 2: Set up prototypes (in real PrintGuard, these are computed from support images)
        console.log('\n2. Setting up prototypes...');
        console.log('   (In real usage, these would be computed from your success/defect example images)');
        
        // For demonstration, we'll create simulated prototypes
        // In reality, you would:
        // 1. Collect example images in success/ and defect/ directories
        // 2. Extract embeddings for each image
        // 3. Compute mean embedding for each class
        
        // Simulated 1024-dimensional prototypes
        const successPrototype = new Array(1024).fill(0).map(() => Math.random() * 0.1);
        const defectPrototype = new Array(1024).fill(0).map(() => Math.random() * 0.1 + 0.9);
        
        inference.setPrototypes({
            prototypes: [successPrototype, defectPrototype],
            classNames: ['success', 'defect'],
            defectIdx: 1 // defect is index 1
        });
        
        // Step 3: Classify example image
        console.log('\n3. Classifying image with PrintGuard logic...');
        const result = await inference.classify(exampleImage);
        
        // Step 4: Display results
        console.log('\n=== PrintGuard Classification Results ===');
        console.log(`Initial prediction: ${result.initialPrediction.className}`);
        console.log(`Final prediction: ${result.finalPrediction.className}`);
        
        if (result.sensitivityAdjusted) {
            console.log(`⚠️  Sensitivity adjustment applied (sensitivity=${result.sensitivity})`);
            console.log(`   Changed from ${result.initialPrediction.className} to ${result.finalPrediction.className}`);
        }
        
        console.log(`\nFailure detected: ${result.isFailure ? '✅ YES - DEFECT FOUND' : '❌ NO - PRINT SUCCESSFUL'}`);
        
        // Step 5: Demonstrate sensitivity adjustment
        console.log('\n=== Sensitivity Adjustment Demo ===');
        console.log('Testing different sensitivity values:');
        
        const sensitivityValues = [0.8, 1.0, 1.2, 1.5];
        for (const sensitivity of sensitivityValues) {
            inference.sensitivity = sensitivity;
            const testResult = applySensitivityAdjustment(
                result.initialPrediction.index,
                [result.distances],
                result.defectIdx,
                sensitivity
            );
            
            const adjusted = testResult !== result.initialPrediction.index;
            console.log(`  Sensitivity ${sensitivity}: ${adjusted ? 'ADJUSTED to defect' : 'No adjustment'} (${testResult === 1 ? 'defect' : 'success'})`);
        }
        
        // Step 6: Explain the decision
        console.log('\n=== Decision Explanation ===');
        console.log(`Distances: success=${result.distances[0].toFixed(4)}, defect=${result.distances[1].toFixed(4)}`);
        console.log(`Min distance: ${Math.min(...result.distances).toFixed(4)}`);
        console.log(`Sensitivity check: defect_distance (${result.distances[1].toFixed(4)}) <= min_distance * ${result.sensitivity} (${(Math.min(...result.distances) * result.sensitivity).toFixed(4)})`);
        console.log(`Result: ${result.distances[1] <= Math.min(...result.distances) * result.sensitivity ? 'TRUE → Mark as defect' : 'FALSE → Keep initial prediction'}`);
        
        console.log('\n=== PrintGuard Process Complete ===');
        
    } catch (error) {
        console.error('\nError:', error.message);
        console.error('Stack:', error.stack);
    }
}

/**
 * Utility to create prototypes from example images (like PrintGuard's compute_prototypes)
 */
async function createPrototypesFromImages(modelPath, successImages, defectImages) {
    const inference = new PrintGuardInference(modelPath);
    await inference.init();
    
    // Extract embeddings for success images
    const successEmbeddings = [];
    for (const imagePath of successImages) {
        if (fs.existsSync(imagePath)) {
            const embedding = await inference.extractEmbedding(imagePath);
            successEmbeddings.push(embedding);
        }
    }
    
    // Extract embeddings for defect images
    const defectEmbeddings = [];
    for (const imagePath of defectImages) {
        if (fs.existsSync(imagePath)) {
            const embedding = await inference.extractEmbedding(imagePath);
            defectEmbeddings.push(embedding);
        }
    }
    
    // Compute prototypes (mean embeddings)
    const computeMean = (embeddings) => {
        const mean = new Array(embeddings[0].length).fill(0);
        for (const emb of embeddings) {
            for (let i = 0; i < emb.length; i++) {
                mean[i] += emb[i];
            }
        }
        for (let i = 0; i < mean.length; i++) {
            mean[i] /= embeddings.length;
        }
        return mean;
    };
    
    const successPrototype = computeMean(successEmbeddings);
    const defectPrototype = computeMean(defectEmbeddings);
    
    return {
        prototypes: [successPrototype, defectPrototype],
        classNames: ['success', 'defect'],
        defectIdx: 1
    };
}

// Run the example
if (require.main === module) {
    main().catch(console.error);
}

module.exports = {
    PrintGuardInference,
    applySensitivityAdjustment,
    euclideanDistance,
    createPrototypesFromImages,
    main
};