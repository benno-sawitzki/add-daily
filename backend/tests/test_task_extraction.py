"""
Unit tests for task extraction from dump transcripts.
"""
import pytest
from backend.task_extraction import (
    preprocess_transcript,
    validate_task,
    deduplicate_tasks,
    postprocess_tasks
)


class TestPreprocessing:
    def test_normalize_whitespace(self):
        result = preprocess_transcript("Go  to   the  store")
        assert result == "Go to the store"
    
    def test_split_on_then(self):
        result = preprocess_transcript("Go to store then buy groceries")
        assert "then" not in result or ". " in result
    
    def test_split_on_and_then(self):
        result = preprocess_transcript("Call mom and then visit dad")
        assert "and then" not in result or ". " in result
    
    def test_split_on_later(self):
        result = preprocess_transcript("Work now later rest")
        assert "later" not in result or ". " in result
    
    def test_split_on_semicolon(self):
        result = preprocess_transcript("Task one; task two")
        assert ". " in result
    
    def test_keep_commas(self):
        result = preprocess_transcript("Call Tom, reply to Sarah")
        assert "," in result  # Commas should be kept


class TestValidation:
    def test_valid_task(self):
        task = {"title": "Go to the store"}
        is_valid, error = validate_task(task)
        assert is_valid is True
        assert error is None
    
    def test_single_word_rejected(self):
        task = {"title": "Tom"}
        is_valid, error = validate_task(task)
        assert is_valid is False
        assert "single word" in error.lower() or "fewer than 2 words" in error.lower()
    
    def test_too_short_rejected(self):
        task = {"title": "Go"}
        is_valid, error = validate_task(task)
        assert is_valid is False
        assert "too short" in error.lower() or "fewer than 2 words" in error.lower()
    
    def test_stopword_rejected(self):
        task = {"title": "police"}
        is_valid, error = validate_task(task)
        assert is_valid is False
    
    def test_actionable_phrase_accepted(self):
        task = {"title": "Reply to Tom"}
        is_valid, error = validate_task(task)
        assert is_valid is True
    
    def test_fragment_rejected(self):
        task = {"title": "website"}
        is_valid, error = validate_task(task)
        assert is_valid is False


class TestDeduplication:
    def test_removes_duplicates(self):
        tasks = [
            {"title": "Call Tom"},
            {"title": "call tom"},  # Case-insensitive duplicate
            {"title": "Reply to Sarah"}
        ]
        result = deduplicate_tasks(tasks)
        assert len(result) == 2
        assert result[0]["title"] == "Call Tom"
        assert result[1]["title"] == "Reply to Sarah"
    
    def test_preserves_order(self):
        tasks = [
            {"title": "First task"},
            {"title": "Second task"},
            {"title": "first task"}  # Duplicate of first
        ]
        result = deduplicate_tasks(tasks)
        assert len(result) == 2
        assert result[0]["title"] == "First task"
        assert result[1]["title"] == "Second task"


class TestPostprocessing:
    def test_example_transcript(self):
        """Test the main example from requirements"""
        transcript = "Go to the police today, then I need to get back to Tom, get back to Oliver and work on a website for two hours."
        
        raw_tasks = [
            {"title": "Go to the police", "due_text": "today", "source_text": "Go to the police today"},
            {"title": "Get back to Tom", "source_text": "get back to Tom"},
            {"title": "Get back to Oliver", "source_text": "get back to Oliver"},
            {"title": "Work on a website", "duration_minutes": 120, "source_text": "work on a website for two hours"}
        ]
        
        result = postprocess_tasks(raw_tasks, transcript)
        
        assert result["final_count"] == 4
        assert len(result["tasks"]) == 4
        assert len(result["dropped"]) == 0
        
        titles = [t["title"] for t in result["tasks"]]
        assert "Go to the police" in titles
        assert "Get back to Tom" in titles
        assert "Get back to Oliver" in titles
        assert "Work on a website" in titles
    
    def test_filters_single_words(self):
        raw_tasks = [
            {"title": "Go to the store"},
            {"title": "Tom"},  # Should be dropped
            {"title": "police"},  # Should be dropped
            {"title": "Reply to Sarah"}
        ]
        
        result = postprocess_tasks(raw_tasks, "test")
        
        assert result["final_count"] == 2
        assert len(result["dropped"]) == 2
        titles = [t["title"] for t in result["tasks"]]
        assert "Go to the store" in titles
        assert "Reply to Sarah" in titles
        assert "Tom" not in titles
        assert "police" not in titles
    
    def test_test_case_a(self):
        """Pay rent tomorrow and book dentist appointment."""
        raw_tasks = [
            {"title": "Pay rent", "due_text": "tomorrow", "source_text": "Pay rent tomorrow"},
            {"title": "Book dentist appointment", "source_text": "book dentist appointment"}
        ]
        
        result = postprocess_tasks(raw_tasks, "test")
        assert result["final_count"] == 2
        assert len(result["dropped"]) == 0
    
    def test_test_case_b(self):
        """Call mom, then buy groceries, later work on proposal for 45 minutes."""
        raw_tasks = [
            {"title": "Call mom", "source_text": "Call mom"},
            {"title": "Buy groceries", "source_text": "buy groceries"},
            {"title": "Work on proposal", "duration_minutes": 45, "source_text": "work on proposal for 45 minutes"}
        ]
        
        result = postprocess_tasks(raw_tasks, "test")
        assert result["final_count"] == 3
        assert len(result["dropped"]) == 0
    
    def test_test_case_c(self):
        """Email Sarah and John about the event next week."""
        raw_tasks = [
            {"title": "Email Sarah about the event", "due_text": "next week", "source_text": "Email Sarah about the event next week"},
            {"title": "Email John about the event", "due_text": "next week", "source_text": "Email John about the event next week"}
        ]
        
        result = postprocess_tasks(raw_tasks, "test")
        # Should have at least 1 task (could be 1 or 2 depending on how AI splits)
        assert result["final_count"] >= 1
        assert len(result["dropped"]) == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])






