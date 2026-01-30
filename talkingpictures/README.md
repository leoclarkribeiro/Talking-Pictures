# Talking Pictures

A privacy-focused web application that animates faces in images based on audio files, creating lip-synced talking head videos. Perfect for journalists, whistleblowers, and creators who need to maintain anonymity while preserving the human connection of video.

## Overview

**Talking Pictures** is a FREE "Puppet-as-a-Service" (PaaS) tool that solves a real problem: maintaining guest anonymity without losing the human connection of video. Simply upload an audio file (.WAV) and an image with a face, and the app automatically generates an animated video where the mouth and eyes move according to the audio.

## Features

- **Automatic Face Detection**: Uses TensorFlow.js and face-api.js to automatically detect facial landmarks
- **Manual Selection**: Fallback manual selection tool for precise mouth and eye area selection
- **Lip Sync Animation**: Mouth opens and closes based on audio amplitude analysis
- **Eye Blinking**: Natural blinking animation with random intervals and speech-synced blinks
- **Video Export**: Automatically generates and downloads MP4 (or WebM fallback) videos
- **Background Generation**: Option to generate videos in the background without preview
- **Dark/Light Mode**: Toggle between futuristic dark and light themes
- **Privacy-Focused**: All processing happens client-side in your browser - no data is sent to servers
- **Responsive Design**: Works on desktop and mobile devices

## How to Use

1. **Upload Audio**: Drop a `.WAV` audio file or click to browse
   - Recommended: Keep audio files under ~45 minutes for best results
   - Split longer files into segments if needed

2. **Upload Image**: Drop an image file containing a face
   - The app will attempt automatic face detection
   - If detection fails, you'll be guided through manual selection

3. **Select Areas** (if manual selection is needed):
   - **Step 1**: Select the mouth area by drawing an oval
   - **Step 2**: Select the left eye area
   - **Step 3**: Select the right eye area
   - **Step 4**: Click "Continue to Animation"

4. **Generate Video**: 
   - The video generation starts automatically once both files are uploaded
   - Optionally check "Skip preview / Generate in background" to hide the preview
   - The video will download automatically when ready

5. **Adjust Settings** (optional):
   - **Mouth Sensitivity**: Control how responsive the mouth is to audio (0.5 - 3.0)
   - **Mouth Size**: Adjust the size of the animated mouth (0.3 - 1.5)

## Technical Details

### Technologies Used

- **HTML5 Canvas**: For rendering and animation
- **Web Audio API**: For audio analysis and amplitude detection
- **TensorFlow.js**: Machine learning framework
- **face-api.js**: Face detection and landmark detection
- **RecordRTC**: For video recording and export
- **Vanilla JavaScript**: No frameworks required

### Browser Compatibility

- Modern browsers with Web Audio API support
- Canvas API support required
- MediaRecorder API for video export (MP4/WebM)

### Privacy & Security

- **100% Client-Side Processing**: All audio and image processing happens in your browser
- **No Server Uploads**: Files never leave your device
- **No Tracking**: No analytics or tracking scripts
- **Open Source**: Review the code to verify privacy claims

## Use Cases

- **Journalism**: Protect source anonymity while maintaining video interviews
- **Whistleblowing**: Share information without revealing identity
- **Content Creation**: Create animated talking head videos from static images
- **Accessibility**: Generate videos with synchronized lip movements
- **Entertainment**: Create fun animated videos from photos and audio

## Design

The app features a **utopian futuristic pixel-art aesthetic** with:
- Sharp, geometric borders (no rounded corners)
- Pixel-grid background pattern
- Cyan/teal accent colors
- Clean SVG icons throughout
- Dark and light theme support
- Modern typography (Outfit + JetBrains Mono)

## License

This project is open source and available for use.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.
