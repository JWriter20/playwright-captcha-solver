import type { ElementHandle, FrameLocator, Page, Browser as PlaywrightBrowser, BrowserContext as PlaywrightBrowserContext } from 'playwright-core';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Custom types – adjust import paths as needed.
import { BrowserError, BrowserState, TabInfo, URLNotAllowedError } from './view.js';
import { DomService } from '../dom/service.js';
import type { DOMElementNode, SelectorMap } from '../dom/views.js';
import { Browser } from './browser.js';
import { getAllIframeNodes, detectCaptchas, detectCaptchaFromSrc } from '../find-captcha/get-active-captchas.js';
import { CssSelectorHelper } from './browser-helper-funcs.js';
import { CaptchaAction } from 'src/llm-connectors/llm-connector.js';

// ──────────────────────────────
// Types and default configuration
// ──────────────────────────────

export interface BrowserContextWindowSize {
	width: number;
	height: number;
}

export interface BrowserContextConfig {
	cookiesFile?: string | null;
	minimumWaitPageLoadTime: number;
	waitForNetworkIdlePageLoadTime: number;
	maximumWaitPageLoadTime: number;
	waitBetweenActions: number;
	disableSecurity: boolean;
	browserWindowSize: BrowserContextWindowSize;
	noViewport?: boolean | null;
	saveRecordingPath?: string | null;
	saveDownloadsPath?: string | null;
	tracePath?: string | null;
	locale?: string | null;
	userAgent: string;
	highlightElements: boolean;
	viewportExpansion: number;
	allowedDomains?: string[] | null;
	includeDynamicAttributes: boolean;
	_forceKeepContextAlive: boolean;
}

export const defaultBrowserContextConfig: BrowserContextConfig = {
	cookiesFile: null,
	minimumWaitPageLoadTime: 0.25,
	waitForNetworkIdlePageLoadTime: 0.5,
	maximumWaitPageLoadTime: 5,
	waitBetweenActions: 0.5,
	disableSecurity: true,
	browserWindowSize: { width: 1280, height: 1100 },
	noViewport: null,
	saveRecordingPath: null,
	saveDownloadsPath: null,
	tracePath: null,
	locale: null,
	userAgent:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.102 Safari/537.36',
	highlightElements: true,
	viewportExpansion: 500,
	allowedDomains: null,
	includeDynamicAttributes: true,
	_forceKeepContextAlive: false,
};

export interface BrowserSession {
	context: PlaywrightBrowserContext;
	cachedState: BrowserState | null;
}

export interface BrowserContextState {
	targetId?: string | null;
}

// ──────────────────────────────
// Main BrowserContext class
// ──────────────────────────────

export class BrowserContext {
	private contextId: string;
	private config: BrowserContextConfig;
	private browser: Browser; // Replace with your Browser type if available.
	private state: BrowserContextState;
	private session: BrowserSession | null = null;
	private currentState?: BrowserState;
	private pageEventHandler?: (page: Page) => Promise<void>;

	constructor(browser: Browser, config?: Partial<BrowserContextConfig>, state?: BrowserContextState) {
		this.contextId = uuidv4();
		console.debug(`Initializing new browser context with id: ${this.contextId}`);
		this.config = { ...defaultBrowserContextConfig, ...config };
		this.browser = browser;
		this.state = state || {};
	}

	/**
	 * Initialize the browser session.
	 * (Analogous to Python’s async context manager __aenter__)
	 */
	async init(): Promise<this> {
		await this._initializeSession();
		return this;
	}

