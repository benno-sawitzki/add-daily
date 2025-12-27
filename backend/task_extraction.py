"""
Task extraction utilities with preprocessing, segmentation, and validation.
Implements segmentation-first prompting for robust task extraction.
"""
import re
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

# Stopwords and fragments to filter out
STOPWORDS = {
    "police", "tom", "oliver", "website", "then", "later", "after", "that",
    "this", "the", "a", "an", "and", "or", "but", "if", "when", "where",
    "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them"
}

# Filler words that should never become tasks
FILLER_WORDS = {
    "ok", "okay", "alright", "cool", "nice", "yeah", "yep", "nope", 
    "hmm", "uh", "um", "right", "sure", "yup", "nah", "well"
}

# Action verbs that indicate actionable tasks
ACTION_VERBS = {
    "go", "call", "reply", "email", "text", "message", "send", "work", 
    "write", "review", "finish", "fix", "pay", "buy", "book", "schedule", 
    "plan", "clean", "do", "prepare", "follow", "update", "meet", "walk",
    "visit", "get", "make", "create", "read", "check", "complete", "start",
    "stop", "return", "contact", "reach", "connect", "have", "take", "eat"
}
# Note: "write" is already in the list, so "write them per WhatsApp" should pass validation

# Action patterns (title must start with one of these)
ACTION_PATTERNS = [
    "go to ",
    "work on ",
    "reply to ",
    "call ",
    "email ",
    "text ",
    "message ",
    "send ",
    "get back to ",
]


def is_filler_segment(segment: str) -> bool:
    """
    Check if a segment is filler (should be dropped).
    Case-insensitive check against filler words.
    """
    trimmed = segment.strip().lower()
    # Remove trailing punctuation for comparison
    trimmed = re.sub(r'[.,!?;:]+$', '', trimmed)
    return trimmed in FILLER_WORDS


def preprocess_transcript(transcript: str) -> str:
    """
    Preprocess transcript to improve extraction accuracy.
    Normalizes whitespace and splits on common separators.
    """
    if not transcript:
        return ""
    
    # Normalize whitespace
    text = re.sub(r'\s+', ' ', transcript.strip())
    
    # Replace common separators with sentence breaks to help AI split
    # This makes it easier for the model to identify separate tasks
    replacements = [
        (r'\s+then\s+', '. '),
        (r'\s+and then\s+', '. '),
        (r'\s+later\s+', '. '),
        (r'\s+after that\s+', '. '),
        (r';\s*', '. '),  # Semicolons
        (r'\s+/\s+', '. '),  # Slashes
    ]
    
    for pattern, replacement in replacements:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    
    # Keep commas - let the model decide if they indicate separate tasks
    # But normalize multiple commas
    text = re.sub(r',+', ',', text)
    
    return text.strip()


def build_segments_from_whisper(whisper_segments: List[Dict[str, Any]], pause_threshold_ms: int = 600) -> List[Dict[str, Any]]:
    """
    Build segments from Whisper segments with timestamps.
    Merges consecutive segments if gap < pause_threshold_ms (thinking break).
    
    Args:
        whisper_segments: List of dicts with {"start": float, "end": float, "text": str}
        pause_threshold_ms: Gap in milliseconds to start a new segment (default: 600ms)
    
    Returns:
        List of segment dicts: [{"i": int, "start_ms": int, "end_ms": int, "text": str}, ...]
    """
    if not whisper_segments:
        return []
    
    merged_segments = []
    current_segment = None
    
    for i, seg in enumerate(whisper_segments):
        start = seg.get("start", 0)
        end = seg.get("end", 0)
        text = seg.get("text", "").strip()
        
        if not text:
            continue
        
        start_ms = int(start * 1000)
        end_ms = int(end * 1000)
        
        if current_segment is None:
            # Start first segment
            current_segment = {
                "i": len(merged_segments),
                "start_ms": start_ms,
                "end_ms": end_ms,
                "text": text
            }
        else:
            # Check gap between current segment end and this segment start
            gap_ms = start_ms - current_segment["end_ms"]
            
            if gap_ms < pause_threshold_ms:
                # Merge: append text and extend end time
                current_segment["text"] += " " + text
                current_segment["end_ms"] = end_ms
            else:
                # Gap >= threshold: save current segment and start new one
                merged_segments.append(current_segment)
                current_segment = {
                    "i": len(merged_segments),
                    "start_ms": start_ms,
                    "end_ms": end_ms,
                    "text": text
                }
    
    # Add final segment
    if current_segment:
        merged_segments.append(current_segment)
    
    return merged_segments


