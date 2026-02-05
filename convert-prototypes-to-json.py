#!/usr/bin/env python3
"""
Convert PrintGuard prototypes.pkl to JSON format for use in Node.js.
This script reads the pickle file containing PyTorch tensors and converts them to plain JSON.
"""

import pickle
import json
import sys
from pathlib import Path

def convert_pickle_to_json(pickle_path, json_path):
    """Convert prototypes.pkl file to JSON format."""
    try:
        # Load pickle file
        with open(pickle_path, 'rb') as f:
            data = pickle.load(f)
        
        print(f"Loaded pickle file: {pickle_path}")
        print(f"Data keys: {list(data.keys())}")
        
        # Convert PyTorch tensors to regular Python lists
        if 'prototypes' in data:
            # Handle PyTorch tensors
            if hasattr(data['prototypes'], 'numpy'):
                prototypes = data['prototypes'].numpy().tolist()
            elif hasattr(data['prototypes'], 'tolist'):
                prototypes = data['prototypes'].tolist()
            else:
                prototypes = list(data['prototypes'])
        else:
            prototypes = []
        
        # Create JSON-compatible structure
        json_data = {
            'prototypes': prototypes,
            'class_names': data.get('class_names', ['failure', 'success']),
            'defect_idx': data.get('defect_idx', 0)
        }
        
        # Write to JSON file
        with open(json_path, 'w') as f:
            json.dump(json_data, f, indent=2)
        
        print(f"\nConverted successfully!")
        print(f"Prototypes shape: {len(prototypes)} x {len(prototypes[0])}")
        print(f"Class names: {json_data['class_names']}")
        print(f"Defect index: {json_data['defect_idx']}")
        print(f"\nJSON file written to: {json_path}")
        
        return json_data
        
    except Exception as e:
        print(f"Error converting pickle file: {e}")
        sys.exit(1)

def main():
    # Determine paths
    script_dir = Path(__file__).parent
    pickle_path = script_dir.parent / 'model' / 'prototypes' / 'cache' / 'prototypes.pkl'
    json_path = script_dir / 'prototypes.json'
    
    # Check if pickle file exists
    if not pickle_path.exists():
        print(f"Error: Pickle file not found: {pickle_path}")
        sys.exit(1)
    
    # Convert pickle to JSON
    convert_pickle_to_json(pickle_path, json_path)
    
    # Also create a copy in the model directory for easy access
    model_json_path = script_dir.parent / 'model' / 'prototypes' / 'cache' / 'prototypes.json'
    model_json_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(json_path, 'r') as f:
        json_data = json.load(f)
    
    with open(model_json_path, 'w') as f:
        json.dump(json_data, f, indent=2)
    
    print(f"\nAlso copied to: {model_json_path}")

if __name__ == '__main__':
    main()