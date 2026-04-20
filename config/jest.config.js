const path = require("path");

module.exports = {
  rootDir: path.join(__dirname, ".."),
  testEnvironment: "node",
  setupFiles: ["<rootDir>/config/jest.setup.js"],
  testMatch: ["<rootDir>/tests/**/*.test.js", "<rootDir>/e2e-gp-testing/tests/**/*.test.js"],
  testTimeout: 120000, // 2 min for async Bubble API calls
  maxWorkers: 1, // runInBand equivalent - avoids Jest worker serialization issues
  passWithNoTests: true, // Template ships with no tests; pass until user adds suites
  silent: false,
  verbose: true,
  reporters: [
    "default",
    "<rootDir>/config/jestMarkdownReporter.js"
  ]
};