def segment_transcript_fallback(text: str) -> List[Dict[str, Any]]:
    """
    Fallback text-based segmentation when Whisper segments are not available.
    Splits on ALL delimiters (periods, newlines, semicolons) to avoid huge chunks.
    
    Returns:
        List of segment dicts: [{"i": int, "start_ms": int, "end_ms": int, "text": str}, ...]
        (timestamps are dummy values)
    """
    if not text:
        return []
    
    # Preprocess first
    preprocessed = preprocess_transcript(text)
    
    # Split on ALL delimiters: periods, newlines, semicolons
    # Use regex to split on any of these
    parts = re.split(r'[.\n;]+', preprocessed)
    
    # Also split on "then", "and then", "later" if they weren't already converted to periods
    additional_parts = []
    for part in parts:
        # Check if part contains these separators
        if re.search(r'\s+(then|and then|later|after that)\s+', part, flags=re.IGNORECASE):
            sub_parts = re.split(r'\s+(then|and then|later|after that)\s+', part, flags=re.IGNORECASE)
            # Filter out separator words
            for sub_part in sub_parts:
                sub_part = sub_part.strip()
                if sub_part and sub_part.lower() not in ['then', 'and then', 'later', 'after that']:
                    additional_parts.append(sub_part)
        else:
            additional_parts.append(part)
    
    parts = additional_parts
    
    # Clean and filter segments
    cleaned_segments = []
    for i, part in enumerate(parts):
        part = part.strip()
        if not part:
            continue
        if is_filler_segment(part):
            logger.debug(f"Dropping filler segment: '{part}'")
            continue
        
        cleaned_segments.append({
            "i": len(cleaned_segments),  # Use actual index
            "start_ms": len(cleaned_segments) * 1000,  # Dummy timestamp
            "end_ms": (len(cleaned_segments) + 1) * 1000,  # Dummy timestamp
            "text": part
        })
    
    return cleaned_segments


def segment_transcript(text: str) -> List[str]:
    """
    Deterministically segment transcript into short clauses (legacy function for backward compatibility).
    
    Returns list of non-empty, non-filler segments as strings.
    """
    segments = segment_transcript_fallback(text)
    return [seg["text"] for seg in segments]