	/**
	 * Close the browser context.
	 * (Analogous to __aexit__ or __del__ in Python)
	 */
	async close(): Promise<void> {
		console.debug('Closing browser context');
		try {
			if (!this.session) return;

			// Remove page event listener if set.
			if (this.pageEventHandler && this.session.context) {
				try {
					this.session.context.off('page', this.pageEventHandler);
				} catch (e) {
					console.debug(`Failed to remove page event listener: ${e}`);
				}
				this.pageEventHandler = undefined;
			}

			await this.saveCookies();

			if (this.config.tracePath) {
				try {
					await this.session.context.tracing.stop({
						path: path.join(this.config.tracePath, `${this.contextId}.zip`),
					});
				} catch (e) {
					console.debug(`Failed to stop tracing: ${e}`);
				}
			}

			if (!this.config._forceKeepContextAlive) {
				try {
					await this.session.context.close();
				} catch (e) {
					console.debug(`Failed to close context: ${e}`);
				}
			}
		} finally {
			this.session = null;
			this.pageEventHandler = undefined;
		}
	}

	// ──────────────────────────────
	// Session initialization and helpers
	// ──────────────────────────────

	private async _initializeSession(): Promise<BrowserSession> {
		console.debug('Initializing browser context');
		const playwrightBrowser: PlaywrightBrowser = await this.browser.getPlaywrightBrowser();
		const context = await this._createContext(playwrightBrowser);
		this.pageEventHandler = undefined;

		const pages = context.pages();
		this.session = { context, cachedState: null };

		let activePage: Page | undefined;
		if (this.browser.config.cdpUrl) {
			if (this.state.targetId) {
				const targets = await this._getCdpTargets();
				for (const target of targets) {
					if (target.targetId === this.state.targetId) {
						for (const page of pages) {
							if (page.url() === target.url) {
								activePage = page;
								break;
							}
						}
						break;
					}
				}
			}
		}

		if (!activePage) {
			if (pages.length > 0) {
				activePage = pages[0];
				console.debug('Using existing page');
			} else {
				activePage = await context.newPage();
				console.debug('Created new page');
			}
			if (this.browser.config.cdpUrl) {
				const targets = await this._getCdpTargets();
				for (const target of targets) {
					if (target.url === activePage.url()) {
						this.state.targetId = target.targetId;
						break;
					}
				}
			}
		}

		await activePage.bringToFront();
		await activePage.waitForLoadState('load');
		return this.session;
	}

	private _addNewPageListener(context: PlaywrightBrowserContext): void {
		const onPage = async (page: Page) => {
			if (this.browser.config.cdpUrl) {
				await page.reload(); // Reload to avoid timeout errors
			}
			await page.waitForLoadState();
			console.debug(`New page opened: ${page.url()}`);
			if (this.session) {
				this.state.targetId = null;
			}
		};
		this.pageEventHandler = onPage;
		context.on('page', onPage);
	}

	async getSession(): Promise<BrowserSession> {
		if (!this.session) {
			return await this._initializeSession();
		}
		return this.session;
	}

	async getCurrentPage(): Promise<Page> {
		const session = await this.getSession();
		return await this._getCurrentPage(session);
	}

	private async _createContext(browser: PlaywrightBrowser): Promise<PlaywrightBrowserContext> {
		let context: PlaywrightBrowserContext;
		if (this.browser.config.cdpUrl && browser.contexts().length > 0) {
			context = browser.contexts()[0];
		} else if (this.browser.config.chromeInstancePath && browser.contexts().length > 0) {
			context = browser.contexts()[0];
		} else {
			context = await browser.newContext({
				viewport: this.config.browserWindowSize,
				userAgent: this.config.userAgent,
				javaScriptEnabled: true,
				bypassCSP: this.config.disableSecurity,
				ignoreHTTPSErrors: this.config.disableSecurity,
				recordVideo: this.config.saveRecordingPath
					? { dir: this.config.saveRecordingPath, size: this.config.browserWindowSize }
					: undefined,
				locale: this.config.locale || undefined,
			});
		}

		if (this.config.tracePath) {
			await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
		}

		if (this.config.cookiesFile && fs.existsSync(this.config.cookiesFile)) {
			const cookies = JSON.parse(fs.readFileSync(this.config.cookiesFile, 'utf8'));
			console.info(`Loaded ${cookies.length} cookies from ${this.config.cookiesFile}`);
			await context.addCookies(cookies);
		}
		await context.addInitScript({
			content: `
        // Webdriver property
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        // Languages
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US'] });
        // Plugins
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        // Chrome runtime
        window.chrome = { runtime: {} };
        // Permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) =>
          parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery(parameters);
        (function () {
          const originalAttachShadow = Element.prototype.attachShadow;
          Element.prototype.attachShadow = function attachShadow(options) {
            return originalAttachShadow.call(this, { ...options, mode: "open" });
          };
        })();
      `,
		});
		return context;
	}

