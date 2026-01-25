const sharp = require('sharp');

class ImageAnnotator {
  constructor() {
    // Color palette for different object types
    this.colors = {
      problem: {
        border: '#FF0000', // Red for problems
        fill: 'rgba(255, 0, 0, 0.1)',
        text: '#FFFFFF'
      },
      object: {
        border: '#00FF00', // Green for normal objects
        fill: 'rgba(0, 255, 0, 0.1)',
        text: '#FFFFFF'
      },
      warning: {
        border: '#FFA500', // Orange for warnings
        fill: 'rgba(255, 165, 0, 0.1)',
        text: '#000000'
      },
      info: {
        border: '#0000FF', // Blue for informational
        fill: 'rgba(0, 0, 255, 0.1)',
        text: '#FFFFFF'
      }
    };
    
    // Font settings
    this.fontSize = 24;
    this.fontFamily = 'sans-serif';
    this.borderWidth = 3;
  }

  /**
   * Annotate an image with bounding boxes from LLM analysis
   * @param {Buffer} imageBuffer - Original image buffer
   * @param {Object} analysis - LLM analysis result
   * @param {Object} options - Annotation options
   * @returns {Promise<Buffer>} - Annotated image buffer
   */
  async annotateImage(imageBuffer, analysis, options = {}) {
    try {
      // Load the image with sharp
      const image = sharp(imageBuffer);
      const metadata = await image.metadata();
      const { width, height } = metadata;
      
      // Create SVG overlay for annotations
      const svgOverlay = this.createSVGOverlay(width, height, analysis, options);
      
      // Composite the SVG overlay onto the image
      const annotatedBuffer = await image
        .composite([{
          input: Buffer.from(svgOverlay),
          blend: 'over'
        }])
        .jpeg({ quality: 90 })
        .toBuffer();
      
      return annotatedBuffer;
      
    } catch (error) {
      console.error(`Image annotation failed: ${error.message}`);
      // Return original image if annotation fails
      return imageBuffer;
    }
  }

  /**
   * Create SVG overlay with bounding boxes and labels
   */
  createSVGOverlay(width, height, analysis, options) {
    const { 
      showLabels = true,
      showConfidence = true,
      borderWidth = this.borderWidth,
      fontSize = this.fontSize
    } = options;
    
    let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
    
    // Draw bounding boxes for objects
    if (analysis.objects && Array.isArray(analysis.objects)) {
      analysis.objects.forEach((obj, index) => {
        if (obj.bounding_box && Array.isArray(obj.bounding_box) && obj.bounding_box.length === 4) {
          const [x1, y1, x2, y2] = obj.bounding_box;
          const color = this.colors.object;
          
          // Convert normalized coordinates to pixel coordinates
          const pixelX1 = x1 * width;
          const pixelY1 = y1 * height;
          const pixelX2 = x2 * width;
          const pixelY2 = y2 * height;
          const boxWidth = pixelX2 - pixelX1;
          const boxHeight = pixelY2 - pixelY1;
          
          // Draw rectangle
          svg += this.createRectangleSVG(
            pixelX1, pixelY1, boxWidth, boxHeight,
            color.border, color.fill, borderWidth
          );
          
          // Draw label
          if (showLabels) {
            const label = obj.description || `Object ${index + 1}`;
            const confidenceText = showConfidence && obj.confidence 
              ? ` (${Math.round(obj.confidence * 100)}%)` 
              : '';
            
            svg += this.createLabelSVG(
              pixelX1, pixelY1 - 5, // Position above the box
              `${label}${confidenceText}`,
              color.text,
              color.border,
              fontSize
            );
          }
        }
      });
    }
    
    // Draw bounding boxes for problems (with red borders)
    if (analysis.problems && Array.isArray(analysis.problems)) {
      analysis.problems.forEach((problem, index) => {
        if (problem.bounding_box && Array.isArray(problem.bounding_box) && problem.bounding_box.length === 4) {
          const [x1, y1, x2, y2] = problem.bounding_box;
          const color = this.colors.problem;
          
          // Convert normalized coordinates to pixel coordinates
          const pixelX1 = x1 * width;
          const pixelY1 = y1 * height;
          const pixelX2 = x2 * width;
          const pixelY2 = y2 * height;
          const boxWidth = pixelX2 - pixelX1;
          const boxHeight = pixelY2 - pixelY1;
          
          // Draw rectangle with red border
          svg += this.createRectangleSVG(
            pixelX1, pixelY1, boxWidth, boxHeight,
            color.border, color.fill, borderWidth * 1.5 // Thicker border for problems
          );
          
          // Draw label
          if (showLabels) {
            const label = problem.issue || `Problem ${index + 1}`;
            const confidenceText = showConfidence && problem.confidence 
              ? ` (${Math.round(problem.confidence * 100)}%)` 
              : '';
            
            svg += this.createLabelSVG(
              pixelX1, pixelY1 - 5, // Position above the box
              `${label}${confidenceText}`,
              color.text,
              color.border,
              fontSize
            );
          }
        }
      });
    }
    
    // Add overall status indicator
    if (analysis.overall_status && options.showStatus) {
      const statusColor = this.getStatusColor(analysis.overall_status);
      const statusText = `Status: ${analysis.overall_status.toUpperCase()}`;
      
      svg += this.createLabelSVG(
        10, 30, // Top-left corner
        statusText,
        '#FFFFFF',
        statusColor,
        fontSize
      );
    }
    
    svg += '</svg>';
    return svg;
  }