def validate_task(task: Dict[str, Any]):
    # Returns: (is_valid: bool, error_message: Optional[str])
    """
    Validate a single task. Returns (is_valid, error_message).
    
    Rules:
    - Title must have at least 2 words
    - Title must be at least 6 characters
    - Title must not be a single stopword/fragment
    - Title must be actionable (contain a verb)
    """
    import logging
    logger = logging.getLogger(__name__)
    
    title = task.get("title", "").strip()
    
    if not title:
        logger.debug(f"Validation failed: Title is empty")
        return False, "Title is empty"
    
    # Check minimum length
    if len(title) < 6:
        return False, f"Title too short: '{title}' (minimum 6 characters)"
    
    # Check word count
    words = title.split()
    if len(words) < 2:
        return False, f"Title has fewer than 2 words: '{title}'"
    
    # Check if it's a single stopword
    title_lower = title.lower()
    if title_lower in STOPWORDS:
        return False, f"Title is a stopword: '{title}'"
    
    # Check if it's just a single word (even if not in stopwords)
    if len(words) == 1:
        return False, f"Title is a single word: '{title}'"
    
    # Check for standalone duration fragments (hard reject)
    title_lower = title.lower()
    
    # Reject standalone durations
    duration_patterns = [
        r'^\d+\s+(minutes?|minute|hours?|hour)$',
        r'^(one|two|three|four|five)\s+hours?$',
        r'^(30|45|60|90)\s+minutes?$',
    ]
    for pattern in duration_patterns:
        if re.match(pattern, title_lower):
            return False, f"Title is standalone duration: '{title}'"
    
    # Check explicit duration strings
    standalone_durations = {
        "one hour", "two hours", "three hours", "four hours", "five hours",
        "30 minutes", "45 minutes", "60 minutes", "90 minutes"
    }
    if title_lower in standalone_durations:
        return False, f"Title is standalone duration: '{title}'"
    
    # Check if it's a filler word
    if title_lower in FILLER_WORDS:
        return False, f"Title is filler: '{title}'"
    
    # Check for action verbs or action patterns
    first_word_lower = words[0].lower()
    
    # Check if it starts with an action verb
    has_action_verb = first_word_lower in ACTION_VERBS
    
    # Check if it starts with an action pattern
    has_action_pattern = any(title_lower.startswith(pattern) for pattern in ACTION_PATTERNS)
    
    # Allowlist for common action phrases (even if verb not at start)
    allowed_patterns = [
        r'^eat\s+',  # "Eat something", "Eat breakfast"
        r'^have\s+',  # "Have a coffee", "Have lunch"
    ]
    has_allowed_pattern = any(re.match(pattern, title_lower) for pattern in allowed_patterns)
    
    # REQUIRE action for ALL titles (strict)
    if not has_action_verb and not has_action_pattern and not has_allowed_pattern:
        logger.debug(f"Validation failed: Title missing action verb - '{title}'")
        return False, f"Title missing action verb: '{title}'"
    
    logger.debug(f"Validation passed: '{title}'")
    return True, None


def normalize_title(title: str) -> str:
    """
    Normalize task title with minimal cleanup.
    Trust LLM output more - only do basic cleanup.
    """
    if not title:
        return ""
    
    # Remove leading filler at start (okay, yeah, etc.)
    title = re.sub(r'^(okay|yeah|yep|yup|alright|sure|well|um|uh|hmm)[,\s]+', '', title, flags=re.IGNORECASE)
    
    # Remove only the most common prefixes if absolutely necessary
    # Trust LLM to have already normalized most cases
    common_prefixes = [
        r'^I want to\s+',
        r'^I need to\s+',
        r'^I have to\s+',
    ]
    
    # Apply once (not in loop) - trust LLM output
    for pattern in common_prefixes:
        title = re.sub(pattern, '', title, flags=re.IGNORECASE)
    
    # Strip trailing punctuation
    title = re.sub(r'[.,!?;:]+$', '', title)
    
    # Collapse whitespace
    title = re.sub(r'\s+', ' ', title).strip()
    
    return title


