"""
OpenAI client wrapper for LLM text generation.
Replaces the emergentintegrations dependency.
"""
import os
import json
import logging
from typing import Optional, Dict, Any
from openai import OpenAI
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)


async def generate_json(
    system_prompt: str,
    user_prompt: str,
    model: str = "gpt-4o-mini",
    temperature: float = 0.7
) -> Dict[str, Any]:
    """
    Generate a JSON response from OpenAI chat completion with strict JSON mode.
    
    Args:
        system_prompt: System message for the AI
        user_prompt: User message/input
        model: OpenAI model to use (default: gpt-4o-mini)
        temperature: Sampling temperature (default: 0.7)
    
    Returns:
        Parsed JSON dictionary from the response
    
    Raises:
        ValueError: If API key is not configured
        json.JSONDecodeError: If JSON parsing fails (with raw output logged)
        Exception: For other OpenAI API errors
    """
    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        raise ValueError("OPENAI_API_KEY not configured")
    
    client = AsyncOpenAI(api_key=api_key)
    
    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=temperature,
            response_format={"type": "json_object"}  # Force strict JSON output
        )
        
        response_text = response.choices[0].message.content
        
        if not response_text:
            logger.error("OpenAI returned empty response")
            raise ValueError("Empty response from OpenAI API")
        
        # Parse JSON from response
        # With json_object response_format, OpenAI should return pure JSON
        # but we'll still handle markdown wrapping as a fallback
        try:
            response_text = response_text.strip()
            
            # Remove markdown code blocks if present (shouldn't be with json_object format)
            if response_text.startswith("```json"):
                response_text = response_text[7:]
            elif response_text.startswith("```"):
                response_text = response_text[3:]
            if response_text.endswith("```"):
                response_text = response_text[:-3]
            
            parsed = json.loads(response_text.strip())
            return parsed
            
        except json.JSONDecodeError as e:
            # Log the raw model output for debugging
            logger.error("=" * 80)
            logger.error("JSON PARSING FAILED - Raw model output:")
            logger.error(response_text)
            logger.error("=" * 80)
            logger.error(f"JSON decode error: {e}")
            logger.error(f"Error at position: {e.pos if hasattr(e, 'pos') else 'unknown'}")
            raise json.JSONDecodeError(
                f"Failed to parse AI response as JSON. Raw output logged.",
                e.doc if hasattr(e, 'doc') else response_text,
                e.pos if hasattr(e, 'pos') else 0
            )
            
    except json.JSONDecodeError:
        # Re-raise JSON decode errors (already logged above)
        raise
    except Exception as e:
        logger.error(f"OpenAI API error: {str(e)}")
        raise


def get_model_for_provider(provider: str, model_id: str) -> str:
    """
    Map provider/model combinations to OpenAI model names.
    
    Args:
        provider: Provider name (openai, anthropic, gemini)
        model_id: Model identifier from the frontend
    
    Returns:
        OpenAI model name to use
    """
    # For OpenAI models, use the model_id directly
    if provider == "openai":
        # Map known OpenAI models
        model_map = {
            "gpt-5.2": "gpt-4o-mini",  # Fallback if gpt-5.2 doesn't exist
            "gpt-4o": "gpt-4o",
            "gpt-4o-mini": "gpt-4o-mini",
        }
        return model_map.get(model_id, model_id)
    
    # For other providers, use a default OpenAI model
    # In a real implementation, you might want to use different models
    # or keep provider-specific logic, but for simplicity, we'll use gpt-4o-mini
    logger.warning(f"Provider {provider} not directly supported, using gpt-4o-mini")
    return "gpt-4o-mini"