	private async _getCurrentPage(session: BrowserSession): Promise<Page> {
		const pages = session.context.pages();
		if (this.browser.config.cdpUrl && this.state.targetId) {
			const targets = await this._getCdpTargets();
			for (const target of targets) {
				if (target.targetId === this.state.targetId) {
					for (const page of pages) {
						if (page.url() === target.url) {
							return page;
						}
					}
				}
			}
		}
		return pages.length > 0 ? pages[pages.length - 1] : await session.context.newPage();
	}

	// ──────────────────────────────
	// Network and navigation methods
	// ──────────────────────────────

	private async _waitForStableNetwork(): Promise<void> {
		const page = await this.getCurrentPage();
		const pendingRequests = new Set<any>();
		let lastActivity = Date.now();

		const RELEVANT_RESOURCE_TYPES = new Set(['document', 'stylesheet', 'image', 'font', 'script', 'iframe']);
		const RELEVANT_CONTENT_TYPES = ['text/html', 'text/css', 'application/javascript', 'image/', 'font/', 'application/json'];
		const IGNORED_URL_PATTERNS = [
			'analytics', 'tracking', 'telemetry', 'beacon', 'metrics',
			'doubleclick', 'adsystem', 'adserver', 'advertising',
			'facebook.com/plugins', 'platform.twitter', 'linkedin.com/embed',
			'livechat', 'zendesk', 'intercom', 'crisp.chat', 'hotjar',
			'push-notifications', 'onesignal', 'pushwoosh',
			'heartbeat', 'ping', 'alive',
			'webrtc', 'rtmp://', 'wss://',
			'cloudfront.net', 'fastly.net'
		];

		const onRequest = (request: any) => {
			if (!RELEVANT_RESOURCE_TYPES.has(request.resourceType())) return;
			if (['websocket', 'media', 'eventsource', 'manifest', 'other'].includes(request.resourceType())) return;
			const url = request.url().toLowerCase();
			if (IGNORED_URL_PATTERNS.some(pattern => url.includes(pattern))) return;
			if (url.startsWith('data:') || url.startsWith('blob:')) return;
			const headers = request.headers();
			if (headers['purpose'] === 'prefetch' || ['video', 'audio'].includes(headers['sec-fetch-dest'])) return;
			pendingRequests.add(request);
			lastActivity = Date.now();
		};

		const onResponse = (response: any) => {
			const request = response.request();
			if (!pendingRequests.has(request)) return;
			const contentType = (response.headers()['content-type'] || '').toLowerCase();
			if (['streaming', 'video', 'audio', 'webm', 'mp4', 'event-stream', 'websocket', 'protobuf'].some(t => contentType.includes(t))) {
				pendingRequests.delete(request);
				return;
			}
			if (!RELEVANT_CONTENT_TYPES.some(ct => contentType.includes(ct))) {
				pendingRequests.delete(request);
				return;
			}
			const contentLength = response.headers()['content-length'];
			if (contentLength && parseInt(contentLength) > 5 * 1024 * 1024) {
				pendingRequests.delete(request);
				return;
			}
			pendingRequests.delete(request);
			lastActivity = Date.now();
		};

		page.on('request', onRequest);
		page.on('response', onResponse);

		try {
			const startTime = Date.now();
			while (true) {
				await new Promise((res) => setTimeout(res, 100));
				const now = Date.now();
				if (pendingRequests.size === 0 && (now - lastActivity) >= this.config.waitForNetworkIdlePageLoadTime * 1000) break;
				if (now - startTime > this.config.maximumWaitPageLoadTime * 1000) {
					console.debug(
						`Network timeout after ${this.config.maximumWaitPageLoadTime}s with ${pendingRequests.size} pending requests: ${Array.from(
							pendingRequests
						).map((r) => r.url())}`
					);
					break;
				}
			}
		} finally {
			page.off('request', onRequest);
			page.off('response', onResponse);
		}
		console.debug(`Network stabilized for ${this.config.waitForNetworkIdlePageLoadTime} seconds`);
	}