def detect_cancel_intent(text: str) -> Optional[str]:
    """
    Detect cancellation/negation intent in text.
    Returns the cancelled keyword/phrase if found, None otherwise.
    
    Patterns:
    - "maybe X not"
    - "not X"
    - "skip X"
    - "no X"
    - "actually not X"
    """
    if not text:
        return None
    
    text_lower = text.lower()
    
    # Pattern: "maybe X not" or "maybe not X"
    match = re.search(r'maybe\s+(\w+(?:\s+\w+){0,2})\s+not|maybe\s+not\s+(\w+(?:\s+\w+){0,2})', text_lower)
    if match:
        return (match.group(1) or match.group(2)).strip()
    
    # Pattern: "not X" (but not "not to" or "not the")
    # Skip stopwords: "not the X" -> extract X, "not a X" -> extract X
    match = re.search(r'\bnot\s+(?:the|a|an)\s+(\w+(?:\s+\w+){0,2})(?:\s|$)', text_lower)
    if match:
        return match.group(1).strip()
    
    # Pattern: "not X" (direct, no article)
    match = re.search(r'\bnot\s+(\w+(?:\s+\w+){0,2})(?:\s|$)', text_lower)
    if match and match.group(1).lower() not in ['to', 'the', 'a', 'an']:
        return match.group(1).strip()
    
    # Pattern: "skip X" or "skip the X"
    match = re.search(r'skip\s+(?:the|a|an)\s+(\w+(?:\s+\w+){0,2})', text_lower)
    if match:
        return match.group(1).strip()
    
    match = re.search(r'skip\s+(\w+(?:\s+\w+){0,2})', text_lower)
    if match:
        return match.group(1).strip()
    
    # Pattern: "no X" or "no the X" (but not "no one" or "no way")
    match = re.search(r'\bno\s+(?:the|a|an)\s+(\w+(?:\s+\w+){0,2})(?:\s|$)', text_lower)
    if match:
        return match.group(1).strip()
    
    match = re.search(r'\bno\s+(\w+(?:\s+\w+){0,2})(?:\s|$)', text_lower)
    if match and match.group(1).lower() not in ['one', 'way', 'time']:
        return match.group(1).strip()
    
    # Pattern: "actually not X" or "actually not the X"
    match = re.search(r'actually\s+not\s+(?:the|a|an)\s+(\w+(?:\s+\w+){0,2})', text_lower)
    if match:
        return match.group(1).strip()
    
    match = re.search(r'actually\s+not\s+(\w+(?:\s+\w+){0,2})', text_lower)
    if match:
        return match.group(1).strip()
    
    return None


