# Enhanced Browser Tools — Game-Changing Features

Upgrade the Dyad browser with advanced capabilities for UI debugging, testing, and optimization.

## What's New

### 1. DOM Manipulator (`dom_manipulator.ts`)

**Direct DOM access with power tools:**

- **Inject CSS** — Test design changes instantly
- **Modify Elements** — Change attributes, styles, text, HTML
- **Create Elements** — Add new DOM elements dynamically
- **Remove Elements** — Delete elements from the page
- **Simulate Events** — Dispatch click, input, focus events
- **Analyze Layout** — Visualize box model, grid, flexbox
- **Inspect Accessibility** — Check ARIA labels and keyboard nav
- **Profile Performance** — Identify slow-rendering elements
- **Query Elements** — Extract attributes from multiple elements
- **Get XPath** — Convert CSS selectors to XPath
- **Get Computed Styles** — Read CSS values programmatically

### 2. Network Interceptor (`network_interceptor.ts`)

**Control network traffic for testing:**

- **Mock Responses** — Return custom API responses
- **Throttle Network** — Simulate slow-3g, offline, etc.
- **Log Requests** — Capture all network traffic
- **Simulate Errors** — Force timeout, server-error, etc.
- **Clear Mocks** — Remove all active interceptors

### 3. Performance Profiler (`performance_profiler.ts`)

**Deep performance analysis:**

- **Core Web Vitals** — LCP, FID, CLS, TTFB, FCP, TBT
- **Resource Analysis** — Profile scripts, images, fonts
- **Memory Profiling** — Track JavaScript heap usage
- **Render Profiling** — Monitor layout/paint operations
- **JavaScript Profiling** — Find slow functions
- **Bundle Analysis** — Analyze script sizes and dependencies
- **Custom Metrics** — Create performance marks and measures

## Installation

Add to your Dyad tools directory:

```bash
# Copy the enhanced tools
cp enhanced/*.ts /path/to/dyad/src/pro/main/ipc/handlers/local_agent/tools/

# Register in tool_definitions.ts
# Add imports and register each tool
```

## Usage Examples

### DOM Manipulation

```typescript
// Inject debugging border
{action: "inject_style", css: "*, *::before, *::after { outline: 1px solid red !important; }"}

// Add a debug banner
{action: "create_element", tag: "div", styles: {position: "fixed", top: "0", background: "blue", color: "white", padding: "10px"}, text: "Debug Mode"}

// Analyze grid layout
{action: "analyze_layout", selector: ".grid-container", show_grid: true}

// Check accessibility
{action: "inspect_accessibility", include_aria: true}
```

### Network Interception

```typescript
// Mock API response
{action: "mock_response", url_pattern: "/api/users*", status: 200, body: '{"users": []}'}

// Simulate offline
{action: "throttle_network", profile: "offline"}

// Log failed requests
{action: "log_requests", status: 400}

// Simulate server error
{action: "simulate_error", url_pattern: "/api/orders*", error_type: "server-error", status: 500}
```

### Performance Profiling

```typescript
// Measure Core Web Vitals
{action: "measure_web_vitals"}

// Profile image resources
{action: "profile_resources", resource_type: "image", sort_by: "size"}

// Analyze bundle
{action: "analyze_bundle"}

// Profile memory usage
{action: "profile_memory"}
```

## Architecture

```
Enhanced Browser Tools
├── DOM Manipulator
│   ├── CSS Injection
│   ├── Element Manipulation
│   ├── Event Simulation
│   ├── Layout Analysis
│   └── Accessibility Inspection
├── Network Interceptor
│   ├── Request Mocking
│   ├── Network Throttling
│   ├── Traffic Logging
│   └── Error Simulation
└── Performance Profiler
    ├── Core Web Vitals
    ├── Resource Analysis
    ├── Memory Profiling
    ├── Render Profiling
    └── Bundle Analysis
```

## Game-Changing Use Cases

1. **Rapid UI Prototyping** — Inject styles to test design changes instantly
2. **API Development** — Mock responses before backend is ready
3. **Error Testing** — Test error handling without real failures
4. **Performance Optimization** — Identify bottlenecks with Core Web Vitals
5. **Accessibility Auditing** — Check ARIA labels and keyboard navigation
6. **Bundle Optimization** — Reduce JavaScript bundle size
7. **Memory Leak Detection** — Find and fix memory leaks
8. **Layout Debugging** — Visualize grid/flexbox gaps
9. **Network Debugging** — Inspect all traffic in real-time
10. **Edge Case Testing** — Test offline mode, rate limiting
