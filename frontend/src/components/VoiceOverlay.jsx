import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, X, Loader2, Send, Keyboard, Square, Wand2 } from "lucide-react";
import { motion } from "framer-motion";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Audio Visualizer Component - VU meter style bars
function AudioVisualizer({ stream, isRecording }) {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const analyserRef = useRef(null);
  const prevLevelsRef = useRef([]);

  useEffect(() => {
    if (!stream || !isRecording) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      return;
    }

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    analyserRef.current = analyser;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    // Initialize previous levels for smoothing
    const numBars = 24;
    prevLevelsRef.current = new Array(numBars).fill(0);

    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext("2d");
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const innerRadius = 74;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Calculate RMS volume
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const val = (dataArray[i] - 128) / 128;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / bufferLength);
      const volume = Math.min(1, rms * 3);

      // Draw evenly spaced bars around the circle
      const barWidth = 3;
      const maxBarHeight = 20;
      const gapAngle = (Math.PI * 2) / numBars;

      for (let i = 0; i < numBars; i++) {
        const angle = i * gapAngle - Math.PI / 2;
        
        // Create variation based on position and volume
        const variation = Math.sin(i * 0.5 + Date.now() * 0.003) * 0.3 + 0.7;
        const targetHeight = volume * maxBarHeight * variation;
        
        // Smooth the bar height
        prevLevelsRef.current[i] += (targetHeight - prevLevelsRef.current[i]) * 0.3;
        const barHeight = Math.max(4, prevLevelsRef.current[i]);
        
        const x1 = centerX + Math.cos(angle) * (innerRadius + 4);
        const y1 = centerY + Math.sin(angle) * (innerRadius + 4);
        const x2 = centerX + Math.cos(angle) * (innerRadius + 4 + barHeight);
        const y2 = centerY + Math.sin(angle) * (innerRadius + 4 + barHeight);

        // Color based on volume level
        const intensity = barHeight / maxBarHeight;
        const alpha = 0.5 + intensity * 0.5;
        
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = `rgba(244, 63, 94, ${alpha})`;
        ctx.lineWidth = barWidth;
        ctx.lineCap = "round";
        ctx.stroke();
      }

      // Soft glow behind bars
      const gradient = ctx.createRadialGradient(
        centerX, centerY, innerRadius,
        centerX, centerY, innerRadius + 30 + volume * 15
      );
      gradient.addColorStop(0, "rgba(244, 63, 94, 0)");
      gradient.addColorStop(0.5, `rgba(244, 63, 94, ${volume * 0.15})`);
      gradient.addColorStop(1, "rgba(244, 63, 94, 0)");
      
      ctx.beginPath();
      ctx.arc(centerX, centerY, innerRadius + 30 + volume * 15, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      audioContext.close();
    };
  }, [stream, isRecording]);

  if (!isRecording) return null;

  return (
    <canvas
      ref={canvasRef}
      width={200}
      height={200}
      className="absolute inset-0 pointer-events-none"
      style={{ left: "-32px", top: "-32px" }}
    />
  );
}

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
  
  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const streamRef = useRef(null);

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
        setError("Microphone access denied. Please use text input.");
        setUseTextInput(true);
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
            <div className="relative mb-8">
              {/* Audio Visualizer */}
              <AudioVisualizer stream={audioStream} isRecording={isRecording} />
              
              {/* Pulse rings when recording (fallback if no audio data) */}
              {isRecording && (
                <>
                  <motion.div
                    className="absolute inset-0 w-36 h-36 rounded-full border border-rose-500/20"
                    initial={{ scale: 1, opacity: 0.4 }}
                    animate={{ scale: 1.8, opacity: 0 }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                </>
              )}

              <motion.button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isLoading || isTranscribing}
                className={`relative w-36 h-36 rounded-full flex flex-col items-center justify-center transition-all z-10 ${
                  isRecording
                    ? "bg-rose-500 shadow-[0_0_60px_rgba(244,63,94,0.5)]"
                    : isTranscribing
                    ? "bg-card border-2 border-primary/50"
                    : "bg-card border-2 border-primary/50 hover:border-primary hover:bg-card/80"
                }`}
                whileHover={!isRecording && !isTranscribing ? { scale: 1.05 } : {}}
                whileTap={{ scale: 0.95 }}
                data-testid="voice-orb"
              >
                {isLoading ? (
                  <Loader2 className="w-10 h-10 text-primary animate-spin" />
                ) : isTranscribing ? (
                  <>
                    <Wand2 className="w-8 h-8 text-primary animate-pulse" />
                    <span className="text-primary text-xs mt-2">Transcribing...</span>
                  </>
                ) : isRecording ? (
                  <>
                    <Square className="w-8 h-8 text-white fill-white" />
                    <span className="text-white text-sm mt-2 font-mono">{formatTime(recordingTime)}</span>
                  </>
                ) : (
                  <Mic className="w-10 h-10 text-primary" />
                )}
              </motion.button>
            </div>

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

            {useWhisper && !isRecording && !isTranscribing && (
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
