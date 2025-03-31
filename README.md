
# Playwright Captcha Solver

A utility library that helps solve captchas in Playwright-automated browsers.

## Status

⚠️ **Early Development**: This project is not currently ready for production use, but is working in simple captcha scenarios.

## Installation

```bash
npm install playwright-captcha-solver
# or
yarn add playwright-captcha-solver
```

## Dependencies

This library requires:
- A **Gemini API key** for image recognition
- [**Patchright**](https://github.com/link-to-patchright) - A modified version of Playwright that allows accessing closed shadow roots without being easily detected (unlike forcing them open in an init script, which can trigger anti-bot detection)

## Usage

Basic example:

```javascript
const { chromium } = require('patchright');
const { solveCaptchas } = require('playwright-captcha-solver');

async function run() {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    await page.goto('https://website-with-captcha.com');
    
    // Solve any captchas on the page
    await solveCaptchas(page);
    
    // Continue with your automation...
    
    await browser.close();
}

run();
```

## Configuration

### .env
```javascript
GEMINI_API_KEY=your_gemini_api_key
```

We are using Gemini currently because it is the cheapest option for image recognition and works well for simple captchas. 


## Contributing

Contributions are welcome! This project is in its early stages and could benefit from:

- Additional captcha type support
- Improved recognition accuracy
- Better error handling
- Documentation improvements

Please feel free to submit issues and pull requests.

## License

[MIT](LICENSE)