	private async _waitForPageAndFramesLoad(timeoutOverwrite?: number): Promise<void> {
		const startTime = Date.now();
		try {
			await this._waitForStableNetwork();
			const page = await this.getCurrentPage();
			await this._checkAndHandleNavigation(page);
		} catch (e) {
			if (e instanceof URLNotAllowedError) throw e;
			console.warn('Page load failed, continuing...');
		}
		const elapsed = (Date.now() - startTime) / 1000;
		const remaining = Math.max((timeoutOverwrite || this.config.minimumWaitPageLoadTime) - elapsed, 0);
		console.debug(`--Page loaded in ${elapsed.toFixed(2)} seconds, waiting for additional ${remaining.toFixed(2)} seconds`);
		if (remaining > 0) {
			await new Promise((res) => setTimeout(res, remaining * 1000));
		}
	}

	private _isUrlAllowed(url: string): boolean {
		if (!this.config.allowedDomains) return true;
		try {
			const parsed = new URL(url);
			let domain = parsed.hostname.toLowerCase();
			if (domain.includes(':')) {
				domain = domain.split(':')[0];
			}
			return this.config.allowedDomains.some((allowed) => {
				const allowedLower = allowed.toLowerCase();
				return domain === allowedLower || domain.endsWith(`.${allowedLower}`);
			});
		} catch (e) {
			console.error(`Error checking URL allowlist: ${e}`);
			return false;
		}
	}

	private async _checkAndHandleNavigation(page: Page): Promise<void> {
		if (!this._isUrlAllowed(page.url())) {
			console.warn(`Navigation to non-allowed URL detected: ${page.url()}`);
			try {
				await this.goBack();
			} catch (e) {
				console.error(`Failed to go back after detecting non-allowed URL: ${e}`);
			}
			throw new URLNotAllowedError(`Navigation to non-allowed URL: ${page.url()}`);
		}
	}

	async navigateTo(url: string): Promise<void> {
		if (!this._isUrlAllowed(url)) {
			throw new BrowserError(`Navigation to non-allowed URL: ${url}`);
		}
		const page = await this.getCurrentPage();
		await page.goto(url);
		await page.waitForLoadState();
	}

	async refreshPage(): Promise<void> {
		const page = await this.getCurrentPage();
		await page.reload();
		await page.waitForLoadState();
	}

	async goBack(): Promise<void> {
		const page = await this.getCurrentPage();
		try {
			await page.goBack({ timeout: 10, waitUntil: 'domcontentloaded' });
		} catch (e) {
			console.debug(`During goBack: ${e}`);
		}
	}

	async goForward(): Promise<void> {
		const page = await this.getCurrentPage();
		try {
			await page.goForward({ timeout: 10, waitUntil: 'domcontentloaded' });
		} catch (e) {
			console.debug(`During goForward: ${e}`);
		}
	}

	async closeCurrentTab(): Promise<void> {
		const session = await this.getSession();
		const page = await this._getCurrentPage(session);
		await page.close();

		if (session.context.pages().length > 0) {
			await this.switchToTab(0);
		}
	}

	async getPageHtml(): Promise<string> {
		const page = await this.getCurrentPage();
		return await page.content();
	}

	async executeJavaScript(script: string): Promise<any> {
		const page = await this.getCurrentPage();
		return await page.evaluate(script);
	}

