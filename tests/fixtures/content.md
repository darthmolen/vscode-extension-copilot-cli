# Comprehensive Markdown Test Document

This document showcases various markdown formatting features to test rendering capabilities.

## Text Formatting

Here's a paragraph with **bold text**, *italic text*, ***bold and italic***, and `inline code`. You can also use ~~strikethrough~~ for crossed-out text.

## Lists

### Unordered List

- First item with `code`
- Second item with **bold**
- Third item with nested list:
  - Nested item 1
  - Nested item 2
    - Double nested item
- Fourth item

### Ordered List

1. First step - Initialize the system
2. Second step - Configure parameters
3. Third step - Run validation
   1. Sub-step: Check dependencies
   2. Sub-step: Verify configuration
4. Fourth step - Deploy to production

## Code Blocks

### Python Example

```python
def fibonacci(n: int) -> int:
    """Calculate the nth Fibonacci number."""
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

# Usage
result = fibonacci(10)
print(f"The 10th Fibonacci number is: {result}")
```

### JavaScript Example

```javascript
// Async function to fetch user data
async function fetchUserData(userId) {
  try {
    const response = await fetch(`/api/users/${userId}`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching user:', error);
    throw error;
  }
}
```

### Bash Script

```bash
#!/bin/bash
# Deploy script with environment check

if [ "$ENVIRONMENT" == "production" ]; then
  echo "Deploying to production..."
  npm run build
  npm run deploy:prod
else
  echo "Deploying to staging..."
  npm run deploy:staging
fi
```

## Tables

| Feature | Status | Priority | Assignee |
|---------|--------|----------|----------|
| User Authentication | ✅ Complete | High | @alice |
| API Integration | 🚧 In Progress | High | @bob |
| Dashboard UI | 📋 Planned | Medium | @charlie |
| Analytics | ❌ Not Started | Low | Unassigned |

### Complex Table with Code

| Command | Description | Example |
|---------|-------------|---------|
| `git status` | Show working tree status | `git status -s` |
| `git commit` | Record changes to repository | `git commit -m "feat: add feature"` |
| `git push` | Update remote refs | `git push origin main` |

## Blockquotes

> **Important Note:**
> 
> This is a multi-line blockquote that contains important information.
> Always verify your changes before committing to the main branch.
> 
> > Nested quotes are also supported and useful for citing sources.

## Links and References

- [GitHub](https://github.com)
- [VS Code Documentation](https://code.visualstudio.com/docs)
- [Markdown Guide](https://www.markdownguide.org)

Internal link reference: See the [Code Blocks](#code-blocks) section above.

## Horizontal Rule

---

## Task Lists

- [x] Design mockups
- [x] Implement core functionality
- [ ] Write unit tests
- [ ] Update documentation
- [ ] Deploy to staging

## Mathematical Expressions

You can represent inline math like `x = y + z` or use LaTeX-style notation for more complex expressions: `E = mc^2`.

## Emoji Support

Common emojis: 🚀 ✨ 🎉 🐛 📝 ✅ ❌ 🔧 💡 ⚠️

## Mixed Content Example

### REST API Endpoints

**GET** `/api/users/{id}`

Response:
```json
{
  "id": 123,
  "name": "John Doe",
  "email": "john@example.com",
  "roles": ["admin", "user"]
}
```

**POST** `/api/users`

Request body:
```json
{
  "name": "Jane Smith",
  "email": "jane@example.com",
  "password": "secure_password_123"
}
```

---

*This document is used for testing markdown rendering in various contexts.*
