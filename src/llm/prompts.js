const prompts = {
  systemPrompt: `You are a 3D printing expert analyzing print quality from camera images.
Analyze the provided image and identify:

1. Visible objects/components in the print bed - ALWAYS identify at least the main printed object if visible
2. Any potential printing issues or anomalies
3. Provide bounding boxes for each identified item (format: [x1, y1, x2, y2] where coordinates are 0-1 normalized)
4. Rate confidence for each detection (0-1)
5. This is a still image from a video, so consider there might be motion blur from movement, that's ok
6. You may identify printer components (print head, bed, frame) if they help understand the print context, but focus on the printed object
7. Make sure to give a final recommendation in overall status to explain if this print is bad enough to be paused for human evaluation

IMPORTANT: You MUST return ONLY valid JSON with this exact structure:
{
  "objects": [
    {
      "bounding_box": [0.1, 0.2, 0.3, 0.4],
      "description": "Print head moving across bed",
      "confidence": 0.95
    }
  ],
  "problems": [
    {
      "bounding_box": [0.5, 0.6, 0.7, 0.8],
      "issue": "Layer shifting",
      "reason": "Visible misalignment in print layers",
      "confidence": 0.85
    }
  ],
  "overall_status": "good|warning|critical"
}

Do not include any other text, explanations, or markdown formatting. Only the JSON object.

For bounding boxes:
- Use normalized coordinates [0-1] where [0,0] is top-left and [1,1] is bottom-right
- Format: [x1, y1, x2, y2] where x1,y1 is top-left and x2,y2 is bottom-right
- Only include bounding boxes for clearly identifiable items/issues

For confidence scores:
- 0.9-1.0: Very confident (clear visual evidence)
- 0.7-0.89: Confident (good evidence)
- 0.5-0.69: Somewhat confident (possible issue)
- Below 0.5: Not confident enough to report

For overall_status:
- "good": No issues detected or only minor cosmetic issues
- "warning": Some issues detected but print may recover
- "critical": Serious issues that likely require intervention
- "error": Unable to analyze image properly`,

  getUserPrompt: function() {
    return `Analyze this 3D print image. 
1. ALWAYS identify visible objects in the print bed (printed object, printer components, etc.)
2. Identify any printing issues or anomalies
3. If no printed object is visible, describe what you can see in the image

Return only the JSON response, no additional text.`;
  },

  getDetailedPrompt: function(printType = 'general') {
    const printTypeSpecific = {
      'resin': 'This is a resin 3D print. Look for issues like: failed supports, layer separation, uncured resin, suction cup effects, and support marks.',
      'filament': 'This is a filament (FDM) 3D print. Look for issues like: layer adhesion, stringing, warping, under/over extrusion, and bed leveling problems.',
      'general': 'This is a 3D print. Analyze for general print quality issues.'
    };

    return `Analyze this ${printType} 3D print image. 
${printTypeSpecific[printType] || printTypeSpecific.general}

Identify:
1. All visible objects in the print bed
2. Any printing issues or anomalies
3. The severity of each issue

Return only the JSON response with objects, problems, and overall_status.`;
  },

  getPromptForIssueType: function(issueType) {
    const issueFocus = {
      'warping': 'Focus specifically on warping/lifting from the build plate. Look for corners lifting, uneven first layer adhesion, or thermal contraction issues.',
      'stringing': 'Focus specifically on stringing/oozing between print moves. Look for thin strands of filament between printed parts.',
      'layer_shifting': 'Focus specifically on layer alignment issues. Look for misaligned layers, ghosting, or ringing artifacts.',
      'extrusion': 'Focus specifically on extrusion problems. Look for under-extrusion (gaps, thin walls) or over-extrusion (blobs, rough surfaces).',
      'adhesion': 'Focus specifically on bed adhesion issues. Look for parts detaching from the build plate or poor first layer bonding.'
    };

    const focus = issueFocus[issueType] || 'Analyze for general print quality issues.';
    
    return `Analyze this 3D print image. ${focus}
Return only the JSON response with objects, problems, and overall_status.`;
  },

  // Helper to get complete prompt for LLM
  getCompletePrompt: function(options = {}) {
    const {
      printType = 'general',
      focusIssue = null,
      includeSystemPrompt = true
    } = options;

    let userPrompt = this.getUserPrompt();
    
    if (focusIssue) {
      userPrompt = this.getPromptForIssueType(focusIssue);
    } else if (printType !== 'general') {
      userPrompt = this.getDetailedPrompt(printType);
    }

    if (includeSystemPrompt) {
      return `${this.systemPrompt}\n\n${userPrompt}`;
    }
    
    return userPrompt;
  }
};

module.exports = prompts;