# Judge Test Output

## Purpose
Evaluate VS Code extension test outputs for quality and correctness using structured criteria. This skill acts as an LLM judge to assess non-deterministic test responses, ensuring they meet quality standards.

## When to Use This Skill
- When evaluating test outputs from VS Code extension integration tests
- When the user provides a test output JSON object to be judged
- When assessing the quality of tool executions, responses, and markdown rendering
- When determining if a test case passes quality thresholds

## Input Format
You will receive test output as a JSON object with this structure:

```json
{
  "test_name": "string - name of the test",
  "prompt": "string - the prompt sent to the agent",
  "tool_executions": [
    {
      "toolName": "string - name of the tool executed",
      "status": "string - execution status (complete, error, etc.)",
      "duration": "number - execution time in seconds",
      "result": "string - result or output from the tool"
    }
  ],
  "response_content": "string - the agent's text response",
  "execution_time_ms": "number - total execution time in milliseconds"
}
```

## Evaluation Criteria

### 1. Tool Execution Display (0-10 points)

**What to evaluate:**
- Are tool executions displayed clearly and correctly?
- Are tool names accurate and recognizable?
- Is status information (complete, error, pending) shown correctly?
- Are execution times/durations displayed accurately?
- Are tool results or outputs presented in a readable format?
- Is the order of tool executions logical and clear?

**Scoring Rubric:**
- **10:** Perfect display - all tools shown with accurate timing, clear status, well-formatted results
- **8-9:** Excellent - minor formatting issues but all information present and clear
- **6-7:** Good - all tools shown but some timing/status info unclear or poorly formatted
- **4-5:** Fair - tools shown but significant clarity issues or missing information
- **2-3:** Poor - tools barely visible or most information missing/incorrect
- **0-1:** Failed - no tool information displayed or completely incorrect

### 2. Response Quality (0-10 points)

**What to evaluate:**
- Is the response relevant to the prompt?
- Is the response accurate and correct?
- Is the response well-formatted and easy to read?
- Does the response provide helpful information?
- Is the tone appropriate and professional?
- Are there grammatical or spelling errors?
- Does the response directly address what was asked?

**Scoring Rubric:**
- **10:** Perfect - highly relevant, accurate, well-formatted, helpful, professional, no errors
- **8-9:** Excellent - very good quality with only minor issues
- **6-7:** Good - generally accurate and helpful but some formatting or clarity issues
- **4-5:** Fair - partially relevant or somewhat unclear, but usable
- **2-3:** Poor - significant accuracy issues or very unclear
- **0-1:** Failed - irrelevant, incorrect, or incomprehensible

### 3. Markdown Rendering (0-10 points)

**What to evaluate:**
- Are code blocks (inline and fenced) rendered correctly?
- Are headers (h1, h2, h3, etc.) displayed properly?
- Are lists (ordered and unordered) formatted correctly?
- Are tables rendered properly if present?
- Is text styling (bold, italic, strikethrough) working?
- Are links formatted correctly?
- Is overall markdown structure clean and readable?

**Scoring Rubric:**
- **10:** Perfect - all markdown elements render correctly and beautifully
- **8-9:** Excellent - all elements work with only minor aesthetic issues
- **6-7:** Good - most elements work but some rendering issues
- **4-5:** Fair - significant markdown elements broken but some work
- **2-3:** Poor - most markdown broken or poorly rendered
- **0-1:** Failed - markdown completely broken or not rendered
- **N/A (score 10):** If no markdown elements are present in response, score this as 10

## Output Format

You MUST return a valid JSON object with this exact structure:

```json
{
  "test_name": "string - copy from input",
  "scores": {
    "tool_execution_display": 0-10,
    "response_quality": 0-10,
    "markdown_rendering": 0-10
  },
  "overall_score": 0.0-10.0,
  "passed": true/false,
  "feedback": {
    "tool_execution_display": "string - specific feedback explaining the score",
    "response_quality": "string - specific feedback explaining the score",
    "markdown_rendering": "string - specific feedback explaining the score"
  }
}
```

**Important Output Rules:**
1. The `overall_score` is the average of the three criterion scores, rounded to 1 decimal place
2. `passed` is `true` if `overall_score >= 7.0`, otherwise `false`
3. Each feedback string should be 1-3 sentences explaining the score
4. Feedback should be specific and constructive
5. Return ONLY the JSON object, no additional text before or after

## Passing Threshold
- **Pass:** overall_score >= 7.0
- **Fail:** overall_score < 7.0

## Examples

