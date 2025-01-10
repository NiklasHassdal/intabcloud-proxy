import config from "./config.js";
import {knex} from "./database.js";
import {logError} from "./errorHandling.js";

/**
 * @typedef RequestLog
 * @property {string} requestLogId
 * @property {string} serverType
 * @property {Date} datetime
 * @property {string} method
 * @property {string} url
 * @property {number} statusCode
 * @property {number} duration
 * @property {Record<string, any>} requestHeaders
 * @property {Buffer | null} requestBody
 * @property {Record<string, any>} responseHeaders
 * @property {Buffer | null} responseBody
 */

/**
  * @typedef KeyValue
  * @property {string} requestLogId
  * @property {string} type
  * @property {string} key
  * @property {any} value
  */

/** @type {RequestLog[]} */
export const requestLogQueue = [];

/** @type {RegExp[]} */
export const sensitiveProperties = [
    /api[-_]?key/gi,
    /password/gi,
    /cookie/gi,
    /authorization/gi,
    /refreshtoken/gi,
    /accesstoken/gi,
];

/**
 * @returns {Promise<void>}
 */
export async function flushRequestLogs() {
    try {
        const requestLogs = requestLogQueue.splice(0, requestLogQueue.length);
        const keyValues = [];

        for (const {requestLogId, requestHeaders, requestBody} of requestLogs.map(hideSensitiveInfo)) {
            if (!requestBody) {
                continue;
            }
            const contentType = (requestHeaders["content-type"] || "").toLowerCase();
            if (contentType.startsWith("application/json")) {
                try {
                    const text = requestBody.toString("utf-8");
                    const json = hideSensitiveInfo(JSON.parse(text));
                    keyValues.push(...getKeyValues(requestLogId, json));
                } catch {
                    // Do nothing
                }
            }
        }

        for (let i = 0; i < requestLogs.length; i += 10) {
            await knex("requestLogs").insert(requestLogs.slice(i, i + 10));
        }

        for (let i = 0; i < keyValues.length; i += 100) {
            await knex("keyValues").insert(keyValues.slice(i, i + 100));
        }
    } catch (err) {
        console.error(err);
    }
}

/**
 * @returns {Promise<void>}
 */
export async function removeOldLogs() {
    const now = Date.now();
    for (const [serverType, retention] of Object.entries(config.logRetention)) {
        if (retention > 0) {
            await knex("requestLogs")
                .delete()
                .where("serverType", serverType)
                .andWhere("datetime", "<", new Date(now - (retention * 1000)))
                .catch(logError);
        }
    }
}

/**
 * @param {any} data
 * @returns {any}
 */
function hideSensitiveInfo(data) {
    if (data && typeof data === "object") {
        if (Array.isArray(data)) {
            data.forEach(hideSensitiveInfo);
        } else {
            for (const key of Object.keys(data)) {
                if (sensitiveProperties.some((regex) => regex.test(key))) {
                    data[key] = "<hidden>";
                } else {
                    hideSensitiveInfo(data[key]);
                }
            }
        }
    }
    return data;
}

/**
 * @param {string} requestLogId
 * @param {any} value
 * @param {string} [key]
 * @returns {KeyValue[]}
 */
function getKeyValues(requestLogId, value, key) {
    if (value && typeof value === "object" && !(value instanceof Date)) {
        const result = [];
        for (const subKey in value) {
            const mergedKey = key
                ? `${key}[${encodeURIComponent(subKey)}]`
                : encodeURIComponent(subKey);
            result.push(...getKeyValues(requestLogId, value[subKey], mergedKey));
        }
        return result;
    } else if (!key || value === undefined) {
        return [];
    } else if (value instanceof Date) {
        return [{requestLogId, type: "datetime", key, value: value.toISOString()}];
    } else {
        return [{requestLogId, type: typeof value, key, value: value.toString()}];
    }
}