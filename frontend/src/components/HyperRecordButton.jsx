import { useState, useEffect, useRef } from "react";
import { Zap, Square, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import apiClient from "@/lib/apiClient";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";

/**
 * Simple pulsing ring component for Hyper Record button
 * Pulses slowly when idle, faster and brighter when recording
 */
function PulsingRing({ isRecording, audioLevel = 0, buttonSize = 40, isPressed = false }) {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const breathePhaseRef = useRef(0);
  const timeRef = useRef(Date.now());
  const containerSize = 120; // Fixed container size for ring expansion
  
  // Smoothing refs for radius and opacity
  const smoothRadiusRef = useRef(0);
  const smoothOpacityRef = useRef(0);
  const smoothAudioLevelRef = useRef(0);
  
  // Check if we're in light mode - check dynamically in the draw function
  const checkLightMode = () => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.classList.contains('light');
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    
    const canvasSize = containerSize;
    canvas.width = canvasSize * dpr;
    canvas.height = canvasSize * dpr;
    ctx.scale(dpr, dpr);

    const centerX = canvasSize / 2;
    const centerY = canvasSize / 2;
    const baseRadius = buttonSize / 2 + 5; // Ring starts just outside button
    const maxRadius = (canvasSize / 2) - 5;

    const draw = () => {
      const now = Date.now();
      const deltaTime = Math.min((now - timeRef.current) / 1000, 0.033); // Cap at ~30fps max delta
      timeRef.current = now;

      // Smooth audio level changes
      const targetAudioLevel = isRecording ? audioLevel : 0;
      const audioSmoothing = 0.15; // Slower smoothing for audio
      smoothAudioLevelRef.current += (targetAudioLevel - smoothAudioLevelRef.current) * audioSmoothing;

      // Breathing animation - slow when idle, faster when recording, very fast when pressed
      // Use smoother easing with cubic ease-in-out approximation
      const breatheSpeed = isPressed ? 5.0 : (isRecording ? 3.0 : 1.5);
      breathePhaseRef.current += deltaTime * breatheSpeed;
      
      // Use smoother sine wave with easing
      const rawBreathe = Math.sin(breathePhaseRef.current);
      // Apply smooth easing function for more natural pulse
      const easedBreathe = rawBreathe < 0 
        ? -Math.pow(-rawBreathe, 0.7) 
        : Math.pow(rawBreathe, 0.7);
      const breathe = easedBreathe * 0.5 + 0.5; // 0 to 1

      // Audio level affects expansion when recording
      const audioExpansion = smoothAudioLevelRef.current * 20;
      // Larger expansion when pressed for dramatic pulse
      const breatheExpansion = isPressed 
        ? breathe * 8  // Moderate pulse when pressed
        : (breathe * (isRecording ? 8 : 4));
      
      const targetRadiusExpansion = breatheExpansion + audioExpansion;
      const targetRingRadius = Math.min(baseRadius + targetRadiusExpansion, maxRadius);

      // Smooth radius changes - faster when expanding, slower when contracting
      const radiusSmoothing = targetRingRadius > smoothRadiusRef.current ? 0.25 : 0.12;
      smoothRadiusRef.current += (targetRingRadius - smoothRadiusRef.current) * radiusSmoothing;
      const ringRadius = smoothRadiusRef.current;

      // Opacity - brighter when recording, very bright when pressed
      const baseOpacity = isPressed ? 0.9 : (isRecording ? 0.4 : 0.15);
      const breatheOpacity = isPressed 
        ? breathe * 0.4  // Strong pulse when pressed
        : (breathe * (isRecording ? 0.3 : 0.15));
      const targetAlpha = Math.min(1, baseOpacity + breatheOpacity);

      // Smooth opacity changes
      const opacitySmoothing = 0.2;
      smoothOpacityRef.current += (targetAlpha - smoothOpacityRef.current) * opacitySmoothing;
      const ringAlpha = smoothOpacityRef.current;

      ctx.clearRect(0, 0, canvasSize, canvasSize);

      // Outer glow - only render if visible, much brighter when pressed
      if (ringAlpha > 0.01) {
        const glowRadius = isPressed ? ringRadius + 12 : ringRadius + 10;
        const glow = ctx.createRadialGradient(
          centerX, centerY, baseRadius,
          centerX, centerY, glowRadius
        );
        // Much brighter glow when pressed
        const glowAlpha = isPressed ? ringAlpha * 1.2 : ringAlpha * 0.6;
        // Use purple in light mode, red in dark mode
        const isLight = checkLightMode();
        const glowColor = isLight ? '147, 51, 234' : (isPressed ? '147, 51, 234' : '244, 63, 94'); // purple-600 in light mode, purple when pressed in dark, rose-500 otherwise
        glow.addColorStop(0, `rgba(${glowColor}, 0)`);
        glow.addColorStop(0.5, `rgba(${glowColor}, ${Math.min(1, glowAlpha)})`);
        glow.addColorStop(1, `rgba(${glowColor}, 0)`);
        
        ctx.beginPath();
        ctx.arc(centerX, centerY, glowRadius, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();
      }

      // Main ring - only render if visible
      if (ringAlpha > 0.01 && ringRadius > baseRadius) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
        // Thicker ring when pressed
        const ringThickness = isPressed 
          ? 4 + breathe * 2  // Thicker and pulsing when pressed
          : (isRecording ? 2 + smoothAudioLevelRef.current * 2 : 2);
        // Use purple in light mode, red in dark mode
        const isLight = checkLightMode();
        const ringColor = isLight ? '147, 51, 234' : (isPressed ? '147, 51, 234' : '244, 63, 94'); // purple-600 in light mode, purple when pressed in dark, rose-500 otherwise
        ctx.strokeStyle = `rgba(${ringColor}, ${ringAlpha})`;
        ctx.lineWidth = ringThickness;
        ctx.lineCap = "round";
        // Add glow effect when pressed
        if (isPressed) {
          ctx.shadowBlur = 10;
          ctx.shadowColor = `rgba(${ringColor}, ${ringAlpha * 0.8})`;
        }
        ctx.stroke();
        ctx.shadowBlur = 0; // Reset shadow
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isRecording, audioLevel, buttonSize, containerSize, isPressed]);

  return (
    <canvas
      ref={canvasRef}
      style={{ 
        width: containerSize, 
        height: containerSize,
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
      }}
    />
  );
}

/**
 * Hyper Record Button - One-click recording and automatic processing
 * Records audio, transcribes, creates dump with auto-extracted tasks - all in background
 */
export default function HyperRecordButton({ onDumpCreated }) {
  const {
    isRecording,
    recordingTime,
    error,
    audioLevel,
    startRecording,
    stopRecording,
    cleanup,
  } = useAudioRecorder();

  const [isProcessing, setIsProcessing] = useState(false);
  const [isClicked, setIsClicked] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleClick = async () => {
    if (isProcessing) {
      return; // Ignore clicks during processing
    }

    // Trigger lightning flash animation and ring pulse
    if (!isRecording) {
      setIsClicked(true);
      setTimeout(() => setIsClicked(false), 600); // Extended duration for visible pulse
    }

    if (isRecording) {
      // Stop recording and process
      try {
        setIsProcessing(true);
        const audioBlob = await stopRecording();

        if (!audioBlob || audioBlob.size === 0) {
          toast.error("No audio recorded. Please try again.");
          setIsProcessing(false);
          return;
        }

        // Transcribe audio
        const formData = new FormData();
        const mimeType = audioBlob.type || 'audio/webm';
        const extension = mimeType.includes('webm') ? 'webm' : 'mp4';
        formData.append('audio', audioBlob, `recording.${extension}`);

        toast.loading("Transcribing audio...", { id: "transcribe" });

        const transcribeResponse = await apiClient.post('/transcribe', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 300000, // 5 minutes
        });

        if (!transcribeResponse.data.success || !transcribeResponse.data.transcript) {
          toast.error("Transcription failed. Please try again.", { id: "transcribe" });
          setIsProcessing(false);
          return;
        }

        const transcript = transcribeResponse.data.transcript.trim();

        if (!transcript) {
          toast.error("No transcript generated. Please try again.", { id: "transcribe" });
          setIsProcessing(false);
          return;
        }

        toast.loading("Creating dump and extracting tasks...", { id: "transcribe" });

        // Create dump with auto-extract
        const dumpResponse = await apiClient.post('/dumps?auto_extract=1', {
          source: 'voice',
          raw_text: transcript,
          transcript: null,
        });

        toast.dismiss("transcribe");
        toast.success("Dump saved", { duration: 2000 });

        // Refresh dumps list if callback provided
        if (onDumpCreated) {
          onDumpCreated();
        }

        setIsProcessing(false);
      } catch (err) {
        console.error("Hyper Record error:", err);
        toast.dismiss("transcribe");
        
        let errorMessage = "Failed to process recording";
        
        if (err.response) {
          const status = err.response.status;
          const detail = err.response.data?.detail || err.response.data?.message || '';
          
          if (status === 429 || detail.includes("QUOTA_EXCEEDED")) {
            errorMessage = "API quota exceeded. Please add credits to your OpenAI account.";
          } else if (status === 401) {
            errorMessage = "Please sign in to continue.";
          } else if (detail) {
            errorMessage = detail;
          } else {
            errorMessage = `Error: HTTP ${status}`;
          }
        } else if (err.request) {
          if (err.code === 'ECONNREFUSED' || err.code === 'ERR_NETWORK') {
            errorMessage = "Cannot reach server. Check your connection.";
          } else if (err.code === 'ECONNABORTED') {
            errorMessage = "Request timed out. Please try again.";
          } else {
            errorMessage = err.message || "Network error";
          }
        } else {
          errorMessage = err.message || "Unknown error";
        }

        toast.error(errorMessage, { duration: 5000 });
        setIsProcessing(false);
        cleanup();
      }
    } else {
      // Start recording
      try {
        await startRecording();
      } catch (err) {
        // Error already handled in startRecording, just reset state
        cleanup();
      }
    }
  };

  // Show error toast if error state changes (only once)
  useEffect(() => {
    if (error && !isRecording && !isProcessing) {
      toast.error(error, { duration: 5000 });
    }
  }, [error, isRecording, isProcessing]);

  const buttonSize = 40; // h-10 w-10 = 40px
  const containerSize = 120; // Container for ring expansion

  return (
    <div className="relative inline-block" style={{ width: containerSize, height: containerSize }}>
      {/* Pulsing Ring - centered behind button */}
      <PulsingRing 
        isRecording={isRecording} 
        audioLevel={audioLevel}
        buttonSize={buttonSize}
        isPressed={isClicked}
      />

      {/* Button - absolutely centered */}
      <motion.button
        onClick={handleClick}
        onMouseDown={() => !isRecording && !isProcessing && setIsClicked(true)}
        onMouseUp={() => !isRecording && !isProcessing && setTimeout(() => setIsClicked(false), 600)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          setIsHovered(false);
          if (!isRecording && !isProcessing) {
            setIsClicked(false);
          }
        }}
        disabled={isProcessing}
        className={`absolute top-1/2 left-1/2 rounded-full flex transition-all z-10 ${
          isProcessing
            ? "bg-card border-2 border-primary/50 h-10 w-10 items-center justify-center"
            : isRecording
            ? "bg-rose-500 shadow-[0_0_40px_rgba(244,63,94,0.4)] h-10 w-10 flex-col items-center justify-center"
            : "bg-card border-2 border-border/50 hover:border-primary/50 hover:bg-card/80 h-10 w-10 items-center justify-center"
        }`}
        style={{ 
          x: '-50%',
          y: '-50%',
          transformOrigin: 'center center'
        }}
        whileHover={!isRecording && !isProcessing ? { scale: 1.03 } : {}}
        whileTap={!isProcessing ? { scale: 0.97 } : {}}
        title={
          isProcessing
            ? "Processing..."
            : isRecording
            ? "Click to stop recording"
            : "Hyper Record - Click to start recording"
        }
      >
        {isProcessing ? (
          <Loader2 className="w-5 h-5 text-primary animate-spin" />
        ) : isRecording ? (
          <>
            <Square className="w-4 h-4 text-white fill-white" />
            <span className="text-white text-[6px] mt-0.5 font-mono leading-none">
              {formatTime(recordingTime)}
            </span>
          </>
        ) : (
          <motion.div
            className="relative"
            animate={isClicked ? {
              scale: [1, 1.3, 1],
            } : {}}
            transition={{
              duration: 0.3,
              ease: "easeOut",
            }}
          >
            <Zap 
              className={`w-5 h-5 transition-all duration-300 ${
                isHovered && !isProcessing
                  ? 'text-yellow-400 drop-shadow-[0_0_20px_rgba(250,204,21,1)] drop-shadow-[0_0_40px_rgba(250,204,21,0.6)]' 
                  : isClicked 
                  ? 'text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]' 
                  : 'text-muted-foreground'
              }`}
            />
            {isClicked && (
              <motion.div
                className="absolute inset-0 flex items-center justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 0] }}
                transition={{ duration: 0.3 }}
              >
                <Zap className="w-5 h-5 text-white drop-shadow-[0_0_12px_rgba(255,255,255,1)]" />
              </motion.div>
            )}
          </motion.div>
        )}
      </motion.button>
    </div>
  );
}

