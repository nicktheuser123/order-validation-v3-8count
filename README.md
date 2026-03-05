# Bubble Validation Template

A standardised template to build automated tests for nocode applications.

Validates calculations against Bubble API data. Uses Jest for testing and fetches relevant data from the Bubble API. Works for orders, subscriptions, or any data type.

## Prerequisites

- **Node.js** (v14 or later recommended)

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Environment variables**
   - Copy `.env.example` to `.env`
   - Add your Bubble API credentials: `BUBBLE_API_BASE` and `BUBBLE_API_TOKEN`

3. **Create test suites**
   - This repo includes an **Order validation** suite for GP (Guest Portal) orders.
   - Set `ORDER_ID` in `testConfig.js` to the unique ID of an order (copy from Bubble DB). The suite skips when `ORDER_ID` is empty.
   - Ask an AI: "Create a test case for [your domain]" (e.g. orders, subscriptions).
   - The AI will use the instructions in [TESTING_GUIDE.md](TESTING_GUIDE.md) to add config, create test files, and calculation modules.

4. **Run tests**
   ```bash
   npm test
   ```
   To run a single suite: `npm test -- {domain}.test.js`

5. **Record a flow (optional)** — Set `BASE_URL` in testConfig, then run `npm run record` to record a user flow with Playwright. Use the recording with Buildprint MCP to generate Jest tests (see [TESTING_GUIDE.md](TESTING_GUIDE.md) Section 11).

## Documentation

**[TESTING_GUIDE.md](TESTING_GUIDE.md)** is the canonical spec. It defines:

- How `testConfig.js` is structured and populated (lives at project root; Jest/Playwright configs live in `config/`)
- How to create test files (`tests/{domain}.test.js`)
- How to create calculator/aggregator modules (`lib/{domain}Calculator.js`)
- Playwright recording + Buildprint MCP workflow (Section 11)
- Naming conventions, import paths, and AI agent instructions

When an AI creates a test case for your domain, it follows the schemas and templates in the guide.

## Bubble API

See [Data API requests](https://manual.bubble.io/help-guides/integrations/api/the-bubble-api/the-data-api/data-api-requests) for search/constraint format.
