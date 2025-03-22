export default {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testPathIgnorePatterns: [
        "/node_modules/",
        "/playwright/" // Exclude Playwright tests directory
    ]
};
