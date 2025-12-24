import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Mic, X, Loader2, Send, Keyboard, Square, Wand2 } from "lucide-react";
import { motion } from "framer-motion";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// ============================================
// VU Meter Ring Component - Apple-like minimal design
// ============================================
function VUMeterRing({ level = 0, isRecording = false, size = 160 }) {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const currentLevelRef = useRef(0);
  const glowLevelRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    
    // Set canvas size with device pixel ratio for crisp rendering
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const centerX = size / 2;
    const centerY = size / 2;
    const baseRadius = size / 2 - 20;

    const draw = () => {
      // Smooth interpolation towards target level
      const targetLevel = isRecording ? level : 0;
      currentLevelRef.current += (targetLevel - currentLevelRef.current) * 0.12;
      
      // Glow follows with more decay (slower to fade)
      glowLevelRef.current += (currentLevelRef.current - glowLevelRef.current) * 0.08;

      const currentLevel = currentLevelRef.current;
      const glowLevel = glowLevelRef.current;

      ctx.clearRect(0, 0, size, size);

      // === Outer glow layer (softest, largest) ===
      if (isRecording && glowLevel > 0.01) {
        const outerGlowRadius = baseRadius + 8 + glowLevel * 12;
        const outerGlow = ctx.createRadialGradient(
          centerX, centerY, baseRadius - 5,
          centerX, centerY, outerGlowRadius + 15
        );
        outerGlow.addColorStop(0, `rgba(244, 63, 94, 0)`);
        outerGlow.addColorStop(0.4, `rgba(244, 63, 94, ${glowLevel * 0.15})`);
        outerGlow.addColorStop(0.7, `rgba(244, 63, 94, ${glowLevel * 0.08})`);
        outerGlow.addColorStop(1, `rgba(244, 63, 94, 0)`);
        
        ctx.beginPath();
        ctx.arc(centerX, centerY, outerGlowRadius + 15, 0, Math.PI * 2);
        ctx.fillStyle = outerGlow;
        ctx.fill();
      }

      // === Main ring ===
      const ringThickness = 3 + currentLevel * 4;
      const ringRadius = baseRadius + currentLevel * 6;
      const ringAlpha = isRecording ? (0.3 + currentLevel * 0.7) : 0.15;

      // Ring glow (blur effect)
      if (isRecording && currentLevel > 0.05) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(244, 63, 94, ${currentLevel * 0.4})`;
        ctx.lineWidth = ringThickness + 8;
        ctx.lineCap = "round";
        ctx.filter = "blur(6px)";
        ctx.stroke();
        ctx.filter = "none";
      }

      // Main ring stroke
      ctx.beginPath();
      ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
      ctx.strokeStyle = isRecording 
        ? `rgba(244, 63, 94, ${ringAlpha})` 
        : `rgba(148, 163, 184, 0.2)`;
      ctx.lineWidth = ringThickness;
      ctx.lineCap = "round";
      ctx.stroke();

      // === Inner subtle ring (idle indicator) ===
      if (!isRecording || currentLevel < 0.1) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, baseRadius - 2, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(148, 163, 184, ${0.1 - currentLevel * 0.1})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [level, isRecording, size]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      className="absolute inset-0 pointer-events-none"
    />
  );
}

// ============================================
// Audio Level Hook - Real mic input via Web Audio API
// ============================================
function useAudioLevel(stream, isRecording) {
  const [level, setLevel] = useState(0);
  const analyserRef = useRef(null);
  const audioContextRef = useRef(null);
  const animationRef = useRef(null);

  useEffect(() => {
    if (!stream || !isRecording) {
      setLevel(0);
      return;
    }

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);

    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const updateLevel = () => {
      analyser.getByteTimeDomainData(dataArray);

      // Calculate RMS (root mean square) for accurate loudness
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const val = (dataArray[i] - 128) / 128;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      
      // Map RMS to 0-1 range with some boost for sensitivity
      const normalizedLevel = Math.min(1, rms * 2.5);
      setLevel(normalizedLevel);

      animationRef.current = requestAnimationFrame(updateLevel);
    };

    updateLevel();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [stream, isRecording]);

  return level;
}

// ============================================
// Main Voice Overlay Component
// ============================================
export default function VoiceOverlay({ onClose, onProcess, isLoading }) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState(null);
  const [useTextInput, setUseTextInput] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [useWhisper, setUseWhisper] = useState(false);
  const [audioStream, setAudioStream] = useState(null);
  
  // Demo mode state
  const [demoMode, setDemoMode] = useState(false);
  const [demoLevel, setDemoLevel] = useState(0);
  
  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const streamRef = useRef(null);

  // Get real audio level from mic
  const realAudioLevel = useAudioLevel(audioStream, isRecording);
  
  // Use demo level when in demo mode, otherwise use real audio level
  const audioLevel = demoMode ? demoLevel : realAudioLevel;

  // Initialize browser speech recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (event) => {
        let interim = "";
        let final = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            final += result[0].transcript + " ";
          } else {
            interim += result[0].transcript;
          }
        }

        if (final) {
          setTranscript((prev) => prev + final);
        }
        setInterimTranscript(interim);
      };

      recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        if (event.error === "network" || event.error === "not-allowed") {
          setUseWhisper(true);
        }
      };

      recognition.onend = () => {
        if (isRecording && recognitionRef.current && !useWhisper) {
          try {
            recognitionRef.current.start();
          } catch (e) {}
        }
      };

      recognitionRef.current = recognition;
    } else {
      setUseWhisper(true);
    }

    return () => {
      cleanup();
    };
  }, []);

  const cleanup = () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    setAudioStream(null);
  };

  const startRecording = async () => {
    setError(null);
    setInterimTranscript("");
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setAudioStream(stream);

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      });
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(1000);

      if (recognitionRef.current && !useWhisper) {
        try {
          recognitionRef.current.start();
        } catch (e) {
          setUseWhisper(true);
        }
      }

      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);

    } catch (err) {
      console.error("Microphone error:", err);
      if (err.name === "NotAllowedError") {
        setError("Microphone access denied. Please use text input or demo mode.");
        setDemoMode(true);
      } else {
        setError(`Could not access microphone: ${err.message}`);
      }
    }
  };

  const stopRecording = async () => {
    setIsRecording(false);

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      
      await new Promise(resolve => {
        mediaRecorderRef.current.onstop = resolve;
      });

      const currentTranscript = transcript + interimTranscript;
      if (!currentTranscript.trim() || useWhisper) {
        await transcribeWithWhisper();
      }
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    setAudioStream(null);
    setInterimTranscript("");
  };

  const transcribeWithWhisper = async () => {
    if (audioChunksRef.current.length === 0) return;

    setIsTranscribing(true);
    setError(null);

    try {
      const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
      const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
      
      const formData = new FormData();
      const extension = mimeType.includes('webm') ? 'webm' : 'mp4';
      formData.append('audio', audioBlob, `recording.${extension}`);
      
      const response = await axios.post(`${API}/transcribe`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      
      if (response.data.success && response.data.transcript) {
        setTranscript(prev => {
          const existing = prev.trim();
          const newText = response.data.transcript.trim();
          return existing ? `${existing} ${newText}` : newText;
        });
      }
    } catch (err) {
      console.error("Whisper error:", err);
      setError("Transcription failed. You can edit the text manually.");
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleSubmit = async () => {
    const finalTranscript = transcript.trim();
    if (!finalTranscript) return;

    try {
      if (isRecording) {
        await stopRecording();
      }
      await onProcess(finalTranscript);
      onClose();
    } catch (e) {
      setError("Failed to process tasks. Please try again.");
    }
  };

  const handleClear = () => {
    setTranscript("");
    setInterimTranscript("");
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Demo mode: start "recording" simulation
  const startDemoRecording = () => {
    setIsRecording(true);
    setRecordingTime(0);
    timerRef.current = setInterval(() => {
      setRecordingTime((prev) => prev + 1);
    }, 1000);
  };

  const stopDemoRecording = () => {
    setIsRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const fullTranscript = transcript + interimTranscript;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="voice-overlay flex flex-col items-center justify-center"
      data-testid="voice-overlay"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-primary/5" />

      <Button
        variant="ghost"
        size="icon"
        className="absolute top-6 right-6 z-10 text-muted-foreground hover:text-foreground"
        onClick={() => { cleanup(); onClose(); }}
        data-testid="close-voice-overlay"
      >
        <X className="w-6 h-6" />
      </Button>

      <div className="relative z-10 flex flex-col items-center max-w-2xl w-full px-6">
        {!isLoading && !isTranscribing && (
          <div className="flex gap-2 mb-8">
            <Button
              variant={!useTextInput ? "default" : "outline"}
              size="sm"
              onClick={() => setUseTextInput(false)}
              className="gap-2"
              data-testid="voice-mode-btn"
            >
              <Mic className="w-4 h-4" />
              Voice
            </Button>
            <Button
              variant={useTextInput ? "default" : "outline"}
              size="sm"
              onClick={() => {
                cleanup();
                setUseTextInput(true);
                setIsRecording(false);
              }}
              className="gap-2"
              data-testid="text-mode-btn"
            >
              <Keyboard className="w-4 h-4" />
              Type
            </Button>
          </div>
        )}

        {useTextInput ? (
          <div className="w-full mb-6">
            <Textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Type your tasks here... e.g., 'Call the dentist tomorrow, urgent. Buy groceries this weekend.'"
              className="min-h-[180px] bg-card/50 backdrop-blur-xl border-border/30 text-lg resize-none"
              data-testid="text-input"
            />
          </div>
        ) : (
          <>
            {/* VU Meter + Record Button Container */}
            <div className="relative mb-8 flex items-center justify-center" style={{ width: 160, height: 160 }}>
              {/* VU Meter Ring */}
              <VUMeterRing 
                level={audioLevel} 
                isRecording={isRecording} 
                size={160}
              />
              
              {/* Pulse animation when recording (fallback visual) */}
              {isRecording && (
                <motion.div
                  className="absolute inset-0 rounded-full border border-rose-500/20"
                  initial={{ scale: 1, opacity: 0.3 }}
                  animate={{ scale: 1.4, opacity: 0 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
                  style={{ width: 160, height: 160 }}
                />
              )}

              {/* Record Button */}
              <motion.button
                onClick={() => {
                  if (demoMode) {
                    isRecording ? stopDemoRecording() : startDemoRecording();
                  } else {
                    isRecording ? stopRecording() : startRecording();
                  }
                }}
                disabled={isLoading || isTranscribing}
                className={`relative w-28 h-28 rounded-full flex flex-col items-center justify-center transition-all z-10 ${
                  isRecording
                    ? "bg-rose-500 shadow-[0_0_40px_rgba(244,63,94,0.4)]"
                    : isTranscribing
                    ? "bg-card border-2 border-primary/50"
                    : "bg-card border-2 border-border/50 hover:border-primary/50 hover:bg-card/80"
                }`}
                whileHover={!isRecording && !isTranscribing ? { scale: 1.03 } : {}}
                whileTap={{ scale: 0.97 }}
                data-testid="voice-orb"
              >
                {isLoading ? (
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                ) : isTranscribing ? (
                  <>
                    <Wand2 className="w-7 h-7 text-primary animate-pulse" />
                    <span className="text-primary text-xs mt-1.5">Transcribing...</span>
                  </>
                ) : isRecording ? (
                  <>
                    <Square className="w-6 h-6 text-white fill-white" />
                    <span className="text-white text-sm mt-1.5 font-mono">{formatTime(recordingTime)}</span>
                  </>
                ) : (
                  <Mic className="w-8 h-8 text-muted-foreground" />
                )}
              </motion.button>
            </div>

            {/* Demo Mode Controls */}
            {demoMode && (
              <div className="w-full max-w-xs mb-6 p-4 bg-card/50 rounded-xl border border-border/30">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-muted-foreground font-medium">Demo Mode</span>
                  <span className="text-xs text-primary font-mono">{(demoLevel * 100).toFixed(0)}%</span>
                </div>
                <Slider
                  value={[demoLevel]}
                  onValueChange={(value) => setDemoLevel(value[0])}
                  min={0}
                  max={1}
                  step={0.01}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground mt-2 text-center">
                  Drag slider to simulate audio level
                </p>
              </div>
            )}

            {/* Toggle Demo Mode */}
            <button
              onClick={() => setDemoMode(!demoMode)}
              className="text-xs text-muted-foreground hover:text-primary mb-4 transition-colors"
            >
              {demoMode ? "Exit Demo Mode" : "Test with Demo Mode"}
            </button>

            <p className="text-lg mb-4 text-center">
              {isLoading ? (
                <span className="text-primary">Processing your tasks...</span>
              ) : isTranscribing ? (
                <span className="text-primary">Transcribing with AI...</span>
              ) : isRecording ? (
                <span className="text-rose-400">Recording... Tap to stop</span>
              ) : (
                <span className="text-muted-foreground">Tap to start recording</span>
              )}
            </p>

            {useWhisper && !isRecording && !isTranscribing && !demoMode && (
              <p className="text-xs text-muted-foreground mb-4">
                Using Whisper AI for transcription
              </p>
            )}

            {error && (
              <p className="text-amber-500 text-sm mb-4 text-center">{error}</p>
            )}

            <div className="w-full mb-6">
              <Textarea
                value={fullTranscript}
                onChange={(e) => {
                  setTranscript(e.target.value);
                  setInterimTranscript("");
                }}
                placeholder={isRecording ? "Speak now... transcript will appear here" : "Your transcribed text will appear here..."}
                className="min-h-[120px] bg-card/50 backdrop-blur-xl border-border/30 text-lg resize-none"
                data-testid="transcript-textarea"
              />
            </div>
          </>
        )}

        <div className="flex gap-4">
          <Button
            variant="outline"
            onClick={handleClear}
            disabled={!fullTranscript || isLoading || isTranscribing}
            data-testid="clear-transcript"
          >
            Clear
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!fullTranscript.trim() || isLoading || isTranscribing || isRecording}
            className="gap-2 px-8"
            data-testid="submit-voice"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            Process Tasks
          </Button>
        </div>

        <p className="mt-8 text-sm text-muted-foreground text-center max-w-md">
          {useTextInput 
            ? "Tip: Mention urgency and importance. Example: \"Call dentist urgently, very important\""
            : "Tip: Record your tasks, then stop to transcribe. You can edit the text before processing."
          }
        </p>
      </div>
    </motion.div>
  );
}
