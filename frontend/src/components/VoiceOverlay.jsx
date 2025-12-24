import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, X, Loader2, Send, Keyboard, Square } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export default function VoiceOverlay({ onClose, onProcess, isLoading }) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState(null);
  const [useTextInput, setUseTextInput] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  
  const recognitionRef = useRef(null);
  const timerRef = useRef(null);

  // Initialize speech recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      setError("Speech recognition not supported. Please use text input.");
      setUseTextInput(true);
      return;
    }

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
      
      if (event.error === "not-allowed") {
        setError("Microphone access denied. Please use text input.");
        setUseTextInput(true);
      } else if (event.error === "network") {
        // Network error - continue recording, user can still see partial results
        setError("Network issue - transcription may be delayed");
      } else if (event.error !== "no-speech") {
        setError(`Error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      // Restart if still recording
      if (isRecording && recognitionRef.current) {
        try {
          recognitionRef.current.start();
        } catch (e) {
          // Already started or other error
        }
      }
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  // Handle recording state changes
  useEffect(() => {
    if (isRecording && recognitionRef.current) {
      try {
        recognitionRef.current.start();
      } catch (e) {
        // Already started
      }
    }
  }, [isRecording]);

  const startRecording = () => {
    setError(null);
    setInterimTranscript("");
    setIsRecording(true);
    setRecordingTime(0);

    // Start timer
    timerRef.current = setInterval(() => {
      setRecordingTime((prev) => prev + 1);
    }, 1000);

    // Start recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.error("Failed to start recognition:", e);
      }
    }
  };

  const stopRecording = () => {
    setIsRecording(false);
    setInterimTranscript("");

    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Stop recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
  };

  const handleSubmit = async () => {
    const finalTranscript = (transcript + interimTranscript).trim();
    if (!finalTranscript) return;

    try {
      stopRecording();
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
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-primary/5" />

      {/* Close button */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-6 right-6 z-10 text-muted-foreground hover:text-foreground"
        onClick={onClose}
        data-testid="close-voice-overlay"
      >
        <X className="w-6 h-6" />
      </Button>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center max-w-2xl w-full px-6">
        {/* Mode Toggle */}
        {!isLoading && (
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
              placeholder="Type your tasks here... e.g., 'Call the dentist tomorrow, urgent. Buy groceries this weekend.'"
              className="min-h-[180px] bg-card/50 backdrop-blur-xl border-border/30 text-lg resize-none"
              data-testid="text-input"
            />
          </div>
        ) : (
          <>
            {/* Voice Recording UI */}
            <div className="relative mb-8">
              {/* Pulse rings when recording */}
              {isRecording && (
                <>
                  <motion.div
                    className="absolute inset-0 w-36 h-36 rounded-full border-2 border-rose-500/30"
                    initial={{ scale: 1, opacity: 0.6 }}
                    animate={{ scale: 1.4, opacity: 0 }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  />
                  <motion.div
                    className="absolute inset-0 w-36 h-36 rounded-full border-2 border-rose-500/20"
                    initial={{ scale: 1, opacity: 0.4 }}
                    animate={{ scale: 1.6, opacity: 0 }}
                    transition={{ duration: 1.5, repeat: Infinity, delay: 0.3 }}
                  />
                </>
              )}

              {/* Main button */}
              <motion.button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isLoading}
                className={`relative w-36 h-36 rounded-full flex flex-col items-center justify-center transition-all ${
                  isRecording
                    ? "bg-rose-500 shadow-[0_0_40px_rgba(244,63,94,0.4)]"
                    : "bg-card border-2 border-primary/50 hover:border-primary hover:bg-card/80"
                }`}
                whileHover={!isRecording ? { scale: 1.05 } : {}}
                whileTap={{ scale: 0.95 }}
                data-testid="voice-orb"
              >
                {isLoading ? (
                  <Loader2 className="w-10 h-10 text-primary animate-spin" />
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

            {/* Status */}
            <p className="text-lg mb-6 text-center">
              {isLoading ? (
                <span className="text-primary">Processing your tasks...</span>
              ) : isRecording ? (
                <span className="text-rose-400">Listening... Tap to stop</span>
              ) : (
                <span className="text-muted-foreground">Tap to start recording</span>
              )}
            </p>

            {/* Error */}
            {error && (
              <p className="text-amber-500 text-sm mb-4 text-center">{error}</p>
            )}

            {/* Real-time Transcript */}
            <div className="w-full bg-card/50 backdrop-blur-xl rounded-2xl p-6 min-h-[140px] max-h-[200px] overflow-y-auto mb-6 border border-border/30">
              {fullTranscript ? (
                <p className="text-foreground text-lg leading-relaxed">
                  {transcript}
                  <span className="text-primary/70">{interimTranscript}</span>
                  {isRecording && (
                    <span className="inline-block w-0.5 h-5 bg-primary ml-1 animate-pulse" />
                  )}
                </p>
              ) : (
                <p className="text-muted-foreground italic">
                  {isRecording 
                    ? "Start speaking... your words will appear here in real-time"
                    : "Your transcribed text will appear here..."
                  }
                </p>
              )}
            </div>
          </>
        )}

        {/* Action buttons */}
        <div className="flex gap-4">
          <Button
            variant="outline"
            onClick={handleClear}
            disabled={!fullTranscript || isLoading}
            data-testid="clear-transcript"
          >
            Clear
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!fullTranscript.trim() || isLoading}
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

        {/* Tip */}
        <p className="mt-8 text-sm text-muted-foreground text-center max-w-md">
          {useTextInput 
            ? "Tip: Mention urgency and importance. Example: \"Call dentist urgently, very important\""
            : "Tip: Speak naturally. Mention if tasks are urgent or important for better prioritization."
          }
        </p>
      </div>
    </motion.div>
  );
}