	async getPageStructure(): Promise<string> {
		const debugScript = `(() => {
      function getPageStructure(element = document, depth = 0, maxDepth = 10) {
        if (depth >= maxDepth) return '';
        const indent = '  '.repeat(depth);
        let structure = '';
        const skipTags = new Set(['script', 'style', 'link', 'meta', 'noscript']);
        if (element !== document) {
          const tagName = element.tagName.toLowerCase();
          if (skipTags.has(tagName)) return '';
          const id = element.id ? '#' + element.id : '';
          const classes = element.className && typeof element.className === 'string'
            ? '.' + element.className.split(' ').filter(c => c).join('.')
            : '';
          const attrs: string[] = [];
          if (element.getAttribute('role')) attrs.push(\`role="\${element.getAttribute('role')}"\`);
          if (element.getAttribute('aria-label')) attrs.push(\`aria-label="\${element.getAttribute('aria-label')}"\`);
          if (element.getAttribute('type')) attrs.push(\`type="\${element.getAttribute('type')}"\`);
          if (element.getAttribute('name')) attrs.push(\`name="\${element.getAttribute('name')}"\`);
          if (element.getAttribute('src')) {
            const src = element.getAttribute('src');
            attrs.push(\`src="\${src.substring(0, 50)}\${src.length > 50 ? '...' : ''}"\`);
          }
          structure += \`\${indent}\${tagName}\${id}\${classes}\${attrs.length ? ' [' + attrs.join(', ') + ']' : ''}\\n\`;
          if (tagName === 'iframe') {
            try {
              const iframeDoc = element.contentDocument || element.contentWindow?.document;
              if (iframeDoc) {
                structure += \`\${indent}  [IFRAME CONTENT]:\\n\`;
                structure += getPageStructure(iframeDoc, depth + 2, maxDepth);
              } else {
                structure += \`\${indent}  [IFRAME: No access - likely cross-origin]\\n\`;
              }
            } catch (e) {
              structure += \`\${indent}  [IFRAME: Access denied - \${e.message}]\\n\`;
            }
          }
        }
        const children = element.children || element.childNodes;
        for (const child of children) {
          if (child.nodeType === 1) {
            structure += getPageStructure(child, depth + 1, maxDepth);
          }
        }
        return structure;
      }
      return getPageStructure();
    })()`;
		const page = await this.getCurrentPage();
		return await page.evaluate(debugScript);
	}

	async getState(): Promise<BrowserState> {
		await this._waitForPageAndFramesLoad();
		const session = await this.getSession();
		session.cachedState = await this._updateState();

		if (this.config.cookiesFile) {
			// Fire-and-forget saving of cookies.
			this.saveCookies();
		}
		return session.cachedState!;
	}

	public queueCaptchaAction(action: CaptchaAction) {
		if (this.currentState) {
			this.currentState.pendingActions.push(action);
		}
	}

	public async solveCaptcha(): Promise<void> {

	}

	private async _updateState(focusElement: number = -1): Promise<BrowserState> {
		const session = await this.getSession();
		let page: Page;
		try {
			page = await this.getCurrentPage();
			await page.evaluate('1');
		} catch (e) {
			console.debug(`Current page is no longer accessible: ${e}`);
			const pages = session.context.pages();
			if (pages.length > 0) {
				this.state.targetId = null;
				page = await this._getCurrentPage(session);
				console.debug(`Switched to page: ${await page.title()}`);
			} else {
				throw new BrowserError('Browser closed: no valid pages available');
			}
		}
		try {
			await this.removeHighlights();
			const domService = new DomService(page);
			let content = await domService.getClickableElements(
				this.config.highlightElements,
				focusElement,
				this.config.viewportExpansion,
				this.currentState?.pendingActions ?? []
			);
			const screenshotB64 = await this.takeScreenshot();
			const captcha = detectCaptchas(content.elementTree);
			let captchaScreenshotB64 = undefined;
			if (captcha && captcha.present) {
				captchaScreenshotB64 = await this.takeScreenshot(true, captcha.element);
			}
			const [pixelsAbove, pixelsBelow] = await this.getScrollInfo(page);

			this.currentState = {
				elementTree: content.elementTree,
				selectorMap: content.selectorMap,
				url: page.url(),
				title: await page.title(),
				tabs: await this.getTabsInfo(),
				screenshot: screenshotB64,
				captchaScreenshot: captchaScreenshotB64,
				pixelsAbove,
				pixelsBelow,
				browserErrors: [], // Added missing required property
				pendingActions: this.currentState?.pendingActions ?? [],
				pastActions: this.currentState?.pastActions ?? [],
			};

			return this.currentState;
		} catch (e) {
			console.error(`Failed to update state: ${e}`);
			if (this.currentState) {
				return this.currentState;
			}
			throw e;
		}
	}

