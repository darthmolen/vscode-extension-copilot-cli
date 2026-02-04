# INTRO

Let's reset expectations here and think through this. First, to set expectations for the feature

## Vision

We want a plan mode.

## What blocked us

the cli + sdk doesn't give us a plan mode out of the box.

## Attempts

### Solution

our first solution was an attempt to limit the cli to simulate a real planning mode. 

a) a single custom tool (update_work_plan)
b)  use availableTools for things we care about

this means we would need to use both tools and availableTools.

### Wash / Confusion

Copilot couldn't write tests to verify and when it thought it verified and made assumptions, those assumptions appear wrong.

#### Assumption 1

tools and AvailableTools can't be used together, its a logical OR.

#### Assumption 2

tools overwrote sdk tools when defined.

### Corrolaries

running planning, copilot would sometimes use task with an agent_type="explore" which is a good behavior, or other unexpected commands which were exploratory, hence the creation of other custom tools.

### What we ended up With

A blend of custom tools that were either created to allow the plan mode to do its work or block the sdk.

## Reset

### Research

Let's go back to the documentation and verify how the samples pass the tools, and more importantly, the source code, how it works. Does it merge, does it use an OR, does it disappear into the black box and we just don't know?

Write a document concerning our research from the documentation with class and line numbers and locations as our north star so that we both can study and make our own assumptions.

### Testing

We need to get 2 test integration files up to snuff.

1) we need a bare bones sdk test for testing the combination of tools (custom tools, available tools, mcp tools) to verify any assumptions we might have.
2) we need a full integration test with our own code to verify whatever fix we create based on assumptions we make from test 1 (see above) is reproduced. (both the red, and then the green).

## Checks and balances

We should use check points through commits to roll backwards and forwards as we work through this complex issu.
