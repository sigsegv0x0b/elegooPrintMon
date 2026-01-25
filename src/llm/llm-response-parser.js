const logger = require('../utils/logger');

class LLMResponseParser {
  constructor() {
    // Configuration for parsing
    this.defaultConfidence = {
      object: 0.8,
      problem: 0.7
    };
  }

  parse(responseText) {
    try {
      logger.debug(`Parsing LLM response (full): ${responseText}`);
      
      // Extract JSON from response (LLM might wrap it in markdown or add text)
      let jsonStr = responseText;
      
      // Try to extract JSON from markdown code blocks
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                       responseText.match(/```\n([\s\S]*?)\n```/);
      
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      } else {
        // Try to find JSON object in the text
        const jsonObjectMatch = responseText.match(/{[\s\S]*}/);
        if (jsonObjectMatch) {
          jsonStr = jsonObjectMatch[0];
        }
      }
      
      const parsed = JSON.parse(jsonStr);
      
      // Transform the response to our expected format
      const transformed = this.transform(parsed);
      
      // Validate and normalize the response structure
      this.validateAndNormalize(transformed);
      
      return transformed;
      
    } catch (error) {
      logger.error(`Failed to parse LLM response: ${error.message}`);
      logger.debug(`Raw response (full): ${responseText}`);
      
      // Return a safe default response
      return {
        objects: [],
        problems: [],
        overall_status: "error",
        raw_response: responseText,
        parse_error: error.message
      };
    }
  }

  transform(parsed) {
    // Handle different response formats
    const result = {
      objects: [],
      problems: [],
      overall_status: "good", // Default
      raw_response: parsed // Keep original for debugging
    };
    
    // Extract objects from different possible field names
    if (parsed.objects && Array.isArray(parsed.objects)) {
      result.objects = parsed.objects.map(obj => {
        // Transform object format
        return {
          description: obj.name || obj.description || obj.type || "unknown object",
          bounding_box: this.extractBoundingBox(obj),
          confidence: obj.confidence || obj.confidence_score || this.defaultConfidence.object
        };
      });
    }
    
    // Extract problems/issues from different possible field names
    const problemsArray = parsed.problems || parsed.issues || parsed.errors || [];
    if (Array.isArray(problemsArray)) {
      result.problems = problemsArray.map(problem => {
        return {
          issue: problem.name || problem.issue || problem.description || "unknown issue",
          reason: problem.description || problem.reason || problem.details || "No reason provided",
          bounding_box: this.extractBoundingBox(problem),
          confidence: problem.confidence || problem.severity_score || this.defaultConfidence.problem
        };
      });
    }
    
    // Determine overall status
    if (parsed.overall_status) {
      result.overall_status = parsed.overall_status;
    } else if (parsed.status) {
      // Map status to our status values
      const statusMap = {
        'ok': 'good',
        'good': 'good',
        'warning': 'warning',
        'error': 'critical',
        'critical': 'critical',
        'failed': 'error'
      };
      result.overall_status = statusMap[parsed.status.toLowerCase()] || 'warning';
    } else if (problemsArray.length > 0) {
      result.overall_status = "warning";
    } else {
      result.overall_status = "good";
    }
    
    return result;
  }

  extractBoundingBox(obj) {
    // Try to extract bounding box from different formats
    if (obj.bounding_box && Array.isArray(obj.bounding_box) && obj.bounding_box.length === 4) {
      return obj.bounding_box;
    }
    
    if (obj.position && obj.dimensions) {
      // Convert position and dimensions to bounding box [x1, y1, x2, y2]
      const x = obj.position.x || 0;
      const y = obj.position.y || 0;
      const width = obj.dimensions.width || 10;
      const height = obj.dimensions.height || 10;
      return [x, y, x + width, y + height];
    }
    
    if (obj.bbox && Array.isArray(obj.bbox) && obj.bbox.length === 4) {
      return obj.bbox;
    }
    
    if (obj.location && Array.isArray(obj.location) && obj.location.length === 4) {
      return obj.location;
    }
    
    // Default bounding box (center of image)
    return [0.3, 0.3, 0.7, 0.7];
  }

  validateAndNormalize(response) {
    // Ensure required arrays exist
    if (!response.objects || !Array.isArray(response.objects)) {
      response.objects = [];
    }
    
    if (!response.problems || !Array.isArray(response.problems)) {
      response.problems = [];
    }
    
    // Ensure overall_status is valid
    const validStatuses = ['good', 'warning', 'critical', 'error'];
    if (!response.overall_status || !validStatuses.includes(response.overall_status)) {
      response.overall_status = response.problems.length > 0 ? 'warning' : 'good';
    }
    
    // Validate and fix objects array
    if (Array.isArray(response.objects)) {
      response.objects = response.objects.map((obj, index) => {
        const fixedObj = { ...obj };
        
        if (!fixedObj.description || typeof fixedObj.description !== 'string') {
          fixedObj.description = `Object ${index + 1}`;
        }
        
        if (!fixedObj.bounding_box || !Array.isArray(fixedObj.bounding_box) || fixedObj.bounding_box.length !== 4) {
          fixedObj.bounding_box = [0.3, 0.3, 0.7, 0.7];
        }
        
        if (fixedObj.confidence === undefined || typeof fixedObj.confidence !== 'number') {
          fixedObj.confidence = this.defaultConfidence.object;
        }
        
        // Ensure confidence is between 0 and 1
        fixedObj.confidence = Math.max(0, Math.min(1, fixedObj.confidence));
        
        return fixedObj;
      });
    }
    
    // Validate and fix problems array
    if (Array.isArray(response.problems)) {
      response.problems = response.problems.map((problem, index) => {
        const fixedProblem = { ...problem };
        
        if (!fixedProblem.issue || typeof fixedProblem.issue !== 'string') {
          fixedProblem.issue = `Issue ${index + 1}`;
        }
        
        if (!fixedProblem.reason || typeof fixedProblem.reason !== 'string') {
          fixedProblem.reason = 'No reason provided';
        }
        
        if (!fixedProblem.bounding_box || !Array.isArray(fixedProblem.bounding_box) || fixedProblem.bounding_box.length !== 4) {
          fixedProblem.bounding_box = [0.3, 0.3, 0.7, 0.7];
        }
        
        if (fixedProblem.confidence === undefined || typeof fixedProblem.confidence !== 'number') {
          fixedProblem.confidence = this.defaultConfidence.problem;
        }
        
        // Ensure confidence is between 0 and 1
        fixedProblem.confidence = Math.max(0, Math.min(1, fixedProblem.confidence));
        
        return fixedProblem;
      });
    }
    
    return response;
  }

  // Helper method to test parsing with sample responses
  testParse(sampleResponse) {
    try {
      const result = this.parse(sampleResponse);
      console.log('Parsing result:', JSON.stringify(result, null, 2));
      return result;
    } catch (error) {
      console.error('Test parse failed:', error.message);
      return null;
    }
  }
}

module.exports = LLMResponseParser;