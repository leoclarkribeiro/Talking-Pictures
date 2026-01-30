const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights';

class LipSyncAnimator {
    constructor() {
        this.canvas = document.getElementById('animationCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.audioFile = null;
        this.imageFile = null;
        this.image = null;
        this.audioContext = null;
        this.audioBuffer = null;
        this.sourceNode = null;
        this.analyserNode = null;
        this.animationFrameId = null;
        this.isPlaying = false;
        this.isRecording = false;
        this.skipPreview = false;
        this.recorder = null;
        this.audioElement = null;
        this.startTime = 0;
        this.mouthSensitivity = 1.5;
        this.mouthSize = 1.0;
        this.mouthPosition = { x: 0, y: 0, width: 0, height: 0 };
        this.faceDetectionResult = null;  // { landmarks, drawTransform }
        this.modelsLoaded = false;
        this.selectedMouthArea = null;  // { x, y, width, height } relative (0-1)
        this.selectedLeftEyeArea = null;
        this.selectedRightEyeArea = null;
        this.selectionStep = 'mouth';   // 'mouth' | 'leftEye' | 'rightEye'
        this.isSelecting = false;
        this.selectionStart = { x: 0, y: 0 };
        this.selectionCanvas = document.getElementById('selectionCanvas');
        this.selectionCtx = this.selectionCanvas.getContext('2d');
        // Blink animation: both eyes, ~20 per minute, with occasional audio-synced blinks
        this.blinkProgress = 0;         // 0=open, 1=closed
        this.blinkPhase = 'idle';       // 'idle' | 'closing' | 'opening'
        this.nextBlinkTime = 0;
        this.lastBlinkFrameTime = 0;
        this.BLINK_DURATION_MS = 80;    // single close or open phase (twice as fast)
        this.MIN_BLINK_INTERVAL_MS = 2000;  // 2–4s → ~20/min on average
        this.MAX_BLINK_INTERVAL_MS = 4000;
        this.speechActive = false;
        this.lastSpeechEndTime = 0;
        this.isDoubleBlink = false;     // flag for fast double blinks
        this.doubleBlinkDelay = 40;     // ms between blinks in a double blink (twice as fast)
        
        this.setupEventListeners();
        this.setupCanvas();
        this.loadFaceModels();
    }

    async loadFaceModels() {
        const loadingEl = document.getElementById('modelLoading');
        const instructionsEl = document.getElementById('instructions');
        if (loadingEl) {
            loadingEl.classList.remove('hidden');
            if (instructionsEl) instructionsEl.classList.add('hidden');
        }
        if (typeof faceapi === 'undefined') {
            if (loadingEl) {
                loadingEl.innerHTML = '<p style="color:#c00">Face detection library failed to load. Using fallback positioning.</p>';
                setTimeout(async () => {
                    loadingEl.classList.add('hidden');
                    await this.checkReady();
                }, 4000);
            }
            this.modelsLoaded = false;
            this.checkReady();
            return;
        }
        try {
            await Promise.all([
                faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
                faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL)
            ]);
            this.modelsLoaded = true;
            if (loadingEl) loadingEl.classList.add('hidden');
            if (this.image) {
                await this.detectFaceAndMouth();
                this.drawFrame();
            }
            // Check if we should start recording (both files ready)
            await this.checkReady();
        } catch (err) {
            console.error('Failed to load face models:', err);
            if (loadingEl) {
                loadingEl.innerHTML = '<p style="color:#c00">Face models failed to load. Using fallback positioning.</p>';
                setTimeout(async () => {
                    loadingEl.classList.add('hidden');
                    await this.checkReady();
                }, 3000);
            }
            this.modelsLoaded = false;
            this.checkReady();
        }
    }

    setupCanvas() {
        const container = this.canvas.parentElement;
        const updateCanvasSize = () => {
            const size = Math.min(container.clientWidth, container.clientHeight);
            this.canvas.width = size;
            this.canvas.height = size;
            this.selectionCanvas.width = size;
            this.selectionCanvas.height = size;
            if (this.image) this.drawFrame();
            if (this.selectedMouthArea || this.selectedLeftEyeArea || this.selectedRightEyeArea) this.drawSelection();
        };
        updateCanvasSize();
        window.addEventListener('resize', updateCanvasSize);
        this.setupSelectionHandlers();
    }

    setupSelectionHandlers() {
        let isDragging = false;
        let startX = 0, startY = 0;

        this.selectionCanvas.addEventListener('mousedown', (e) => {
            if (!this.isSelecting) return;
            isDragging = true;
            const rect = this.selectionCanvas.getBoundingClientRect();
            startX = e.clientX - rect.left;
            startY = e.clientY - rect.top;
            this.selectionStart = { x: startX, y: startY };
        });

        this.selectionCanvas.addEventListener('mousemove', (e) => {
            if (!isDragging || !this.isSelecting) return;
            const rect = this.selectionCanvas.getBoundingClientRect();
            const currentX = e.clientX - rect.left;
            const currentY = e.clientY - rect.top;
            this.drawSelectionRect(this.selectionStart.x, this.selectionStart.y, currentX, currentY);
        });

        this.selectionCanvas.addEventListener('mouseup', (e) => {
            if (!isDragging || !this.isSelecting) return;
            isDragging = false;
            const rect = this.selectionCanvas.getBoundingClientRect();
            const endX = e.clientX - rect.left;
            const endY = e.clientY - rect.top;
            
            const x = Math.min(this.selectionStart.x, endX);
            const y = Math.min(this.selectionStart.y, endY);
            const width = Math.abs(endX - this.selectionStart.x);
            const height = Math.abs(endY - this.selectionStart.y);
            
            if (width > 10 && height > 10) {
                const area = {
                    x: x / this.selectionCanvas.width,
                    y: y / this.selectionCanvas.height,
                    width: width / this.selectionCanvas.width,
                    height: height / this.selectionCanvas.height
                };
                if (this.selectionStep === 'mouth') {
                    this.selectedMouthArea = area;
                } else if (this.selectionStep === 'leftEye') {
                    this.selectedLeftEyeArea = area;
                } else if (this.selectionStep === 'rightEye') {
                    this.selectedRightEyeArea = area;
                }
                this.drawSelection();
                this.updateSelectionUI();
            }
        });

        this.selectionCanvas.addEventListener('mouseleave', () => {
            if (isDragging && this.isSelecting) {
                isDragging = false;
            }
        });
    }

