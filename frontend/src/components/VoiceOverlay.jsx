import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, MicOff, X, Loader2, Waves, Send, Keyboard, Square } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export default function VoiceOverlay({ onClose, onProcess, isLoading }) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState(null);
  const [useTextInput, setUseTextInput] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const startRecording = async () => {
    setError(null);
    audioChunksRef.current = [];
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      });
      
      mediaRecorderRef.current = mediaRecorder;
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
        
        // Clear timer
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        
        // Process the audio
        if (audioChunksRef.current.length > 0) {
          await processAudio();
        }
      };
      
      mediaRecorder.onerror = (event) => {
        console.error("MediaRecorder error:", event);
        setError("Recording failed. Please try again.");
        setIsRecording(false);
      };
      
      mediaRecorder.start(1000); // Collect data every second
      setIsRecording(true);
      setRecordingTime(0);
      
      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
      
    } catch (err) {
      console.error("Error accessing microphone:", err);
      if (err.name === "NotAllowedError") {
        setError("Microphone access denied. Please allow access or use text input.");
      } else {
        setError(`Could not access microphone: ${err.message}`);
      }
      setUseTextInput(true);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const processAudio = async () => {
    setIsTranscribing(true);
    setError(null);
    
    try {
      const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
      const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
      
      // Create form data
      const formData = new FormData();
      const extension = mimeType.includes('webm') ? 'webm' : 'mp4';
      formData.append('audio', audioBlob, `recording.${extension}`);
      
      // Send to Whisper endpoint
      const response = await axios.post(`${API}/transcribe`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      
      if (response.data.success && response.data.transcript) {
        setTranscript(prev => prev + (prev ? " " : "") + response.data.transcript);
      } else {
        setError("No speech detected. Try again.");
      }
    } catch (err) {
      console.error("Transcription error:", err);
      setError("Failed to transcribe audio. Please try again or use text input.");
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleSubmit = async () => {
    if (!transcript.trim()) return;

    try {
      await onProcess(transcript.trim());
      onClose();
    } catch (e) {
      setError("Failed to process tasks. Please try again.");
    }
  };

  const handleClear = () => {
    setTranscript("");
    audioChunksRef.current = [];
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="voice-overlay flex flex-col items-center justify-center"
      data-testid="voice-overlay"
    >
      {/* Background image with blur */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage: "url(https://images.pexels.com/photos/11912625/pexels-photo-11912625.jpeg)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(20px)",
        }}
      />

      {/* Close button */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-6 right-6 z-10 text-white/70 hover:text-white"
        onClick={onClose}
        data-testid="close-voice-overlay"
      >
        <X className="w-6 h-6" />
      </Button>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center max-w-2xl w-full px-6">
        {/* Toggle between voice and text */}
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
              Voice (Whisper AI)
            </Button>
            <Button
              variant={useTextInput ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setUseTextInput(true);
                stopRecording();
              }}
              className="gap-2"
              data-testid="text-mode-btn"
            >
              <Keyboard className="w-4 h-4" />
              Type
            </Button>
          </div>
        )}

        {/* Text Input Mode */}
        {useTextInput ? (
          <div className="w-full mb-6">
            <Textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Type your tasks here... e.g., 'I need to call the dentist tomorrow, it's urgent. Also buy groceries this weekend.'"
              className="min-h-[180px] bg-card/50 backdrop-blur-xl border-border/30 text-lg resize-none"
              data-testid="text-input"
            />
          </div>
        ) : (
          <>
            {/* Voice Orb */}
            <div className="relative mb-10">
              {/* Outer rings */}
              {isRecording && (
                <>
                  <motion.div
                    className="absolute inset-0 w-40 h-40 rounded-full border-2 border-rose-500/40"
                    initial={{ scale: 1, opacity: 0.5 }}
                    animate={{ scale: 1.5, opacity: 0 }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  />
                  <motion.div
                    className="absolute inset-0 w-40 h-40 rounded-full border-2 border-rose-500/30"
                    initial={{ scale: 1, opacity: 0.3 }}
                    animate={{ scale: 1.8, opacity: 0 }}
                    transition={{ duration: 1.5, repeat: Infinity, delay: 0.3 }}
                  />
                </>
              )}

              {/* Main orb button */}
              <motion.button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isLoading || isTranscribing}
                className={`relative w-40 h-40 rounded-full flex flex-col items-center justify-center transition-all ${
                  isRecording
                    ? "bg-gradient-to-br from-rose-500 to-rose-600 shadow-[0_0_60px_rgba(244,63,94,0.5)]"
                    : isTranscribing
                    ? "bg-card/80 border border-border/50"
                    : "bg-card/80 hover:bg-card border border-primary/50 hover:border-primary"
                }`}
                whileHover={!isRecording && !isTranscribing ? { scale: 1.05 } : {}}
                whileTap={{ scale: 0.95 }}
                data-testid="voice-orb"
              >
                {isTranscribing ? (
                  <Loader2 className="w-12 h-12 text-primary animate-spin" />
                ) : isRecording ? (
                  <>
                    <Square className="w-10 h-10 text-white fill-white" />
                    <span className="text-white text-sm mt-2 font-medium">{formatTime(recordingTime)}</span>
                  </>
                ) : (
                  <Mic className="w-12 h-12 text-primary" />
                )}
              </motion.button>
            </div>

            {/* Status text */}
            <AnimatePresence mode="wait">
              <motion.p
                key={isRecording ? "recording" : isTranscribing ? "transcribing" : "idle"}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="text-lg mb-6 text-center"
              >
                {isLoading ? (
                  <span className="text-primary">Processing your tasks...</span>
                ) : isTranscribing ? (
                  <span className="text-primary">Transcribing with Whisper AI...</span>
                ) : isRecording ? (
                  <span className="text-rose-400">Recording... Tap to stop</span>
                ) : (
                  <span className="text-muted-foreground">Tap to start recording</span>
                )}
              </motion.p>
            </AnimatePresence>

            {/* Error message */}
            {error && (
              <p className="text-destructive text-sm mb-4" data-testid="voice-error">
                {error}
              </p>
            )}

            {/* Transcript display */}
            <div className="w-full bg-card/50 backdrop-blur-xl rounded-2xl p-6 min-h-[120px] mb-6 border border-border/30">
              <p className="text-foreground">
                {transcript || (
                  <span className="text-muted-foreground italic">Your transcribed text will appear here...</span>
                )}
              </p>
            </div>
          </>
        )}

        {/* Action buttons */}
        <div className="flex gap-4">
          <Button
            variant="outline"
            onClick={handleClear}
            disabled={!transcript || isLoading || isTranscribing}
            data-testid="clear-transcript"
          >
            Clear
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!transcript.trim() || isLoading || isTranscribing}
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

        {/* Tips */}
        <p className="mt-8 text-sm text-muted-foreground text-center max-w-md">
          {useTextInput 
            ? "Tip: Mention urgency and importance. Example: \"I need to urgently call the dentist, it's very important\""
            : "Tap to record, then tap again to stop. Whisper AI will transcribe your speech."
          }
        </p>
      </div>
    </motion.div>
  );
}