### Example 1: High Quality Output (Should Pass)

**Input:**
```json
{
  "test_name": "File Creation Test",
  "prompt": "Create a hello.txt file with the content 'Hello World'",
  "tool_executions": [
    {
      "toolName": "create",
      "status": "complete",
      "duration": 0.12,
      "result": "File created successfully at /path/to/hello.txt"
    }
  ],
  "response_content": "I've created the file `hello.txt` with the content:\n\n```\nHello World\n```\n\nThe file is now ready at `/path/to/hello.txt`.",
  "execution_time_ms": 3450
}
```

**Output:**
```json
{
  "test_name": "File Creation Test",
  "scores": {
    "tool_execution_display": 9,
    "response_quality": 9,
    "markdown_rendering": 10
  },
  "overall_score": 9.3,
  "passed": true,
  "feedback": {
    "tool_execution_display": "Tool execution shown clearly with accurate status (complete) and duration (0.12s). Result message is informative and well-formatted.",
    "response_quality": "Response is highly relevant, accurate, and directly addresses the prompt. Clear confirmation of action taken with helpful path information.",
    "markdown_rendering": "Perfect rendering of inline code, fenced code block, and overall structure. Clean and readable presentation."
  }
}
```

### Example 2: Poor Quality Output (Should Fail)

**Input:**
```json
{
  "test_name": "File Creation Test",
  "prompt": "Create a hello.txt file with the content 'Hello World'",
  "tool_executions": [
    {
      "toolName": "create",
      "status": "error",
      "duration": 0.05,
      "result": "Error: Permission denied"
    }
  ],
  "response_content": "Done! The file has been created successfully.",
  "execution_time_ms": 1200
}
```

**Output:**
```json
{
  "test_name": "File Creation Test",
  "scores": {
    "tool_execution_display": 8,
    "response_quality": 2,
    "markdown_rendering": 10
  },
  "overall_score": 6.7,
  "passed": false,
  "feedback": {
    "tool_execution_display": "Tool execution information is clear and complete, showing the error status and quick duration. Result message appropriately shows the permission error.",
    "response_quality": "Response is incorrect - claims success when the tool actually failed with a permission error. This is a critical accuracy issue that could mislead users.",
    "markdown_rendering": "No markdown elements present in response, so no rendering issues to evaluate."
  }
}
```

### Example 3: Medium Quality Output (Borderline Pass)

**Input:**
```json
{
  "test_name": "List Files Test",
  "prompt": "List all TypeScript files in the src directory",
  "tool_executions": [
    {
      "toolName": "bash",
      "status": "complete",
      "duration": 0.25,
      "result": "src/index.ts\nsrc/utils.ts\nsrc/types.ts"
    }
  ],
  "response_content": "Here are the TypeScript files:\n\nsrc/index.ts\nsrc/utils.ts\nsrc/types.ts\n\nFound 3 files total",
  "execution_time_ms": 2800
}
```

**Output:**
```json
{
  "test_name": "List Files Test",
  "scores": {
    "tool_execution_display": 8,
    "response_quality": 6,
    "markdown_rendering": 5
  },
  "overall_score": 6.3,
  "passed": false,
  "feedback": {
    "tool_execution_display": "Tool execution clearly shown with accurate status and duration. Result displays file list in a readable plain text format.",
    "response_quality": "Response correctly lists the files but formatting could be improved. The information is accurate but presentation lacks polish - files should ideally be in a code block or list format.",
    "markdown_rendering": "File list is shown as plain text rather than a proper markdown list or code block. Missing formatting opportunities that would improve readability."
  }
}
```

## Instructions for Evaluation

1. **Be Objective:** Base scores only on the criteria defined above
2. **Be Specific:** Provide concrete examples in feedback of what was good or what needs improvement
3. **Be Fair:** Consider context - simple tasks may have simple responses that are still high quality
4. **Be Strict on Accuracy:** Incorrect responses (like claiming success when tools failed) should score very low on response quality
5. **Consider User Experience:** Would this output be helpful and clear to an end user?
6. **Check All Elements:** Don't just skim - verify each criterion thoroughly
7. **Output JSON Only:** Do not include explanations, apologies, or any text outside the JSON object

## Critical Rules

- **NEVER** add text before or after the JSON output
- **ALWAYS** ensure overall_score is calculated as the average of the three scores
- **ALWAYS** set passed to true if overall_score >= 7.0, false otherwise
- **BE STRICT** but fair - a score of 7.0 represents "good" quality, not perfect
- **VALIDATE** that your output is valid JSON before returning it