    drawSelectionRect(x1, y1, x2, y2) {
        this.selectionCtx.clearRect(0, 0, this.selectionCanvas.width, this.selectionCanvas.height);
        // Redraw already-confirmed ovals, then current preview
        this.drawOvalOnSelectionCtx(this.selectedMouthArea);
        this.drawOvalOnSelectionCtx(this.selectedLeftEyeArea, '#28a745');
        this.drawOvalOnSelectionCtx(this.selectedRightEyeArea, '#28a745');
        const x = Math.min(x1, x2);
        const y = Math.min(y1, y2);
        const width = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);
        const cx = x + width / 2;
        const cy = y + height / 2;
        const rx = width / 2;
        const ry = height / 2;
        const stroke = this.selectionStep === 'mouth' ? '#667eea' : '#28a745';
        this.selectionCtx.strokeStyle = stroke;
        this.selectionCtx.lineWidth = 3;
        this.selectionCtx.setLineDash([5, 5]);
        this.selectionCtx.beginPath();
        this.selectionCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        this.selectionCtx.stroke();
        this.selectionCtx.fillStyle = stroke === '#667eea' ? 'rgba(102, 126, 234, 0.1)' : 'rgba(40, 167, 69, 0.08)';
        this.selectionCtx.fill();
    }

    drawOvalOnSelectionCtx(area, strokeStyle = '#667eea') {
        if (!area) return;
        const x = area.x * this.selectionCanvas.width;
        const y = area.y * this.selectionCanvas.height;
        const w = area.width * this.selectionCanvas.width;
        const h = area.height * this.selectionCanvas.height;
        const cx = x + w / 2;
        const cy = y + h / 2;
        const rx = w / 2;
        const ry = h / 2;
        this.selectionCtx.strokeStyle = strokeStyle;
        this.selectionCtx.lineWidth = 3;
        this.selectionCtx.setLineDash([5, 5]);
        this.selectionCtx.beginPath();
        this.selectionCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        this.selectionCtx.stroke();
        this.selectionCtx.fillStyle = strokeStyle === '#667eea' ? 'rgba(102, 126, 234, 0.1)' : 'rgba(40, 167, 69, 0.08)';
        this.selectionCtx.fill();
    }

    drawSelection() {
        this.selectionCtx.clearRect(0, 0, this.selectionCanvas.width, this.selectionCanvas.height);
        this.drawOvalOnSelectionCtx(this.selectedMouthArea);
        this.drawOvalOnSelectionCtx(this.selectedLeftEyeArea, '#28a745');
        this.drawOvalOnSelectionCtx(this.selectedRightEyeArea, '#28a745');
    }

    setupEventListeners() {
        // File inputs
        const audioInput = document.getElementById('audioFile');
        const imageInput = document.getElementById('imageFile');
        const audioBox = audioInput.closest('.upload-box');
        const imageBox = imageInput.closest('.upload-box');

        // Audio file handling
        audioInput.addEventListener('change', (e) => this.handleAudioFile(e.target.files[0]));
        this.setupDragAndDrop(audioBox, audioInput, (file) => {
            if (file.type.startsWith('audio/') || file.name.endsWith('.wav')) {
                this.handleAudioFile(file);
            }
        });

        // Image file handling
        imageInput.addEventListener('change', (e) => this.handleImageFile(e.target.files[0]));
        this.setupDragAndDrop(imageBox, imageInput, (file) => {
            if (file.type.startsWith('image/')) {
                this.handleImageFile(file);
            }
        });

        // Control buttons
        document.getElementById('playBtn').addEventListener('click', () => this.play());
        document.getElementById('stopBtn').addEventListener('click', () => this.stop());
        document.getElementById('recordBtn').addEventListener('click', () => this.toggleRecording());
        document.getElementById('resetBtn').addEventListener('click', () => this.reset());
        document.getElementById('continueBtn').addEventListener('click', () => this.advanceSelectionStep());
        document.getElementById('clearSelectionBtn').addEventListener('click', () => this.clearSelection());
        document.getElementById('skipPreviewCheckbox').addEventListener('change', (e) => {
            this.skipPreview = e.target.checked;
        });

        // Settings
        const sensitivitySlider = document.getElementById('mouthSensitivity');
        const sizeSlider = document.getElementById('mouthSize');
        
        sensitivitySlider.addEventListener('input', (e) => {
            this.mouthSensitivity = parseFloat(e.target.value);
            document.getElementById('sensitivityValue').textContent = this.mouthSensitivity.toFixed(1);
        });

        sizeSlider.addEventListener('input', (e) => {
            this.mouthSize = parseFloat(e.target.value);
            document.getElementById('sizeValue').textContent = this.mouthSize.toFixed(1);
            if (this.image) this.drawFrame();
        });
    }

    setupDragAndDrop(element, input, callback) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            element.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            element.addEventListener(eventName, () => {
                element.classList.add('dragover');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            element.addEventListener(eventName, () => {
                element.classList.remove('dragover');
            });
        });

        element.addEventListener('drop', (e) => {
            const file = e.dataTransfer.files[0];
            if (file) {
                callback(file);
                input.files = e.dataTransfer.files;
            }
        });
    }

    async handleAudioFile(file) {
        if (!file) return;
        
        this.audioFile = file;
        document.getElementById('audioFileName').textContent = `✓ ${file.name}`;
        
        try {
            const arrayBuffer = await file.arrayBuffer();
            this.audioBuffer = await new AudioContext().decodeAudioData(arrayBuffer);
            this.checkReady();
        } catch (error) {
            console.error('Error loading audio:', error);
            alert('Error loading audio file. Please make sure it\'s a valid WAV file.');
        }
    }

    handleImageFile(file) {
        if (!file) return;
        
        this.imageFile = file;
        document.getElementById('imageFileName').textContent = `✓ ${file.name}`;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            this.image = new Image();
            this.image.onload = async () => {
                await this.detectFaceAndMouth();
                this.drawFrame();
                this.checkReady();
            };
            this.image.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    async detectFaceAndMouth() {
        this.faceDetectionResult = null;
        if (!this.image || !this.modelsLoaded || typeof faceapi === 'undefined') {
            this.calculateMouthPosition();
            return;
        }
        try {
            const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
            const result = await faceapi
                .detectSingleFace(this.image, options)
                .withFaceLandmarks()
                .run();
            if (result && result.landmarks) {
                const mouth = result.landmarks.getMouth();
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                mouth.forEach(p => {
                    minX = Math.min(minX, p.x);
                    minY = Math.min(minY, p.y);
                    maxX = Math.max(maxX, p.x);
                    maxY = Math.max(maxY, p.y);
                });
                const width = (maxX - minX) || 1;
                const height = (maxY - minY) || 1;
                this.faceDetectionResult = {
                    centerX: (minX + maxX) / 2,
                    centerY: (minY + maxY) / 2,
                    width,
                    height,
                    points: mouth.map(p => ({ x: p.x, y: p.y }))
                };
            }
        } catch (err) {
            console.warn('Face detection failed, using fallback:', err);
        }
        this.calculateMouthPosition();
    }

    getDrawTransform() {
        if (!this.image) return { offsetX: 0, offsetY: 0, drawWidth: 0, drawHeight: 0 };
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;
        const imageAspect = this.image.width / this.image.height;
        const canvasAspect = canvasWidth / canvasHeight;
        if (imageAspect > canvasAspect) {
            return {
                offsetX: 0,
                offsetY: (canvasHeight - canvasWidth / imageAspect) / 2,
                drawWidth: canvasWidth,
                drawHeight: canvasWidth / imageAspect
            };
        }
        return {
            offsetX: (canvasWidth - canvasHeight * imageAspect) / 2,
            offsetY: 0,
            drawWidth: canvasHeight * imageAspect,
            drawHeight: canvasHeight
        };
    }

    calculateMouthPosition() {
        if (!this.image) return;

        // Use manually selected mouth area if available
        if (this.selectedMouthArea) {
            // Convert relative coordinates to canvas coordinates
            const x = this.selectedMouthArea.x * this.canvas.width;
            const y = this.selectedMouthArea.y * this.canvas.height;
            const width = this.selectedMouthArea.width * this.canvas.width;
            const height = this.selectedMouthArea.height * this.canvas.height;
            
            this.mouthPosition = {
                x: x + width / 2,
                y: y + height / 2,
                width: width * this.mouthSize,
                height: height * this.mouthSize
            };
            return;
        }

        // Fallback to face detection if available
        if (this.faceDetectionResult) {
            const t = this.getDrawTransform();
            const sx = t.drawWidth / this.image.width;
            const sy = t.drawHeight / this.image.height;
            this.mouthPosition = {
                x: t.offsetX + this.faceDetectionResult.centerX * sx,
                y: t.offsetY + this.faceDetectionResult.centerY * sy,
                width: this.faceDetectionResult.width * sx * this.mouthSize,
                height: this.faceDetectionResult.height * sy * this.mouthSize
            };
            return;
        }

        // Final fallback: estimate position
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;
        const imageAspect = this.image.width / this.image.height;
        const canvasAspect = canvasWidth / canvasHeight;
        let drawWidth, drawHeight, offsetX, offsetY;
        if (imageAspect > canvasAspect) {
            drawWidth = canvasWidth;
            drawHeight = canvasWidth / imageAspect;
            offsetX = 0;
            offsetY = (canvasHeight - drawHeight) / 2;
        } else {
            drawWidth = canvasHeight * imageAspect;
            drawHeight = canvasHeight;
            offsetX = (canvasWidth - drawWidth) / 2;
            offsetY = 0;
        }
        this.mouthPosition = {
            x: offsetX + drawWidth / 2,
            y: offsetY + drawHeight * 0.75,
            width: drawWidth * 0.15 * this.mouthSize,
            height: drawHeight * 0.08 * this.mouthSize
        };
    }

    async checkReady() {
        const playBtn = document.getElementById('playBtn');
        const stopBtn = document.getElementById('stopBtn');
        const recordBtn = document.getElementById('recordBtn');
        const instructions = document.getElementById('instructions');
        const selectionMode = document.getElementById('selectionMode');
        
        if (this.audioFile && this.image && this.audioBuffer) {
            const selectionDone = this.selectedMouthArea && this.selectedLeftEyeArea && this.selectedRightEyeArea;
            if (!selectionDone && !this.isRecording && !this.isPlaying) {
                instructions.classList.add('hidden');
                this.showSelectionMode();
            }
        } else {
            playBtn.disabled = true;
            stopBtn.disabled = true;
            recordBtn.disabled = true;
            if (!this.isRecording) {
                instructions.classList.remove('hidden');
                selectionMode.classList.add('hidden');
            }
        }
    }

    getCurrentStepSelection() {
        if (this.selectionStep === 'mouth') return this.selectedMouthArea;
        if (this.selectionStep === 'leftEye') return this.selectedLeftEyeArea;
        if (this.selectionStep === 'rightEye') return this.selectedRightEyeArea;
        return null;
    }

    updateSelectionUI() {
        const iconEl = document.getElementById('selectionStepIcon');
        const textEl = document.getElementById('selectionStepText');
        const descEl = document.getElementById('selectionStepDescription');
        const continueBtn = document.getElementById('continueBtn');
        const clearBtn = document.getElementById('clearSelectionBtn');
        const hasCurrent = !!this.getCurrentStepSelection();
        continueBtn.disabled = !hasCurrent;
        clearBtn.disabled = !hasCurrent;
        const mouthSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="step-icon-svg"><path d="M6 10.5c1.5-.8 4.5-.8 6 0"/><path d="M6 13.5c2.5 1.2 5.5 1.2 8 0"/></svg>';
        const eyeSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="step-icon-svg"><path d="M4 12a8 5 0 0 1 16 0 8 5 0 0 1-16 0z"/><path d="M9 12a3 2.5 0 0 1 6 0 3 2.5 0 0 1-6 0z"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>';
        if (this.selectionStep === 'mouth') {
            if (iconEl) iconEl.innerHTML = mouthSvg;
            if (textEl) textEl.textContent = 'Select Mouth Area';
            descEl.textContent = 'Click and drag on the image above to draw an oval around the mouth area.';
            continueBtn.textContent = 'Confirm Mouth area';
        } else if (this.selectionStep === 'leftEye') {
            if (iconEl) iconEl.innerHTML = eyeSvg;
            if (textEl) textEl.textContent = 'Select Left Eye';
            descEl.textContent = 'Draw an oval around the left eye (viewer’s left).';
            continueBtn.textContent = 'Confirm Left Eye area';
        } else if (this.selectionStep === 'rightEye') {
            if (iconEl) iconEl.innerHTML = eyeSvg;
            if (textEl) textEl.textContent = 'Select Right Eye';
            descEl.textContent = 'Draw an oval around the right eye (viewer’s right).';
            continueBtn.textContent = 'Continue to Animation';
        }
    }

    showSelectionMode() {
        this.isSelecting = true;
        if (!this.selectedMouthArea) this.selectionStep = 'mouth';
        else if (!this.selectedLeftEyeArea) this.selectionStep = 'leftEye';
        else this.selectionStep = 'rightEye';
        const selectionMode = document.getElementById('selectionMode');
        const selectionCanvas = document.getElementById('selectionCanvas');
        selectionMode.classList.remove('hidden');
        selectionCanvas.classList.remove('hidden');
        this.drawFrame();
        this.drawSelection();
        this.updateSelectionUI();
    }

    clearSelection() {
        if (this.selectionStep === 'mouth') this.selectedMouthArea = null;
        else if (this.selectionStep === 'leftEye') this.selectedLeftEyeArea = null;
        else if (this.selectionStep === 'rightEye') this.selectedRightEyeArea = null;
        this.drawSelection();
        this.updateSelectionUI();
    }

    advanceSelectionStep() {
        if (this.selectionStep === 'mouth') {
            this.selectionStep = 'leftEye';
        } else if (this.selectionStep === 'leftEye') {
            this.selectionStep = 'rightEye';
        } else if (this.selectionStep === 'rightEye') {
            this.startAnimation();
            return;
        }
        this.updateSelectionUI();
    }

    async startAnimation() {
        if (!this.selectedMouthArea || !this.selectedLeftEyeArea || !this.selectedRightEyeArea) return;
        
        this.isSelecting = false;
        const selectionMode = document.getElementById('selectionMode');
        const selectionCanvas = document.getElementById('selectionCanvas');
        selectionMode.classList.add('hidden');
        selectionCanvas.classList.add('hidden');
        
        this.calculateMouthPosition();
        
        await new Promise(resolve => setTimeout(resolve, 300));
        await this.startRecording();
    }

    async play() {
        if (!this.audioBuffer || !this.image || this.isPlaying || this.isRecording) return;

        this.isPlaying = true;
        const playBtn = document.getElementById('playBtn');
        const stopBtn = document.getElementById('stopBtn');
        const recordBtn = document.getElementById('recordBtn');
        playBtn.disabled = true;
        stopBtn.disabled = false;
        recordBtn.disabled = true;

        // Create audio context
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.analyserNode = this.audioContext.createAnalyser();
        this.analyserNode.fftSize = 256;
        this.analyserNode.smoothingTimeConstant = 0.8;

        // Create source and connect
        this.sourceNode = this.audioContext.createBufferSource();
        this.sourceNode.buffer = this.audioBuffer;
        this.sourceNode.connect(this.analyserNode);
        this.analyserNode.connect(this.audioContext.destination);

        // Handle audio end
        this.sourceNode.onended = () => {
            this.stop();
        };

        // Start audio
        this.startTime = this.audioContext.currentTime;
        this.sourceNode.start(0);

        // Start animation loop
        this.animate();
    }

    stop() {
        this.isPlaying = false;
        
        if (this.sourceNode) {
            try {
                this.sourceNode.stop();
            } catch (e) {}
        }
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        const playBtn = document.getElementById('playBtn');
        const stopBtn = document.getElementById('stopBtn');
        const recordBtn = document.getElementById('recordBtn');
        playBtn.disabled = false;
        stopBtn.disabled = true;
        if (!this.isRecording) {
            recordBtn.disabled = false;
        }

        // Redraw static image
        this.drawFrame();
    }

    async toggleRecording() {
        if (this.isRecording) {
            await this.stopRecording();
        } else {
            await this.startRecording();
        }
    }

    async startRecording() {
        if (!this.audioBuffer || !this.image || this.isRecording) return;

        this.isRecording = true;
        const recordBtn = document.getElementById('recordBtn');
        const recordingStatus = document.getElementById('recordingStatus');
        const instructions = document.getElementById('instructions');
        recordBtn.textContent = '⏹️ Stop Recording';
        recordBtn.classList.remove('btn-success');
        recordBtn.classList.add('btn-secondary');
        recordingStatus.classList.remove('hidden');
        instructions.classList.add('hidden');

        // Create audio context for playback and recording
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this.analyserNode = audioCtx.createAnalyser();
        this.analyserNode.fftSize = 256;
        this.analyserNode.smoothingTimeConstant = 0.8;

        // Create source
        const sourceNode = audioCtx.createBufferSource();
        sourceNode.buffer = this.audioBuffer;
        sourceNode.connect(this.analyserNode);

        // Create MediaStreamDestination for audio recording
        const destination = audioCtx.createMediaStreamDestination();
        sourceNode.connect(destination);
        // Only play audio if not skipping preview
        if (!this.skipPreview) {
            this.analyserNode.connect(audioCtx.destination); // Play audio
        }

        // Get canvas stream
        const canvasStream = this.canvas.captureStream(24); // 24 FPS

        // Combine video and audio streams
        const videoTrack = canvasStream.getVideoTracks()[0];
        const audioTrack = destination.stream.getAudioTracks()[0];
        
        const combinedStream = new MediaStream([videoTrack, audioTrack]);

        // Determine supported mime type (prefer MP4, fallback to WebM)
        let mimeType = 'video/webm;codecs=vp9';
        if (MediaRecorder.isTypeSupported('video/mp4')) {
            mimeType = 'video/mp4';
        } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
            mimeType = 'video/webm;codecs=vp9';
        } else if (MediaRecorder.isTypeSupported('video/webm')) {
            mimeType = 'video/webm';
        }

        // Check audio duration and warn for very long recordings
        const audioDurationMinutes = this.audioBuffer ? this.audioBuffer.duration / 60 : 0;
        if (audioDurationMinutes > 30) {
            recordingStatus.innerHTML = `<span class="recording-indicator">⚠️</span> <span>Long recording (${audioDurationMinutes.toFixed(1)} min). Processing may take longer. Please keep this tab open.</span>`;
        }

        // Start recording with RecordRTC
        // Use timeSlice for long recordings to avoid memory issues
        const timeSlice = 1000; // Get chunks every second for long recordings
        this.recorder = RecordRTC(combinedStream, {
            type: 'video',
            mimeType: mimeType,
            videoBitsPerSecond: 2500000,
            audioBitsPerSecond: 128000,
            frameRate: 24,
            timeSlice: timeSlice,
            canvas: {
                width: this.canvas.width,
                height: this.canvas.height
            }
        });

        this.recorder.startRecording();

        // Blink: first blink in 5–15 sec, then random 5–15 sec
        const t = performance.now();
        const range = this.MAX_BLINK_INTERVAL_MS - this.MIN_BLINK_INTERVAL_MS;
        this.nextBlinkTime = t + this.MIN_BLINK_INTERVAL_MS + Math.random() * range;
        this.blinkPhase = 'idle';
        this.blinkProgress = 0;
        this.lastBlinkFrameTime = t;

        // Disable other controls during recording
        document.getElementById('playBtn').disabled = true;
        document.getElementById('stopBtn').disabled = true;

        // Handle skip preview mode
        if (this.skipPreview) {
            // Hide canvas and show progress bar
            const canvasContainer = document.querySelector('.canvas-container');
            canvasContainer.style.display = 'none';
            const backgroundProgress = document.getElementById('backgroundProgress');
            backgroundProgress.classList.remove('hidden');
            recordingStatus.classList.add('hidden');
        } else {
            // Show normal recording status
            const canvasContainer = document.querySelector('.canvas-container');
            canvasContainer.style.display = '';
        }

        // Start audio playback and animation
        this.isPlaying = true;
        this.startTime = audioCtx.currentTime;
        this.audioDuration = this.audioBuffer.duration;
        sourceNode.start(0);

        // Handle audio end - stop recording
        sourceNode.onended = async () => {
            await this.stopRecording();
        };

        // Store references for cleanup
        this.audioContext = audioCtx;
        this.sourceNode = sourceNode;

        // Start animation loop
        this.animate();
    }

    async stopRecording() {
        if (!this.isRecording) return;

        this.isRecording = false;
        const recordBtn = document.getElementById('recordBtn');
        const recordingStatus = document.getElementById('recordingStatus');
        
        // Stop animation and audio
        this.isPlaying = false;
        
        if (this.sourceNode) {
            try {
                this.sourceNode.stop();
            } catch (e) {}
        }
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Stop recording
        if (this.recorder) {
            return new Promise((resolve) => {
                // Update status to show we're processing
                recordingStatus.innerHTML = '<span class="recording-indicator">⏳</span> <span>Processing video... This may take a moment for long recordings.</span>';
                
                this.recorder.stopRecording(() => {
                    // For long recordings, wait longer to ensure blob is fully written
                    // Estimate wait time: ~200ms per minute of recording, minimum 1 second
                    const recordingDuration = this.audioBuffer ? this.audioBuffer.duration : 0;
                    const waitTime = Math.max(1000, Math.min(10000, recordingDuration * 200)); // Max 10 seconds wait
                    
                    // Show processing message with estimated time
                    if (recordingDuration > 60) {
                        const waitSeconds = Math.ceil(waitTime / 1000);
                        recordingStatus.innerHTML = `<span class="recording-indicator">⏳</span> <span>Processing ${(recordingDuration / 60).toFixed(1)} min video... Please wait (~${waitSeconds}s).</span>`;
                    }
                    
                    setTimeout(async () => {
                        try {
                            // Try to get blob - for very long recordings, might need multiple attempts
                            let blob = null;
                            let attempts = 0;
                            const maxAttempts = 3;
                            
                            while (!blob && attempts < maxAttempts) {
                                try {
                                    blob = this.recorder.getBlob();
                                    if (blob && blob.size > 1024) break; // Valid blob
                                } catch (e) {
                                    console.warn(`Blob retrieval attempt ${attempts + 1} failed:`, e);
                                }
                                attempts++;
                                if (!blob && attempts < maxAttempts) {
                                    // Wait 1s between attempts
                                    await new Promise(r => setTimeout(r, 1000));
                                }
                            }
                            
                            // Validate blob size - if it's suspiciously small (< 10KB), something went wrong
                            if (!blob || blob.size < 10240) {
                                console.error('Recording failed: blob too small or invalid', blob?.size);
                                recordingStatus.innerHTML = '<span style="color:#c00;">❌</span> <span>Recording failed: File too small (' + (blob ? (blob.size / 1024).toFixed(1) + ' KB' : 'no blob') + '). Very long recordings (>1 hour) may exceed browser limits. Try splitting the audio or use a shorter file.</span>';
                                setTimeout(() => {
                                    recordingStatus.classList.add('hidden');
                                }, 8000);
                                this.recorder = null;
                                resolve();
                                return;
                            }
                            
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            // Use appropriate extension based on mime type
                            const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
                            a.download = `lip-sync-animation-${Date.now()}.${extension}`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                            
                            recordBtn.textContent = '🎥 Record MP4';
                            recordBtn.classList.remove('btn-secondary');
                            recordBtn.classList.add('btn-success');
                            recordingStatus.classList.add('hidden');
                            
                            // Restore canvas visibility if it was hidden
                            const canvasContainer = document.querySelector('.canvas-container');
                            if (canvasContainer) canvasContainer.style.display = '';
                            const backgroundProgress = document.getElementById('backgroundProgress');
                            if (backgroundProgress) backgroundProgress.classList.add('hidden');
                            
                            // Show success message briefly
                            const successMsg = document.createElement('div');
                            successMsg.className = 'recording-status';
                            successMsg.style.background = '#d4edda';
                            successMsg.style.borderColor = '#28a745';
                            successMsg.style.color = '#155724';
                            const fileSizeMB = (blob.size / (1024 * 1024)).toFixed(1);
                            successMsg.innerHTML = `<span style="font-size: 1.2em;">✅</span> <span>Video created and downloaded! (${fileSizeMB} MB)</span>`;
                            recordingStatus.parentNode.insertBefore(successMsg, recordingStatus.nextSibling);
                            setTimeout(() => successMsg.remove(), 3000);
                            
                            // Re-enable controls
                            document.getElementById('playBtn').disabled = false;
                            document.getElementById('stopBtn').disabled = true;
                            
                            this.recorder = null;
                            this.drawFrame();
                            resolve();
                        } catch (error) {
                            console.error('Error getting blob:', error);
                            recordingStatus.innerHTML = '<span style="color:#c00;">❌</span> <span>Error processing video. Try a shorter audio file or check browser console.</span>';
                            setTimeout(() => {
                                recordingStatus.classList.add('hidden');
                            }, 5000);
                            // Restore canvas visibility if it was hidden
                            const canvasContainer = document.querySelector('.canvas-container');
                            if (canvasContainer) canvasContainer.style.display = '';
                            const backgroundProgress = document.getElementById('backgroundProgress');
                            if (backgroundProgress) backgroundProgress.classList.add('hidden');
                            this.recorder = null;
                            resolve();
                        }
                    }, 500); // Wait 500ms for blob to be fully written (longer for very long recordings)
                });
            });
        }

        recordBtn.textContent = '🎥 Record MP4';
        recordBtn.classList.remove('btn-secondary');
        recordBtn.classList.add('btn-success');
        recordingStatus.classList.add('hidden');
        
        // Restore canvas visibility if it was hidden
        const canvasContainer = document.querySelector('.canvas-container');
        if (canvasContainer) canvasContainer.style.display = '';
        const backgroundProgress = document.getElementById('backgroundProgress');
        if (backgroundProgress) backgroundProgress.classList.add('hidden');
        
        this.drawFrame();
    }

    async reset() {
        this.stop();
        if (this.isRecording) {
            await this.stopRecording();
        }
        this.audioFile = null;
        this.imageFile = null;
        this.image = null;
        this.audioBuffer = null;
        this.faceDetectionResult = null;
        this.selectedMouthArea = null;
        this.selectedLeftEyeArea = null;
        this.selectedRightEyeArea = null;
        this.selectionStep = 'mouth';
        this.isSelecting = false;
        
        document.getElementById('audioFileName').textContent = '';
        document.getElementById('imageFileName').textContent = '';
        document.getElementById('audioFile').value = '';
        document.getElementById('imageFile').value = '';
        document.getElementById('recordingStatus').classList.add('hidden');
        document.getElementById('selectionMode').classList.add('hidden');
        document.getElementById('selectionCanvas').classList.add('hidden');
        document.getElementById('continueBtn').disabled = true;
        document.getElementById('skipPreviewCheckbox').checked = false;
        this.skipPreview = false;
        
        // Restore canvas visibility
        const canvasContainer = document.querySelector('.canvas-container');
        if (canvasContainer) canvasContainer.style.display = '';
        const backgroundProgress = document.getElementById('backgroundProgress');
        if (backgroundProgress) backgroundProgress.classList.add('hidden');
        
        this.selectionCtx.clearRect(0, 0, this.selectionCanvas.width, this.selectionCanvas.height);
        await this.checkReady();
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    animate() {
        if (!this.isPlaying) return;

        const now = performance.now();
        const dt = this.lastBlinkFrameTime ? now - this.lastBlinkFrameTime : 0;
        this.lastBlinkFrameTime = now;

        // --- Audio analysis (for mouth + sentence-end heuristics) ---
        const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
        this.analyserNode.getByteFrequencyData(dataArray);

        const speechStart = Math.floor(dataArray.length * 0.1);
        const speechEnd = Math.floor(dataArray.length * 0.6);
        let sum = 0;
        for (let i = speechStart; i < speechEnd; i++) {
            sum += dataArray[i];
        }
        const avgAmplitude = sum / (speechEnd - speechStart);
        const normalizedAmplitude = Math.min(avgAmplitude / 255, 1);
        const mouthOpening = Math.pow(normalizedAmplitude * this.mouthSensitivity, 0.7);
        const clampedOpening = Math.min(mouthOpening, 1);

        // Track simple \"speech active\" state to detect ends of phrases
        const wasSpeechActive = this.speechActive;
        const speechThreshold = 0.35;
        this.speechActive = clampedOpening > speechThreshold;
        if (wasSpeechActive && !this.speechActive) {
            this.lastSpeechEndTime = now;
            // Occasionally force a blink soon after speech ends (\"sentence\"-like)
            if (this.blinkPhase === 'idle' &&
                this.selectedLeftEyeArea && this.selectedRightEyeArea &&
                Math.random() < 0.6) {
                this.nextBlinkTime = now + 120 + Math.random() * 220; // ~0.12–0.34s after phrase end
            }
        }

        // --- Blink update: ~20/min + sentence-synced + occasional double blinks ---
        if (this.blinkPhase === 'closing') {
            this.blinkProgress = Math.min(1, this.blinkProgress + dt / this.BLINK_DURATION_MS);
            if (this.blinkProgress >= 1) this.blinkPhase = 'opening';
        } else if (this.blinkPhase === 'opening') {
            this.blinkProgress = Math.max(0, this.blinkProgress - dt / this.BLINK_DURATION_MS);
            if (this.blinkProgress <= 0) {
                // Blink completed
                if (this.isDoubleBlink) {
                    // This was the first blink of a double - start second blink after short delay
                    this.nextBlinkTime = now + this.doubleBlinkDelay;
                    this.blinkPhase = 'idle'; // Brief pause before second blink
                    this.isDoubleBlink = false; // Second blink will complete normally
                } else {
                    // Normal single blink completed - schedule next blink
                    this.blinkPhase = 'idle';
                    const range = this.MAX_BLINK_INTERVAL_MS - this.MIN_BLINK_INTERVAL_MS;
                    this.nextBlinkTime = now + this.MIN_BLINK_INTERVAL_MS + Math.random() * range;
                }
            }
        } else if (this.selectedLeftEyeArea && this.selectedRightEyeArea && now >= this.nextBlinkTime) {
            // Starting a new blink - 12% chance it's a double blink
            this.blinkPhase = 'closing';
            this.blinkProgress = 0;
            if (Math.random() < 0.12) {
                this.isDoubleBlink = true; // Mark this blink sequence as a double blink
            }
        }

        // Update progress bar if skipping preview
        if (this.skipPreview && this.isRecording && this.audioDuration) {
            const elapsed = this.audioContext.currentTime - this.startTime;
            const progress = Math.min(100, (elapsed / this.audioDuration) * 100);
            const progressBarFill = document.getElementById('progressBarFill');
            const progressText = document.getElementById('progressText');
            if (progressBarFill && progressText) {
                progressBarFill.style.width = progress + '%';
                progressText.textContent = Math.round(progress) + '%';
            }
        }

        this.drawFrame(clampedOpening);
        this.animationFrameId = requestAnimationFrame(() => this.animate());
    }

    drawFrame(mouthOpening = 0) {
        if (!this.image) return;

        const ctx = this.ctx;
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;

        // Clear canvas
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        // Calculate image dimensions to fit canvas while maintaining aspect ratio
        const imageAspect = this.image.width / this.image.height;
        const canvasAspect = canvasWidth / canvasHeight;
        
        let drawWidth, drawHeight, offsetX, offsetY;
        
        if (imageAspect > canvasAspect) {
            drawWidth = canvasWidth;
            drawHeight = canvasWidth / imageAspect;
            offsetX = 0;
            offsetY = (canvasHeight - drawHeight) / 2;
        } else {
            drawWidth = canvasHeight * imageAspect;
            drawHeight = canvasHeight;
            offsetX = (canvasWidth - drawWidth) / 2;
            offsetY = 0;
        }

        // Draw image
        ctx.drawImage(this.image, offsetX, offsetY, drawWidth, drawHeight);

        // Update mouth position if needed
        this.calculateMouthPosition();

        // Draw animated mouth
        if (this.selectedMouthArea) {
            this.drawMouthWithImage(mouthOpening, offsetX, offsetY, drawWidth, drawHeight);
        } else if (mouthOpening > 0.05) {
            this.drawMouth(mouthOpening);
        }

        // Draw eyes with blink (both eyes, random 5–15 sec)
        if (this.selectedLeftEyeArea && this.selectedRightEyeArea) {
            this.drawEyesWithImage(offsetX, offsetY, drawWidth, drawHeight);
        }
    }

    getEyePosition(area) {
        if (!area) return null;
        const x = area.x * this.canvas.width;
        const y = area.y * this.canvas.height;
        const w = area.width * this.canvas.width;
        const h = area.height * this.canvas.height;
        return { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 };
    }

    drawEyesWithImage(offsetX, offsetY, drawWidth, drawHeight) {
        const ctx = this.ctx;
        const left = this.getEyePosition(this.selectedLeftEyeArea);
        const right = this.getEyePosition(this.selectedRightEyeArea);
        if (!left || !right) return;
        // blinkProgress 0 = open, 1 = closed. Scale Y: 1 → 0.05
        const scaleY = 1 - this.blinkProgress * 0.95;
        for (const eye of [left, right]) {
            ctx.save();
            ctx.beginPath();
            ctx.ellipse(eye.cx, eye.cy, eye.rx, eye.ry, 0, 0, Math.PI * 2);
            ctx.clip();
            ctx.translate(eye.cx, eye.cy);
            ctx.scale(1, scaleY);
            ctx.translate(-eye.cx, -eye.cy);
            ctx.drawImage(this.image, 0, 0, this.image.width, this.image.height, offsetX, offsetY, drawWidth, drawHeight);
            ctx.restore();
        }
    }

    drawMouthWithImage(opening, offsetX, offsetY, drawWidth, drawHeight) {
        const ctx = this.ctx;
        // Oval center and radii from selected area (canvas coords)
        const cx = this.mouthPosition.x;
        const cy = this.mouthPosition.y;
        const rx = this.mouthPosition.width / 2;
        const ry = this.mouthPosition.height / 2;

        ctx.save();

        // Clip to the mouth oval
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.clip();

        // Scale vertically around mouth center to simulate opening (1 = closed, up to ~1.6 = wide)
        const scaleY = 1 + opening * 0.6;
        ctx.translate(cx, cy);
        ctx.scale(1, scaleY);
        ctx.translate(-cx, -cy);

        // Redraw the image in the clipped region (shows actual image pixels, stretched)
        ctx.drawImage(this.image, 0, 0, this.image.width, this.image.height, offsetX, offsetY, drawWidth, drawHeight);

        ctx.restore();
    }

    drawMouth(opening) {
        const ctx = this.ctx;
        const { x, y, width, height } = this.mouthPosition;

        ctx.save();
        
        // Determine mouth shape based on opening level
        let mouthShape;
        if (opening < 0.2) {
            mouthShape = 'closed';
        } else if (opening < 0.4) {
            mouthShape = 'slightly-open';
        } else if (opening < 0.7) {
            mouthShape = 'open';
        } else {
            mouthShape = 'wide-open';
        }

        // Draw mouth based on shape
        ctx.fillStyle = '#000';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;

        switch (mouthShape) {
            case 'closed':
                ctx.beginPath();
                ctx.ellipse(x, y, width * 0.8, height * 0.2, 0, 0, Math.PI * 2);
                ctx.stroke();
                break;

            case 'slightly-open':
                ctx.beginPath();
                ctx.ellipse(x, y, width * 0.7, height * 0.4 * opening, 0, 0, Math.PI * 2);
                ctx.fill();
                break;

            case 'open':
                ctx.beginPath();
                ctx.ellipse(x, y, width * 0.8, height * 0.6 * opening, 0, 0, Math.PI * 2);
                ctx.fill();
                break;

            case 'wide-open':
                ctx.beginPath();
                ctx.ellipse(x, y, width * 0.9, height * 0.9 * opening, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#ff6b6b';
                ctx.beginPath();
                ctx.ellipse(x, y + height * 0.2 * opening, width * 0.5, height * 0.3 * opening, 0, 0, Math.PI * 2);
                ctx.fill();
                break;
        }

        ctx.restore();
    }
}

// Theme toggle: dark/light mode with localStorage persistence
function initThemeToggle() {
    const toggle = document.getElementById('themeToggle');
    const saved = localStorage.getItem('theme');
    if (saved === 'light') document.body.setAttribute('data-theme', 'light');
    if (toggle) {
        toggle.addEventListener('click', () => {
            const isLight = document.body.getAttribute('data-theme') === 'light';
            if (isLight) {
                document.body.removeAttribute('data-theme');
                localStorage.setItem('theme', 'dark');
            } else {
                document.body.setAttribute('data-theme', 'light');
                localStorage.setItem('theme', 'light');
            }
        });
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initThemeToggle();
    new LipSyncAnimator();
});