	// ──────────────────────────────
	// Browser actions
	// ──────────────────────────────

	async takeScreenshot(fullPage: boolean = false, element: DOMElementNode = null): Promise<string> {
		const page = await this.getCurrentPage();
		await page.bringToFront();
		await page.waitForLoadState();

		if (element) {
			const elementHandle = await this.getLocateElement(element);
			if (!elementHandle) {
				throw new BrowserError(`Element not found: ${element}`);
			}
			const boundingBox = await elementHandle.boundingBox();
			if (!boundingBox) {
				throw new BrowserError(`Could not determine bounding box for element: ${element}`);
			}

			// Use the bounding box to take a clipped screenshot of the page.
			const screenshotBuffer = await page.screenshot({
				clip: {
					x: boundingBox.x,
					y: boundingBox.y,
					width: boundingBox.width,
					height: boundingBox.height,
				},
				animations: 'disabled'
			});
			return Buffer.from(screenshotBuffer).toString('base64');
		}

		// Fallback: capture a screenshot of the full page (or viewport).
		const screenshotBuffer = await page.screenshot({ fullPage, animations: 'disabled' });
		return Buffer.from(screenshotBuffer).toString('base64');
	}

	async removeHighlights(): Promise<void> {
		try {
			const page = await this.getCurrentPage();
			await page.evaluate(() => {
				try {
					const container = document.getElementById('playwright-highlight-container');
					if (container) {
						container.remove();
					}
					const highlightedElements = document.querySelectorAll('[browser-user-highlight-id^="playwright-highlight-"]');
					highlightedElements.forEach(el => {
						el.removeAttribute('browser-user-highlight-id');
					});
				} catch (e) {
					console.error('Failed to remove highlights:', e);
				}
			});
		} catch (e) {
			console.debug(`Failed to remove highlights (this is usually ok): ${e}`);
		}
	}

	async getLocateElement(element: DOMElementNode): Promise<ElementHandle | null> {
		let currentFrame: Page | FrameLocator = await this.getCurrentPage();

		// Build parent chain.
		const parents: DOMElementNode[] = [];
		let current = element;
		while (current.parent) {
			parents.push(current.parent);
			current = current.parent;
		}
		parents.reverse();

		// Process iframe parents.
		const iframes = parents.filter(item => item.tagName === 'iframe');
		for (const parent of iframes) {
			const cssSelector = CssSelectorHelper.enhancedCssSelectorForElement(parent, this.config.includeDynamicAttributes);
			currentFrame = (currentFrame as Page).frameLocator(cssSelector);
		}

		const cssSelector = CssSelectorHelper.enhancedCssSelectorForElement(element, this.config.includeDynamicAttributes);

		try {
			if ((currentFrame as FrameLocator).locator) {
				const locator = (currentFrame as FrameLocator).locator(cssSelector);
				return await locator.elementHandle();
			} else {
				const elementHandle = await (currentFrame as Page).$(cssSelector);
				if (elementHandle) {
					await elementHandle.scrollIntoViewIfNeeded();
					return elementHandle;
				}
				return null;
			}
		} catch (e) {
			console.error(`Failed to locate element: ${e}`);
			return null;
		}
	}