def split_multi_action_title(task: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    If a title contains multiple actions (separated by " or ", " and ", or comma),
    split into separate tasks.
    Also extracts duration from "that takes X" pattern.
    
    Examples:
    "Do laundry and have a coffee and go to lunch at 12"
    -> ["Do laundry", "Have a coffee", "Go to lunch" (due_text: "at 12")]
    
    "call Oliver and Roberta or write them per WhatsApp"
    -> ["call Oliver and Roberta", "write them per WhatsApp"]
    """
    title = task.get("title", "").strip()
    if not title:
        return [task]
    
    # First, extract duration from "that takes X" pattern even if not splitting
    duration_match = re.search(r'that\s+takes?\s+(\d+|\w+)\s*(minutes?|hours?|minute|hour)', title, re.IGNORECASE)
    extracted_duration = None
    if duration_match:
        duration_value = duration_match.group(1)
        duration_unit = duration_match.group(2).lower()
        
        # Convert to minutes
        if duration_unit.startswith('hour'):
            if duration_value.isdigit():
                extracted_duration = int(duration_value) * 60
            elif duration_value.lower() == 'one':
                extracted_duration = 60
            elif duration_value.lower() == 'two':
                extracted_duration = 120
            elif duration_value.lower() == 'three':
                extracted_duration = 180
        elif duration_unit.startswith('minute'):
            if duration_value.isdigit():
                extracted_duration = int(duration_value)
        
        # Remove "that takes X" from title
        title = re.sub(r'\s+that\s+takes?\s+(\d+|\w+)\s*(minutes?|hours?|minute|hour)', '', title, flags=re.IGNORECASE).strip()
        task = task.copy()
        task["title"] = title
        if extracted_duration:
            task["duration_minutes"] = extracted_duration
    
    # Check if it contains " or ", " and ", or comma-separated actions
    # Only split if it looks like multiple distinct actions
    has_or = " or " in title.lower()
    has_and = " and " in title.lower()
    has_comma = "," in title
    
    if not (has_or or has_and or has_comma):
        return [task]
    
    # Try to split on " or " first (higher priority), then " and ", then comma
    if has_or:
        # Split on " or " - extract both options as separate tasks
        parts = re.split(r'\s+or\s+', title, flags=re.IGNORECASE)
    elif has_and:
        # Split on " and " - be smart about it
        # "work on X and on Y" should split
        # "call Tom and Oliver" should NOT split (single action with multiple objects)
        # Strategy: split on " and " followed by action patterns or prepositions
        parts = re.split(r'\s+and\s+(?=on\s+|to\s+|work\s+|call\s+|go\s+|do\s+|have\s+|eat\s+|write\s+)', title, flags=re.IGNORECASE)
        if len(parts) == 1:
            # Fallback: split on all " and " (validation will filter invalid parts)
            parts = re.split(r'\s+and\s+', title, flags=re.IGNORECASE)
    else:
        # Split on comma
        parts = [p.strip() for p in title.split(',')]
    
    # Filter out empty parts
    parts = [p.strip() for p in parts if p.strip()]
    
    # Only split if we got 2+ parts and they look like separate actions
    if len(parts) < 2:
        return [task]
    
    # Check if parts look like separate actions
    # Be lenient - if we have 2+ parts, try splitting (even if not all start with verbs)
    # The validation step will filter out invalid ones
    if len(parts) < 2:
        return [task]
    
    # Use all parts (validation will catch non-actionable ones)
    action_parts = parts
    
    # Create separate tasks with proper normalization and validation
    split_tasks = []
    due_text = task.get("due_text")
    duration_minutes = task.get("duration_minutes")
    notes = task.get("notes")
    
    for i, part in enumerate(action_parts):
        # Extract "that takes X" duration pattern from this part
        part_duration_match = re.search(r'that\s+takes?\s+(\d+|\w+)\s*(minutes?|hours?|minute|hour)', part, re.IGNORECASE)
        part_extracted_duration = None
        if part_duration_match:
            duration_value = part_duration_match.group(1)
            duration_unit = part_duration_match.group(2).lower()
            
            # Convert to minutes
            if duration_unit.startswith('hour'):
                if duration_value.isdigit():
                    part_extracted_duration = int(duration_value) * 60
                elif duration_value.lower() == 'one':
                    part_extracted_duration = 60
                elif duration_value.lower() == 'two':
                    part_extracted_duration = 120
                elif duration_value.lower() == 'three':
                    part_extracted_duration = 180
            elif duration_unit.startswith('minute'):
                if duration_value.isdigit():
                    part_extracted_duration = int(duration_value)
            
            # Remove "that takes X" from part before normalizing
            part = re.sub(r'\s+that\s+takes?\s+(\d+|\w+)\s*(minutes?|hours?|minute|hour)', '', part, flags=re.IGNORECASE).strip()
        
        # Normalize the part after extracting duration
        normalized_part = normalize_title(part)
        
        # Extract time from this part if present
        time_match = re.search(r'at\s+(\d+|\d+:\d+)', normalized_part, re.IGNORECASE)
        extracted_time = None
        if time_match:
            extracted_time = f"at {time_match.group(1)}"
            # Remove time from title
            normalized_part = re.sub(r'\s+at\s+\d+(?::\d+)?', '', normalized_part, flags=re.IGNORECASE).strip()
        
        # Handle implied actions: if part starts with "on the X" and previous part had "work on", imply "work on X"
        if normalized_part.lower().startswith("on the ") and i > 0:
            # Check if previous part started with "work on"
            prev_title = split_tasks[-1].get("title", "").lower() if split_tasks else ""
            if prev_title.startswith("work on"):
                normalized_part = "work on " + normalized_part[7:]  # Remove "on the " prefix
        
        # Validate the normalized part (drop if it becomes filler/non-actionable)
        temp_task = {"title": normalized_part}
        is_valid, error_msg = validate_task(temp_task)
        
        if not is_valid:
            logger.debug(f"Dropping split part after normalization: {error_msg} - '{normalized_part}'")
            continue
        
        new_task = {
            "title": normalized_part,
            "source_text": part,
            "segment_index": task.get("segment_index"),
            "confidence": task.get("confidence", 0.8)
        }
        
        # Assign due_text and duration only to the part that contains them
        if extracted_time:
            new_task["due_text"] = extracted_time
        elif i == len(action_parts) - 1 and due_text:
            # Only add original due_text to last part if not extracted elsewhere
            new_task["due_text"] = due_text
        
        if part_extracted_duration:
            new_task["duration_minutes"] = part_extracted_duration
        elif extracted_duration:
            new_task["duration_minutes"] = extracted_duration
        elif i == len(action_parts) - 1 and duration_minutes:
            # Only add original duration to last part if not extracted elsewhere
            new_task["duration_minutes"] = duration_minutes
        
        if notes and i == len(action_parts) - 1:
            new_task["notes"] = notes
        
        split_tasks.append(new_task)
    
    return split_tasks


def deduplicate_tasks(tasks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Remove duplicate or near-duplicate tasks.
    Uses case-insensitive title matching after trimming.
    """
    seen = set()
    unique_tasks = []
    
    for task in tasks:
        title = task.get("title", "").strip().lower()
        if title and title not in seen:
            seen.add(title)
            unique_tasks.append(task)
        elif title in seen:
            logger.debug(f"Dropping duplicate task: '{task.get('title')}'")
    
    return unique_tasks


def fuzzy_match_cancellation(cancel_phrase: str, task_title: str) -> bool:
    """
    Check if a cancellation phrase matches a task title (fuzzy match).
    
    Rules:
    - Lowercase both
    - Remove stopwords ("the", "a", "on", "to")
    - Match if cancelled keyword appears in task title
    
    Example: cancel "website" matches "Work on the website"
    """
    stopwords = {"the", "a", "an", "on", "to", "for", "with", "in", "at"}
    
    # Normalize cancel phrase
    cancel_lower = cancel_phrase.lower()
    cancel_words = [w for w in cancel_lower.split() if w not in stopwords]
    
    if not cancel_words:
        return False
    
    # Normalize task title
    title_lower = task_title.lower()
    title_words = set(title_lower.split())
    
    # Check if any cancel word appears in title
    for cancel_word in cancel_words:
        if cancel_word in title_words or cancel_word in title_lower:
            return True
    
    return False


def apply_cancellations(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Apply cancellation logic: remove tasks that match cancel_task items.
    
    Args:
        items: List of items with type "task" or "cancel_task"
    
    Returns:
        List of items with cancelled tasks removed
    """
    # Separate tasks and cancellations
    tasks = [item for item in items if item.get("type") == "task"]
    cancellations = [item for item in items if item.get("type") == "cancel_task"]
    
    if not cancellations:
        return tasks
    
    # Build cancellation phrases
    cancel_phrases = []
    for cancel in cancellations:
        # Use title or source_text to build cancellation phrase
        phrase = cancel.get("title") or cancel.get("source_text", "")
        if phrase:
            cancel_phrases.append(phrase)
        
        # Also check targets if present
        targets = cancel.get("targets", [])
        if targets:
            cancel_phrases.extend(targets)
    
    # Remove tasks that match any cancellation
    remaining_tasks = []
    for task in tasks:
        title = task.get("title", "")
        is_cancelled = False
        
        for cancel_phrase in cancel_phrases:
            if fuzzy_match_cancellation(cancel_phrase, title):
                logger.info(f"Cancelling task '{title}' due to cancellation phrase '{cancel_phrase}'")
                is_cancelled = True
                break
        
        if not is_cancelled:
            remaining_tasks.append(task)
    
    return remaining_tasks


def validate_and_clean_tasks(tasks: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Validate and clean tasks: normalize titles, validate, filter, and optionally split.
    Handles type="ignore", type="cancel_task", and type="task".
    
    Returns:
        {
            "tasks": List[validated_tasks],
            "dropped": List[dropped_tasks_with_reasons],
            "raw_count": int,
            "final_count": int
        }
    """
    raw_count = len(tasks)
    validated_tasks = []
    dropped_tasks = []
    
    # First pass: detect cancel intent BEFORE type filtering
    # Convert items with cancel intent to cancel_task type
    for i, item in enumerate(tasks):
        item_type = item.get("type", "task")
        
        # If type is missing or "task", check for cancel intent
        if item_type in ["task", None, ""]:
            title = item.get("title", "")
            source_text = item.get("source_text", title)
            cancel_target = detect_cancel_intent(title) or detect_cancel_intent(source_text)
            
            if cancel_target:
                # Convert to cancel_task
                item["type"] = "cancel_task"
                item["targets"] = [cancel_target]
                logger.info(f"Detected cancel intent: '{cancel_target}' from '{title or source_text}'")
    
    # Second pass: filter by type
    # Drop type="ignore" items
    # Keep type="cancel_task" for later processing
    # Process type="task" items
    task_items = []
    cancel_items = []
    
    for i, item in enumerate(tasks):
        item_type = item.get("type", "task")
        
        if item_type == "ignore":
            dropped_tasks.append({
                "index": i,
                "task": item,
                "reason": "type=ignore (filler/acknowledgement)"
            })
            continue
        elif item_type == "cancel_task":
            cancel_items.append(item)
            continue
        elif item_type == "task":
            task_items.append(item)
        else:
            # Unknown type, treat as task
            task_items.append(item)
    
    # Third pass: normalize titles and validate task items
    for i, task in enumerate(task_items):
        # Normalize title
        if "title" in task:
            task["title"] = normalize_title(task["title"])
        
        # Validate
        is_valid, error_msg = validate_task(task)
        
        if is_valid:
            # Add source_text for debugging if not present
            if "source_text" not in task:
                task["source_text"] = task.get("title", "")
            validated_tasks.append(task)
        else:
            dropped_tasks.append({
                "index": i,
                "task": task,
                "reason": error_msg
            })
            logger.warning(f"Dropped invalid task {i+1}: {error_msg} - {task.get('title', 'N/A')}")
    
    # Fourth pass: apply cancellations
    if cancel_items:
        # Add cancel items to validated_tasks temporarily for cancellation logic
        all_items = validated_tasks + cancel_items
        validated_tasks = apply_cancellations(all_items)
        logger.info(f"Applied {len(cancel_items)} cancellations, {len(validated_tasks)} tasks remaining")
    
    # Fifth pass: split multi-action titles
    split_tasks = []
    for task in validated_tasks:
        split = split_multi_action_title(task)
        split_tasks.extend(split)
    
    # Sixth pass: re-validate split tasks and deduplicate
    final_tasks = []
    for task in split_tasks:
        # Normalize again after splitting
        if "title" in task:
            task["title"] = normalize_title(task["title"])
        
        is_valid, error_msg = validate_task(task)
        if is_valid:
            final_tasks.append(task)
        else:
            logger.debug(f"Dropped task after splitting: {error_msg} - {task.get('title', 'N/A')}")
    
    # Deduplicate
    before_dedup = len(final_tasks)
    final_tasks = deduplicate_tasks(final_tasks)
    after_dedup = len(final_tasks)
    
    if before_dedup != after_dedup:
        logger.info(f"Deduplication removed {before_dedup - after_dedup} duplicate tasks")
    
    return {
        "tasks": final_tasks,
        "dropped": dropped_tasks,
        "raw_count": raw_count,
        "final_count": len(final_tasks)
    }


def postprocess_tasks(tasks: List[Dict[str, Any]], source_transcript: str) -> Dict[str, Any]:
    """
    Post-process extracted tasks: validate, filter, and deduplicate.
    (Legacy function, calls validate_and_clean_tasks)
    """
    return validate_and_clean_tasks(tasks)

