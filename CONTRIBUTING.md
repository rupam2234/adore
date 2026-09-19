# Code Style Guide

## Priorities

1. Clean Code
2. Performance Optimization
3. Requirements Optimization
4. Reuse

## Naming Conventions

### Constants

- UPPER_SNAKE_CASE
- Example: `ACCESS_EXPIRY`, `MAX_ITEMS`

### Types

- PascalCase
- Example: `TokenPayload`, `UserRow`

### Functions

- camelCase
- Example: `signAccessToken`, `getUserById`

### Private Functions

- _camelCase
- Example: `_privateHelper`, `_validateInput`

### Variables

- camelCase
- Example: `accessToken`, `refreshToken`

## Code Quality Standards

### Clean Code

- Single Responsibility Principle
- No code duplication
- Meaningful names
- Consistent formatting

### Performance Optimization

- Avoid unnecessary calculations
- Use constants for magic numbers
- Efficient data structures
- Minimal overhead

### Requirements Optimization

- Feature matches user needs
- Minimal dependencies
- Scalable solution
- Edge cases handled

### Reuse

- Extract common patterns to utilities
- Configurable parameters
- Generic functions where applicable
- No hardcoded values

## File Templates

### Config Files (auth.ts, db.ts, etc.)

```
/**
 * Configuration constants - centralized and reusable
 * Performance: O(1) access
 * Reuse: Exported and imported throughout codebase
 */

// 1. Exports (clean imports)
export const CONSTANT_NAME = "value";

// 2. Type definitions (if needed)
export interface Config {}

// 3. Options objects (with defaults)
export const options = {
  key: "value", // No magic numbers
};

// 4. Functions (separate concerns)
export function helper() {}
```

### Feature Files

```
/**
 * Feature Description
 *
 * Requirements:
 * 1. ...
 * 2. ...
 *
 * Implementation:
 * - Clean: Single responsibility
 * - Performance: O(n) or better
 * - Reuse: Generic where possible
 */

// Constants - centralized
export const FEATURE_CONSTANTS = {
  MAX_ITEMS: 100,
  DEFAULT_TIMEOUT: 5000,
} as const;

// Types
export interface FeatureOptions {}

// Default options (no magic numbers)
export const DEFAULT_FEATURE_OPTIONS: FeatureOptions = {
  maxItems: FEATURE_CONSTANTS.MAX_ITEMS,
  timeout: FEATURE_CONSTANTS.DEFAULT_TIMEOUT,
};

// Main function
export function mainFunction(options: FeatureOptions = {}) {
  const config = { ...DEFAULT_FEATURE_OPTIONS, ...options };
  // Implementation
}
```

## Common Patterns

### Avoid Magic Numbers

```typescript
// BEFORE
const maxItems = 100;

// AFTER
const MAX_ITEMS = 100;
const FEATURE_CONSTANTS = { maxItems: MAX_ITEMS };
```

### Extract to Constants

```typescript
// BEFORE
export const ACCESS_EXPIRY = '15m';
export const maxAge = 60 * 15;

// AFTER
export const ACCESS_EXPIRY = '1h';
export const ACCESS_EXPIRY_MS = 60 * 60 * 1000;
```

### Use Default Options

```typescript
// BEFORE
export function process(data: any) {
  const timeout = 5000;
  const retries = 3;
  // ...
}

// AFTER
export const DEFAULT_OPTIONS = {
  timeout: 5000,
  retries: 3,
} as const;

export function process(data: any, options = DEFAULT_OPTIONS) {
  const { timeout, retries } = options;
  // ...
}
```

## Checklist for PRs

- [ ] Code is clean and readable
- [ ] Performance is optimized
- [ ] Requirements are met
- [ ] Code can be reused elsewhere
- [ ] No hardcoded values
- [ ] No magic numbers
- [ ] Meaningful variable/function names
- [ ] Single Responsibility Principle
- [ ] Consistent formatting
