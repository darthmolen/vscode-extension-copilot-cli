/**
 * Test Scenarios for Copilot CLI Extension v2 SDK Integration
 * 
 * Each scenario exercises different aspects of the extension:
 * - Tool execution tracking and display
 * - Response rendering (markdown, code blocks, mixed content)
 * - MCP integration
 * - Multi-step operations
 * 
 * @module scenarios
 */

/**
 * @typedef {Object} TestScenario
 * @property {string} name - Display name for the test
 * @property {string} description - What this scenario tests
 * @property {string} prompt - The prompt to send to the agent
 * @property {string[]} expectedTools - Tools expected to be called during execution
 * @property {string} evaluationNotes - Criteria for judging success
 */

/**
 * Test scenarios covering various extension capabilities
 * @type {TestScenario[]}
 */
const scenarios = [
  {
    name: "File Creation Test",
    description: "Tests file creation tool execution and visual feedback for multiple file operations",
    prompt: "Create 3 files: hello.txt with 'Hello', world.txt with 'World', and test.txt with 'Test'",
    expectedTools: ["create", "create", "create"],
    evaluationNotes: "Verify: (1) Three separate tool execution indicators appear, (2) Each shows the file path being created, (3) Response confirms successful creation, (4) Execution time is displayed"
  },

  {
    name: "Code Reading Test",
    description: "Tests file reading and code explanation capabilities",
    prompt: "Read tests/fixtures/sample.py and explain what it does in 2-3 sentences",
    expectedTools: ["view"],
    evaluationNotes: "Verify: (1) Tool indicator shows 'view' operation, (2) Response contains concise explanation, (3) Explanation references specific functions/features from the file, (4) Response is properly formatted"
  },

  {
    name: "Markdown Rendering Test",
    description: "Tests markdown content reading and table rendering",
    prompt: "Read tests/fixtures/content.md and show me the table of programming languages with a brief summary of what this document demonstrates",
    expectedTools: ["view"],
    evaluationNotes: "Verify: (1) Markdown tables render correctly in output, (2) Summary captures key points, (3) Response formatting is clean and readable, (4) Code blocks (if any) are syntax-highlighted"
  },

  {
    name: "Code Fix Test",
    description: "Tests code analysis without modification - bug detection and style checking",
    prompt: "Read tests/fixtures/BrokenClass.cs and list all the bugs and style violations you find. Don't fix them yet, just list them.",
    expectedTools: ["view"],
    evaluationNotes: "Verify: (1) Tool shows file read operation, (2) Response lists specific issues found, (3) Issues are categorized (bugs vs style), (4) No file modification tools are called, (5) List is formatted clearly"
  },

  {
    name: "Plan Analysis Test",
    description: "Tests markdown document analysis and summarization",
    prompt: "Read tests/fixtures/implementation-plan.md and summarize the project timeline and key risks",
    expectedTools: ["view"],
    evaluationNotes: "Verify: (1) Response extracts timeline information, (2) Risks section is identified and summarized, (3) Summary is concise yet comprehensive, (4) Markdown formatting from source is preserved where relevant"
  },

  {
    name: "Mixed Content Test",
    description: "Tests response with both code generation and explanatory text",
    prompt: "Create a simple Python function that calculates fibonacci numbers, then explain how it works with examples showing fib(5) and fib(10)",
    expectedTools: [],
    evaluationNotes: "Verify: (1) Code block is syntax-highlighted, (2) Explanation follows code naturally, (3) Examples with actual calculations are shown, (4) Mixed markdown and code render correctly, (5) No file operations (code is inline)"
  },

  {
    name: "Tool Chain Test",
    description: "Tests sequential tool execution - read then create based on read content",
    prompt: "Read tests/fixtures/sample.py, then create a new file called summary.txt that contains a 1-line description of what sample.py does",
    expectedTools: ["view", "create"],
    evaluationNotes: "Verify: (1) Two distinct tool indicators appear (view, then create), (2) Tools execute in correct order, (3) Created file path is shown, (4) Response confirms both operations, (5) Summary is actually derived from file content"
  },

  {
    name: "MCP Integration Test",
    description: "Tests Model Context Protocol tool integration and chaining",
    prompt: "Use the get_test_data MCP tool with key 'sample' and show me the result, then validate it's proper JSON format using validate_format",
    expectedTools: ["get_test_data", "validate_format"],
    evaluationNotes: "Verify: (1) MCP tool indicators show custom tool names, (2) Tool parameters are visible (key='sample'), (3) Results from first tool feed into second, (4) JSON validation result is clear, (5) MCP tools are visually distinguished from built-in tools"
  }
];

module.exports = scenarios;
