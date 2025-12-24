import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, X, Loader2, Send, Keyboard, Square, Wand2 } from "lucide-react";
import { motion } from "framer-motion";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export default function VoiceOverlay({ onClose, onProcess, isLoading }) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState(null);
  const [useTextInput, setUseTextInput] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [useWhisper, setUseWhisper] = useState(false);
  
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
          // Switch to Whisper mode
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
  };

  const startRecording = async () => {
    setError(null);
    setInterimTranscript("");
    audioChunksRef.current = [];

    try {
      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up media recorder for Whisper fallback
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

      // Try browser speech recognition for real-time
      if (recognitionRef.current && !useWhisper) {
        try {
          recognitionRef.current.start();
        } catch (e) {
          setUseWhisper(true);
        }
      }

      setIsRecording(true);
      setRecordingTime(0);

      // Start timer
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

    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Stop browser recognition
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
    }

    // Stop media recorder and get Whisper transcription if needed
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      
      // Wait for final data
      await new Promise(resolve => {
        mediaRecorderRef.current.onstop = resolve;
      });

      // If no transcript from browser recognition, use Whisper
      const currentTranscript = transcript + interimTranscript;
      if (!currentTranscript.trim() || useWhisper) {
        await transcribeWithWhisper();
      }
    }

    // Stop microphone
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

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
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-primary/5" />

      {/* Close button */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-6 right-6 z-10 text-muted-foreground hover:text-foreground"
        onClick={() => { cleanup(); onClose(); }}
        data-testid="close-voice-overlay"
      >
        <X className="w-6 h-6" />
      </Button>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center max-w-2xl w-full px-6">
        {/* Mode Toggle */}
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
                disabled={isLoading || isTranscribing}
                className={`relative w-36 h-36 rounded-full flex flex-col items-center justify-center transition-all ${
                  isRecording
                    ? "bg-rose-500 shadow-[0_0_40px_rgba(244,63,94,0.4)]"
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

            {/* Status */}
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

            {/* Whisper mode indicator */}
            {useWhisper && !isRecording && !isTranscribing && (
              <p className="text-xs text-muted-foreground mb-4">
                Using Whisper AI for transcription
              </p>
            )}

            {/* Error */}
            {error && (
              <p className="text-amber-500 text-sm mb-4 text-center">{error}</p>
            )}

            {/* Transcript Area */}
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

        {/* Action buttons */}
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

        {/* Tip */}
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
