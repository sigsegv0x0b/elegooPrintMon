# PrintGuard Models and Prototypes

## Source Attribution

The PrintGuard model and implementation in this project are based on the original **PrintGuard project by Oliver Bravery**:

- **GitHub Repository:** https://github.com/oliverbravery/PrintGuard
- **Original Paper/Project:** Prototype-based classification for 3D printing failure detection
- **License:** GNU General Public License v3.0 (GPL-3.0)

## Files in This Directory

### `model.onnx`
- **Type:** ONNX format neural network model
- **Architecture:** CNN-based feature extractor (likely ResNet-based)
- **Purpose:** Extracts 1024-dimensional embeddings from print images
- **Input:** 224×224 RGB images (grayscale converted to 3 channels)
- **Output:** 1024-dimensional feature vector

### `prototypes/prototypes.json`
- **Type:** JSON file containing pre-computed prototype vectors
- **Contents:**
  - `prototypes`: Array of 1024-dimensional vectors (success and failure)
  - `class_names`: Array of class names (["failure", "success"])
  - `defect_idx`: Index of the defect/failure class (0)
- **Purpose:** Stores mean embeddings for success and failure classes

## How These Files Are Used

1. **Model Inference:** The `model.onnx` file is loaded using ONNX Runtime
2. **Feature Extraction:** Images are processed through the CNN to get embeddings
3. **Prototype Comparison:** Embeddings are compared to stored prototypes using Euclidean distance
4. **Classification:** The closest prototype determines the prediction, with sensitivity adjustment

## Generating Your Own Prototypes

If you want to create custom prototypes for your specific printer/filament:

1. **Collect example images:**
   - Success images: `models/prototypes/success/` (multiple good print images)
   - Failure images: `models/prototypes/failure/` (multiple failed print images)

2. **Run the conversion script:**
   ```bash
   python convert-prototypes-to-json.py
   ```

3. **The script will:**
   - Extract embeddings from all example images
   - Compute mean embeddings for each class
   - Save to `models/prototypes/prototypes.json`

## Legal and Ethical Use

- **License:** GNU General Public License v3.0 (GPL-3.0)
- **Attribution:** Always credit Oliver Bravery's original work
- **Copyleft:** Derivative works must also be licensed under GPL-3.0
- **Commercial Use:** Allowed under GPL-3.0 with source code disclosure requirements
- **Modifications:** Document any modifications made to the original model
- **Data Privacy:** Ensure you have rights to any images used for prototype generation

## Performance Characteristics

- **Processing Speed:** ~18ms per image (55+ FPS)
- **Accuracy:** Depends on quality of prototype images
- **Memory Usage:** ~200MB for model + prototypes
- **Dependencies:** `onnxruntime-node`, `sharp`

## Troubleshooting

If the model doesn't work:
1. Verify ONNX Runtime is installed: `npm list onnxruntime-node`
2. Check model file integrity: `ls -lh models/model.onnx` (should be ~5MB)
3. Validate prototypes: `cat models/prototypes/prototypes.json | jq '.prototypes | length'` (should be 2)
4. Check file permissions: Ensure Node.js can read the model file

## References

- Original PrintGuard repository: https://github.com/oliverbravery/PrintGuard
- ONNX Runtime documentation: https://onnxruntime.ai/
- Prototype-based learning papers (few-shot learning literature)