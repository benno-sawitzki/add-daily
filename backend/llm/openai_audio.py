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
    language: str = "en"
) -> str:
    """
    Transcribe audio file using OpenAI Whisper API.
    
    Args:
        audio_file_path: Path to the audio file to transcribe
        model: Whisper model to use (default: whisper-1)
        language: Language code (default: en). Set to None for auto-detection.
    
    Returns:
        Transcribed text as a string
    
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
            transcript = await client.audio.transcriptions.create(
                model=model,
                file=audio_file,
                language=language,
                response_format="json"
            )
        
        return transcript.text
        
    except Exception as e:
        logger.error(f"OpenAI Whisper transcription error: {str(e)}")
        raise

