"""
OpenAI audio transcription module.
Handles audio file transcription using OpenAI Whisper API.
"""
import os
import logging
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)


async def transcribe_audio_file(
    audio_file_path: str,
    model: str = "whisper-1",
    language: str = "en",
    return_segments: bool = True
):
    """
    Transcribe audio file using OpenAI Whisper API.
    
    Args:
        audio_file_path: Path to the audio file to transcribe
        model: Whisper model to use (default: whisper-1)
        language: Language code (default: en). Set to None for auto-detection.
        return_segments: If True, returns dict with text and segments. If False, returns just text.
    
    Returns:
        If return_segments=True: {"text": str, "segments": List[dict]} where each segment has:
            {"start": float, "end": float, "text": str}
        If return_segments=False: str (transcribed text)
    
    Raises:
        ValueError: If OPENAI_API_KEY is not configured
        Exception: For OpenAI API errors (rate limits, network issues, etc.)
    """
    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        raise ValueError("OPENAI_API_KEY not configured")
    
    client = AsyncOpenAI(api_key=api_key)
    
    try:
        # OpenAI SDK accepts file-like objects
        # Open the file and pass it to the API
        with open(audio_file_path, "rb") as audio_file:
            if return_segments:
                try:
                    # Request verbose_json to get segments with timestamps
                    transcript = await client.audio.transcriptions.create(
                        model=model,
                        file=audio_file,
                        language=language,
                        response_format="verbose_json"  # Returns segments with timestamps
                    )
                    
                    # Extract segments with timestamps
                    segments = []
                    # Handle both dict and object access
                    if isinstance(transcript, dict):
                        transcript_segments = transcript.get("segments", [])
                    else:
                        transcript_segments = getattr(transcript, "segments", [])
                    
                    if transcript_segments:
                        for seg in transcript_segments:
                            # Handle both dict and object access
                            if isinstance(seg, dict):
                                segments.append({
                                    "start": seg.get("start", 0),
                                    "end": seg.get("end", 0),
                                    "text": seg.get("text", "").strip()
                                })
                            else:
                                segments.append({
                                    "start": getattr(seg, "start", 0),
                                    "end": getattr(seg, "end", 0),
                                    "text": getattr(seg, "text", "").strip()
                                })
                    
                    # Get text - handle both dict and object
                    if isinstance(transcript, dict):
                        text = transcript.get("text", "")
                    else:
                        text = getattr(transcript, "text", "")
                    
                    return {
                        "text": text,
                        "segments": segments
                    }
                except Exception as seg_error:
                    # If verbose_json fails, fall back to regular transcription
                    logger.warning(f"verbose_json format failed, falling back to regular transcription: {str(seg_error)}")
                    # Reopen file for fallback
                    with open(audio_file_path, "rb") as fallback_file:
                        transcript = await client.audio.transcriptions.create(
                            model=model,
                            file=fallback_file,
                            language=language,
                            response_format="json"
                        )
                        # Return text only if segments failed
                        if isinstance(transcript, dict):
                            text = transcript.get("text", "")
                        else:
                            text = getattr(transcript, "text", "")
                        return {
                            "text": text,
                            "segments": []  # Empty segments - will use fallback segmentation
                        }
            else:
                # Simple text-only response
                transcript = await client.audio.transcriptions.create(
                    model=model,
                    file=audio_file,
                    language=language,
                    response_format="json"
                )
                if isinstance(transcript, dict):
                    return transcript.get("text", "")
                else:
                    return getattr(transcript, "text", "")
        
    except Exception as e:
        logger.error(f"OpenAI Whisper transcription error: {str(e)}")
        raise