	async _inputTextElementNode(elementNode: DOMElementNode, text: string): Promise<void> {
		try {
			const elementHandle = await this.getLocateElement(elementNode);
			if (!elementHandle) {
				throw new BrowserError(`Element not found: ${JSON.stringify(elementNode)}`);
			}
			try {
				await elementHandle.waitForElementState('stable', { timeout: 1000 });
				await elementHandle.scrollIntoViewIfNeeded({ timeout: 1000 });
			} catch (e) {
				// Ignore timing issues.
			}
			const tagName = (await elementHandle.evaluate((el: HTMLElement) => el.tagName)).toLowerCase();
			const isContentEditable = await elementHandle.evaluate((el: HTMLElement) => el.isContentEditable);
			const readonly = await elementHandle.evaluate((el) => (el as any).readOnly || false);
			const disabled = await elementHandle.evaluate((el) => (el as any).disabled || false);
			if ((isContentEditable || tagName === 'input') && !readonly && !disabled) {
				await elementHandle.evaluate((el) => { el.textContent = ""; });
				await elementHandle.type(text, { delay: 5 });
			} else {
				await elementHandle.fill(text);
			}
		} catch (e) {
			console.debug(`Failed to input text into element: ${JSON.stringify(elementNode)}. Error: ${e}`);
			throw new BrowserError(`Failed to input text into index ${elementNode.highlightIndex}`);
		}
	}

	async _clickElementNode(elementNode: DOMElementNode): Promise<string | null> {
		const page = await this.getCurrentPage();
		try {
			const elementHandle = await this.getLocateElement(elementNode);
			if (!elementHandle) {
				throw new Error(`Element not found: ${JSON.stringify(elementNode)}`);
			}
			const performClick = async (clickFunc: () => Promise<void>): Promise<string | null> => {
				if (this.config.saveDownloadsPath) {
					try {
						const [download] = await Promise.all([
							page.waitForEvent('download', { timeout: 5000 }),
							clickFunc(),
						]);
						const suggestedFilename = download.suggestedFilename();
						const uniqueFilename = await this._getUniqueFilename(this.config.saveDownloadsPath, suggestedFilename);
						const downloadPath = path.join(this.config.saveDownloadsPath, uniqueFilename);
						await download.saveAs(downloadPath);
						console.debug(`Download triggered. Saved file to: ${downloadPath}`);
						return downloadPath;
					} catch (e) {
						console.debug('No download triggered within timeout. Checking navigation...');
						await page.waitForLoadState();
						await this._checkAndHandleNavigation(page);
					}
				} else {
					await clickFunc();
					await page.waitForLoadState();
					await this._checkAndHandleNavigation(page);
				}
				return null;
			};

			try {
				return await performClick(() => elementHandle.click({ timeout: 1500 }));
			} catch (e) {
				return await performClick(() => elementHandle.evaluate((el: HTMLElement) => el.click()));
			}
		} catch (e) {
			throw new Error(`Failed to click element: ${JSON.stringify(elementNode)}. Error: ${e}`);
		}
	}

	async getTabsInfo(): Promise<TabInfo[]> {
		const session = await this.getSession();
		const pages = session.context.pages();
		const tabsInfo: TabInfo[] = [];
		for (let pageId = 0; pageId < pages.length; pageId++) {
			const page = pages[pageId];
			const tab = new TabInfo(pageId, page.url(), await page.title());
			tabsInfo.push(tab);
		}
		return tabsInfo;
	}

	async switchToTab(pageId: number): Promise<void> {
		const session = await this.getSession();
		const pages = session.context.pages();
		if (pageId >= pages.length) {
			throw new BrowserError(`No tab found with pageId: ${pageId}`);
		}
		const page = pages[pageId];
		if (!this._isUrlAllowed(page.url())) {
			throw new BrowserError(`Cannot switch to tab with non-allowed URL: ${page.url()}`);
		}
		if (this.browser.config.cdpUrl) {
			const targets = await this._getCdpTargets();
			for (const target of targets) {
				if (target.url === page.url()) {
					this.state.targetId = target.targetId;
					break;
				}
			}
		}
		await page.bringToFront();
		await page.waitForLoadState();
	}

