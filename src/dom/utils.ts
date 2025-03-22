// utils.ts
// A simple logger is used here; you can swap this with your preferred logging library.
const logger = {
    debug: console.debug.bind(console),
};

/**
 * Wraps a synchronous function so that its execution time is logged.
 *
 * @param additionalText Optional text to include in the log message.
 * @returns A higher-order function that wraps the original function.
 */
export function timeExecutionSync<T extends (...args: any[]) => any>(
    additionalText: string = ""
): (func: T) => T {
    return function (func: T): T {
        return ((...args: Parameters<T>): ReturnType<T> => {
            const startTime = Date.now();
            const result = func(...args);
            const executionTime = (Date.now() - startTime) / 1000;
            logger.debug(`${additionalText} Execution time: ${executionTime.toFixed(2)} seconds`);
            return result;
        }) as T;
    };
}

/**
 * Wraps an asynchronous function so that its execution time is logged.
 *
 * @param additionalText Optional text to include in the log message.
 * @returns A higher-order function that wraps the original async function.
 */
export function timeExecutionAsync<T extends (...args: any[]) => Promise<any>>(
    additionalText: string = ""
): (func: T) => T {
    return function (func: T): T {
        return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
            const startTime = Date.now();
            const result = await func(...args);
            const executionTime = (Date.now() - startTime) / 1000;
            logger.debug(`${additionalText} Execution time: ${executionTime.toFixed(2)} seconds`);
            return result;
        }) as T;
    };
}

/**
 * A class decorator that turns a class into a singleton.
 * Only one instance of the decorated class will ever be created.
 *
 * @param constructor The target class constructor.
 * @returns A new constructor that always returns the same instance.
 */
export function singleton<T extends { new(...args: any[]): any }>(constructor: T): T {
    let instance: any;
    return class extends constructor {
        constructor(...args: any[]) {
            if (instance) {
                return instance;
            }
            super(...args);
            instance = this;
        }
    };
}