  /**
   * Create SVG rectangle element
   */
  createRectangleSVG(x, y, width, height, borderColor, fillColor, borderWidth) {
    return `
      <rect 
        x="${x}" 
        y="${y}" 
        width="${width}" 
        height="${height}" 
        stroke="${borderColor}" 
        stroke-width="${borderWidth}" 
        fill="${fillColor}" 
        fill-opacity="0.3"
      />
    `;
  }

  /**
   * Create SVG text label with background
   */
  createLabelSVG(x, y, text, textColor, bgColor, fontSize) {
    // Estimate text width (rough approximation)
    const textWidth = text.length * (fontSize * 0.6);
    const textHeight = fontSize;
    const padding = 5;
    
    return `
      <rect 
        x="${x - padding}" 
        y="${y - textHeight - padding}" 
        width="${textWidth + padding * 2}" 
        height="${textHeight + padding * 2}" 
        fill="${bgColor}" 
        fill-opacity="0.8"
        rx="3"
      />
      <text 
        x="${x}" 
        y="${y - padding}" 
        font-family="${this.fontFamily}" 
        font-size="${fontSize}" 
        fill="${textColor}" 
        font-weight="bold"
      >
        ${this.escapeSVGText(text)}
      </text>
    `;
  }

  /**
   * Escape special characters for SVG text
   */
  escapeSVGText(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Get color for status indicator
   */
  getStatusColor(status) {
    switch (status.toLowerCase()) {
      case 'critical':
        return '#FF0000'; // Red
      case 'warning':
        return '#FFA500'; // Orange
      case 'good':
        return '#00FF00'; // Green
      case 'error':
        return '#FF00FF'; // Magenta
      default:
        return '#0000FF'; // Blue
    }
  }

  /**
   * Save annotated image to file
   */
  async saveAnnotatedImage(imageBuffer, analysis, outputPath, options = {}) {
    try {
      const annotatedBuffer = await this.annotateImage(imageBuffer, analysis, options);
      await sharp(annotatedBuffer).toFile(outputPath);
      return outputPath;
    } catch (error) {
      console.error(`Failed to save annotated image: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create a simple visualization for console display (ASCII art)
   */
  createConsoleVisualization(analysis, width = 40, height = 20) {
    if (!analysis.objects && !analysis.problems) {
      return 'No objects or problems to visualize';
    }
    
    let grid = Array(height).fill().map(() => Array(width).fill(' '));
    
    // Draw objects
    if (analysis.objects) {
      analysis.objects.forEach(obj => {
        if (obj.bounding_box) {
          const [x1, y1, x2, y2] = obj.bounding_box;
          this.drawBoundingBox(grid, x1, y1, x2, y2, 'O', width, height);
        }
      });
    }
    
    // Draw problems (with 'X' character)
    if (analysis.problems) {
      analysis.problems.forEach(problem => {
        if (problem.bounding_box) {
          const [x1, y1, x2, y2] = problem.bounding_box;
          this.drawBoundingBox(grid, x1, y1, x2, y2, 'X', width, height);
        }
      });
    }
    
    // Convert grid to string
    const border = '+' + '-'.repeat(width) + '+';
    let result = border + '\n';
    grid.forEach(row => {
      result += '|' + row.join('') + '|\n';
    });
    result += border;
    
    return result;
  }

  /**
   * Draw bounding box on ASCII grid
   */
  drawBoundingBox(grid, x1, y1, x2, y2, char, gridWidth, gridHeight) {
    const gridX1 = Math.floor(x1 * gridWidth);
    const gridY1 = Math.floor(y1 * gridHeight);
    const gridX2 = Math.floor(x2 * gridWidth);
    const gridY2 = Math.floor(y2 * gridHeight);
    
    // Draw top and bottom borders
    for (let x = gridX1; x <= gridX2; x++) {
      if (x >= 0 && x < gridWidth) {
        if (gridY1 >= 0 && gridY1 < gridHeight) grid[gridY1][x] = char;
        if (gridY2 >= 0 && gridY2 < gridHeight) grid[gridY2][x] = char;
      }
    }
    
    // Draw left and right borders
    for (let y = gridY1; y <= gridY2; y++) {
      if (y >= 0 && y < gridHeight) {
        if (gridX1 >= 0 && gridX1 < gridWidth) grid[y][gridX1] = char;
        if (gridX2 >= 0 && gridX2 < gridWidth) grid[y][gridX2] = char;
      }
    }
  }
}

module.exports = ImageAnnotator;