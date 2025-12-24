import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, MicOff, X, Loader2, Waves, Send, Keyboard } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function VoiceOverlay({ onClose, onProcess, isLoading }) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isSupported, setIsSupported] = useState(true);
  const [error, setError] = useState(null);
  const [useTextInput, setUseTextInput] = useState(false);
  const recognitionRef = useRef(null);

  useEffect(() => {
    // Check browser support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setIsSupported(false);
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
        setError("Microphone access denied. Use text input instead.");
        setUseTextInput(true);
      } else {
        setError(`Error: ${event.error}`);
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      if (isListening) {
        // Restart if still supposed to be listening
        try {
          recognition.start();
        } catch (e) {
          console.error("Failed to restart recognition", e);
        }
      }
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.stop();
    };
  }, []);

  const toggleListening = useCallback(() => {
    if (!recognitionRef.current) return;

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      setError(null);
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        console.error("Failed to start recognition", e);
        setError("Failed to start voice recognition");
      }
    }
  }, [isListening]);

  const handleSubmit = async () => {
    if (!transcript.trim()) return;

    try {
      recognitionRef.current?.stop();
      setIsListening(false);
      await onProcess(transcript.trim());
      onClose();
    } catch (e) {
      setError("Failed to process tasks. Please try again.");
    }
  };

  const handleClear = () => {
    setTranscript("");
    setInterimTranscript("");
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
        {/* Voice Orb */}
        <div className="relative mb-10">
          {/* Outer rings */}
          {isListening && (
            <>
              <motion.div
                className="absolute inset-0 w-40 h-40 rounded-full border-2 border-primary/20"
                initial={{ scale: 1, opacity: 0.5 }}
                animate={{ scale: 1.5, opacity: 0 }}
                transition={{ duration: 2, repeat: Infinity }}
              />
              <motion.div
                className="absolute inset-0 w-40 h-40 rounded-full border-2 border-secondary/30"
                initial={{ scale: 1, opacity: 0.3 }}
                animate={{ scale: 1.8, opacity: 0 }}
                transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
              />
            </>
          )}

          {/* Main orb button */}
          <motion.button
            onClick={toggleListening}
            disabled={!isSupported || isLoading}
            className={`relative w-40 h-40 rounded-full flex items-center justify-center transition-all ${
              isListening
                ? "bg-gradient-to-br from-primary to-secondary shadow-[0_0_60px_rgba(99,102,241,0.5)]"
                : "bg-card/80 hover:bg-card border border-border/50"
            }`}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            data-testid="voice-orb"
          >
            {isLoading ? (
              <Loader2 className="w-12 h-12 text-white animate-spin" />
            ) : isListening ? (
              <Waves className="w-12 h-12 text-white" />
            ) : (
              <Mic className="w-12 h-12 text-muted-foreground" />
            )}
          </motion.button>
        </div>

        {/* Status text */}
        <AnimatePresence mode="wait">
          <motion.p
            key={isListening ? "listening" : "idle"}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="text-lg mb-6 text-center"
          >
            {isLoading ? (
              <span className="text-primary">Processing your tasks...</span>
            ) : isListening ? (
              <span className="text-emerald-400">Listening... Speak your tasks</span>
            ) : isSupported ? (
              <span className="text-muted-foreground">Tap the microphone to start</span>
            ) : (
              <span className="text-destructive">Speech recognition not supported in this browser</span>
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
            {transcript}
            <span className="text-muted-foreground">{interimTranscript}</span>
            {!transcript && !interimTranscript && (
              <span className="text-muted-foreground italic">Your transcribed text will appear here...</span>
            )}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex gap-4">
          <Button
            variant="outline"
            onClick={handleClear}
            disabled={!transcript || isLoading}
            data-testid="clear-transcript"
          >
            Clear
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!transcript.trim() || isLoading}
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
          Tip: Mention urgency and importance. For example: "I need to urgently call the dentist, it's very important"
        </p>
      </div>
    </motion.div>
  );
}