	async createNewTab(url?: string): Promise<void> {
		if (url && !this._isUrlAllowed(url)) {
			throw new BrowserError(`Cannot create new tab with non-allowed URL: ${url}`);
		}
		const session = await this.getSession();
		const newPage = await session.context.newPage();
		await newPage.waitForLoadState();
		if (url) {
			await newPage.goto(url);
			await this._waitForPageAndFramesLoad(1);
		}
		if (this.browser.config.cdpUrl) {
			const targets = await this._getCdpTargets();
			for (const target of targets) {
				if (target.url === newPage.url()) {
					this.state.targetId = target.targetId;
					break;
				}
			}
		}
	}

	async getSelectorMap(): Promise<SelectorMap> {
		const session = await this.getSession();
		if (!session.cachedState) return {} as SelectorMap;
		return session.cachedState.selectorMap;
	}

	async getElementByIndex(index: number): Promise<ElementHandle | null> {
		const selectorMap = await this.getSelectorMap();
		return await this.getLocateElement(selectorMap[index]);
	}

	async getDomElementByIndex(index: number): Promise<DOMElementNode> {
		const selectorMap = await this.getSelectorMap();
		return selectorMap[index];
	}

	async saveCookies(): Promise<void> {
		if (this.session && this.session.context && this.config.cookiesFile) {
			try {
				const cookies = await this.session.context.cookies();
				console.debug(`Saving ${cookies.length} cookies to ${this.config.cookiesFile}`);
				const dirname = path.dirname(this.config.cookiesFile);
				if (dirname) {
					fs.mkdirSync(dirname, { recursive: true });
				}
				fs.writeFileSync(this.config.cookiesFile, JSON.stringify(cookies));
			} catch (e) {
				console.warn(`Failed to save cookies: ${e}`);
			}
		}
	}

	async isFileUploader(elementNode: DOMElementNode, maxDepth: number = 3, currentDepth: number = 0): Promise<boolean> {
		if (currentDepth > maxDepth) return false;
		if (!elementNode) return false;
		if (elementNode.tagName === 'input') {
			return elementNode.attributes?.['type'] === 'file' || elementNode.attributes?.['accept'] !== undefined;
		}
		if (elementNode.children && currentDepth < maxDepth) {
			for (const child of elementNode.children) {
				// Check if child is a DOMElementNode before passing to isFileUploader
				if ('tagName' in child && 'attributes' in child && await this.isFileUploader(child as DOMElementNode, maxDepth, currentDepth + 1)) {
					return true;
				}
			}
		}
		return false;
	}

	async getScrollInfo(page: Page): Promise<[number, number]> {
		const scrollY = await page.evaluate(() => window.scrollY);
		const viewportHeight = await page.evaluate(() => window.innerHeight);
		const totalHeight = await page.evaluate(() => document.documentElement.scrollHeight);
		const pixelsAbove = scrollY;
		const pixelsBelow = totalHeight - (scrollY + viewportHeight);
		return [pixelsAbove, pixelsBelow];
	}

	async resetContext(): Promise<void> {
		const session = await this.getSession();
		const pages = session.context.pages();
		for (const page of pages) {
			await page.close();
		}
		session.cachedState = null;
		this.state.targetId = null;
	}

	private async _getUniqueFilename(directory: string, filename: string): Promise<string> {
		const ext = path.extname(filename);
		const base = path.basename(filename, ext);
		let counter = 1;
		let newFilename = filename;
		while (fs.existsSync(path.join(directory, newFilename))) {
			newFilename = `${base} (${counter})${ext}`;
			counter++;
		}
		return newFilename;
	}

	private async _getCdpTargets(): Promise<any[]> {
		if (!this.browser.config.cdpUrl || !this.session) return [];
		try {
			const pages = this.session.context.pages();
			if (pages.length === 0) return [];
			const cdpSession = await pages[0].context().newCDPSession(pages[0]);
			const result = await cdpSession.send('Target.getTargets');
			await cdpSession.detach();
			return result.targetInfos || [];
		} catch (e) {
			console.debug(`Failed to get CDP targets: ${e}`);
			return [];
		}
	}
}
