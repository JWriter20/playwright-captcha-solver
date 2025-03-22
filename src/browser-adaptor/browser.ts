import type { Browser as PlaywrightBrowser } from 'playwright';
import { BrowserContext, defaultBrowserContextConfig } from './context.js';
import type { BrowserContextConfig } from './context.js';

// Define a local type for proxy settings.
export interface ProxySettings {
    server: string;
    bypass?: string;
    username?: string;
    password?: string;
}

// ──────────────────────────────
// Browser configuration types and defaults
// ──────────────────────────────

export interface BrowserConfig {
    headless: boolean;
    disableSecurity: boolean;
    extraChromiumArgs: string[];
    chromeInstancePath?: string | null;
    wssUrl?: string | null;
    cdpUrl?: string | null;
    proxy?: ProxySettings | null;
    newContextConfig: BrowserContextConfig;
    _forceKeepBrowserAlive: boolean;
}

export const defaultBrowserConfig: BrowserConfig = {
    headless: false,
    disableSecurity: true,
    extraChromiumArgs: [],
    chromeInstancePath: null,
    wssUrl: null,
    cdpUrl: null,
    proxy: null,
    newContextConfig: defaultBrowserContextConfig,
    _forceKeepBrowserAlive: false,
};

// ──────────────────────────────
// Browser class – wrapping an existing Playwright browser instance
// ──────────────────────────────

export class Browser {
    config: BrowserConfig;
    private playwrightBrowser: PlaywrightBrowser | null;

    /**
     * Create a new Browser wrapper.
     *
     * @param config Optional browser configuration.
     * @param playwrightBrowser An existing PlaywrightBrowser instance.
     */
    constructor(
        config: Partial<BrowserConfig> = {},
        playwrightBrowser?: PlaywrightBrowser
    ) {
        console.debug('Initializing new browser wrapper');
        this.config = { ...defaultBrowserConfig, ...config };
        this.playwrightBrowser = playwrightBrowser || null;
    }

    /**
     * Create a new browser context using the wrapped browser.
     * This wraps the existing browser into a BrowserContext instance.
     *
     * @param config Optional BrowserContext configuration overrides.
     */
    async newContext(config: Partial<BrowserContextConfig> = {}): Promise<BrowserContext> {
        const contextConfig: BrowserContextConfig = { ...this.config.newContextConfig, ...config };
        // Pass 'this' so that the context can later call getPlaywrightBrowser().
        return new BrowserContext(this, contextConfig);
    }

    /**
     * Return the wrapped Playwright browser instance.
     * Throws an error if none was provided.
     */
    async getPlaywrightBrowser(): Promise<PlaywrightBrowser> {
        if (!this.playwrightBrowser) {
            throw new Error("Playwright browser instance not provided.");
        }
        return this.playwrightBrowser;
    }

    /**
     * Close the wrapped browser.
     */
    async close(): Promise<void> {
        try {
            if (!this.config._forceKeepBrowserAlive && this.playwrightBrowser) {
                await this.playwrightBrowser.close();
            }
        } catch (e) {
            console.debug(`Failed to close browser properly: ${e}`);
        } finally {
            this.playwrightBrowser = null;
        }
    }
}
