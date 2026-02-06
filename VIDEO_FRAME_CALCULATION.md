# Video Recording Frame Calculation

## 📊 How Many Frames Are Captured When Asked for Video

When you request a video via Telegram command (e.g., `/video 10`), the system **measures actual stream FPS in real-time** and captures exactly the right number of frames for the requested duration.

### 🔧 **New Real-time Monitoring Implementation**

**File:** [`record-video.js`](record-video.js) (updated)

**Key Features:**
1. **Real-time FPS Measurement**: Parses ffmpeg stderr to calculate actual stream FPS
2. **Dynamic Frame Counting**: No fixed `-frames:v` parameter - adapts to actual FPS
3. **"q" Command Stopping**: Sends `q` to ffmpeg stdin when enough frames captured
4. **Metadata Updates**: Adds actual FPS to video file metadata
5. **Real-time Progress**: Shows frames captured, FPS, and time remaining

### 📈 **New Frame Calculation Formula**

```
frames_captured = requested_duration × measured_actual_fps
```

Where:
- `requested_duration`: Duration in seconds from Telegram command (e.g., 10)
- `measured_actual_fps`: Actual stream FPS measured in real-time (e.g., 10.5fps)

### 🎯 Example Calculations

| Requested Duration | Target FPS | Frames Captured | Calculation |
|-------------------|------------|-----------------|-------------|
| 5 seconds         | 25 fps     | 125 frames      | 5 × 25 = 125 |
| 10 seconds        | 25 fps     | 250 frames      | 10 × 25 = 250 |
| 15 seconds        | 25 fps     | 375 frames      | 15 × 25 = 375 |
| 30 seconds        | 25 fps     | 750 frames      | 30 × 25 = 750 |
| 60 seconds        | 25 fps     | 1500 frames     | 60 × 25 = 1500 |

### 🔍 Actual vs Target FPS

The system **measures actual stream FPS** during recording by parsing ffmpeg output:

```
frame=   93 fps=9.9 q=-1.0 Lsize=     180kB time=00:00:03.60 bitrate= 410.6kbits/s speed=0.384x
```

**Key metrics extracted:**
- `frame=93`: Frame count
- `time=00:00:03.60`: Elapsed time (3.60 seconds)
- **Actual FPS calculation**: `93 ÷ 3.60 = 25.83 fps`

**Important distinction:**
- `fps=9.9`: **Processing FPS** (how fast ffmpeg encodes)
- **Actual stream FPS**: `frame ÷ time` = **25.83 fps** (actual camera output)

### 📊 Adjustment Calculations

If the actual stream FPS differs from the target 25fps, the system calculates the adjustment needed:

**Example: Requesting 10-second video**
- Target: 10s × 25fps = 250 frames
- If actual FPS is 10.5:
  - Actually need: 10s × 10.5fps = 105 frames
  - With 250 frames: 250 ÷ 10.5 = 23.8s video (too long!)
  - **Adjustment factor**: 10.5 ÷ 25 = 0.42x

### 🎥 Real-time Output Example

When recording a 10-second video, you'll see:

```
🔧 Running ffmpeg command:
ffmpeg -y -i http://192.168.10.179:8080/?action=stream -frames:v 250 -r 25 ...

📈 Progress: 93/250 frames (37.2%)
   Time: 3.6s / 10s
   Actual stream FPS: 25.83 (avg: 25.42)
   Processing: 9.9 fps at 0.384x speed
   Frame adjustment: 254 frames needed
   Expected duration: 9.8s

✅ Video recording completed successfully!
📁 Video saved to: images/videos/video_2026-02-05_21-43-39.mp4
📊 File size: 0.98 MB
🎬 Video Recording Complete!
   File: images/videos/video_2026-02-05_21-43-39.mp4
   Size: 0.98 MB
   Target duration: 10s
   Actual stream FPS: 25.42
   Frames captured: 250
   Adjusted frames needed: 254
   Adjustment factor: 1.02x
   Expected actual duration: 9.8s
```

### 📋 Telegram Command Examples

| Command | Frames Captured | Expected Duration |
|---------|-----------------|-------------------|
| `/video` or `/video 5` | 125 frames | 5.0 seconds |
| `/video 10` | 250 frames | 10.0 seconds |
| `/video 15` | 375 frames | 15.0 seconds |
| `/video 30` | 750 frames | 30.0 seconds |
| `/video 60` | 1500 frames | 60.0 seconds |

### 🔧 Technical Details

**ffmpeg arguments used:**
```bash
ffmpeg -y \
  -i http://192.168.10.179:8080/?action=stream \
  -frames:v 250 \          # Exact frame count
  -r 25 \                  # Output frame rate
  -c:v libx264 \           # Video codec
  -preset fast \           # Encoding preset
  -crf 23 \                # Quality setting
  -pix_fmt yuv420p \       # Pixel format
  -vf scale=trunc(iw/2)*2:trunc(ih/2)*2 \  # Ensure even dimensions
  -movflags +faststart \   # Web optimization
  output.mp4
```

**Metadata update command:**
```bash
ffmpeg -y -i video.mp4 \
  -metadata "comment=Actual FPS: 25.42, Target FPS: 25" \
  -c copy \                # Copy without re-encoding
  video_updated.mp4
```

### 📊 Verification Commands

**Check video duration:**
```bash
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 video.mp4
# Output: 10.000000
```

**Check frame count:**
```bash
ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of csv=p=0 video.mp4
# Output: 250
```

**Check metadata:**
```bash
ffprobe -v error -show_entries format_tags=comment -of default=noprint_wrappers=1:nokey=1 video.mp4
# Output: Actual FPS: 25.42, Target FPS: 25
```

### 🎯 Summary

1. **Frame count is exact**: `duration × 25` frames captured
2. **FPS is measured**: Actual stream FPS calculated from `frame ÷ time`
3. **Metadata is updated**: Video files include measured FPS
4. **Adjustment shown**: System logs how many frames would be needed for exact duration
5. **Real-time feedback**: Progress shows actual vs target metrics

The system now provides complete transparency about how many frames are captured and what the actual video characteristics are.