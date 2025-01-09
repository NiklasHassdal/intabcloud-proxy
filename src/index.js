import {v4 as uuidv4} from "uuid";
import Knex from "knex";
import http from "http";
import config from "./config.js";

/**
 * @typedef {keyof typeof config.servers} ServerType
 */

/**
 * @typedef ServerInfo
 * @property {string} host
 * @property {number} port
 * @property {number} activeConnections
 */

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
const requestLogQueue = [];

const knex = Knex(config.knex);

knex.migrate.latest()
    .then(() => flushRequestLogs(10000))
    .then(() => removeOldLogs(60000));

/**
 * @param {number} [repeatInterval]
 * @returns {Promise<void>}
 */
async function flushRequestLogs(repeatInterval) {
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

        if (repeatInterval) {
            setTimeout(flushRequestLogs, repeatInterval, repeatInterval);
        }
    } catch (err) {
        console.error(err);
    }
}

/**
 * @param {number} [repeatInterval]
 * @returns {Promise<void>}
 */
async function removeOldLogs(repeatInterval) {
    try {
        /** @type {Map<number, ServerType>} */
        const retentionGroups = new Map();
        for (const [serverType, retention] of Object.entries(config.logRetention)) {
            if (retention > 0) {
                if (retentionGroups[retention]) {
                    retentionGroups[retention].push(serverType);
                } else {
                    retentionGroups[retention] = [serverType];
                }
            }
        }

        if (retentionGroups.size > 0) {
            const now = Date.now();
            const query = knex("requestLogs");
            for (const [retention, serverTypes] of retentionGroups) {
                query.orWhere((builder) => {
                    builder.andWhere("serverType", "in", serverTypes);
                    builder.andWhere("datetime", ">", new Date(now + (retention * 3600000)));
                });
            }
        }

        if (repeatInterval) {
            setTimeout(removeOldLogs, repeatInterval, repeatInterval);
        }
    } catch (err) {
        console.error(err);
    }
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

/**
 * @param {string} servers
 * @returns {ServerInfo[]}
 */
function createServerInfo(servers) {
    return servers.split(/[,;]/).map((item) => {
        const [host, port] = item.trim().split(":", 2);
        return {
            host,
            port:              parseInt(port || "80"),
            activeConnections: 0,
        };
    });
}

/** @type {Record<ServerType, ServerInfo[]>} */
const servers = {
    api:      createServerInfo(config.servers.api),
    ui:       createServerInfo(config.servers.ui),
    wisensys: createServerInfo(config.servers.wisensys),
    novus:    createServerInfo(config.servers.novus),
    comet:    createServerInfo(config.servers.comet),
    gprs:     createServerInfo(config.servers.gprs),
};

const sensitiveProperties = [
    /api[-_]?key/gi,
    /password/gi,
    /cookie/gi,
    /authorization/gi,
    /refreshtoken/gi,
    /accesstoken/gi,
];

/**
 * @param {http.IncomingMessage} req
 * @returns {ServerType}
 */
function getServerType(req) {
    const url = req.url || "/";
    if (url.startsWith("/api/v1")) {
        return "api";
    } else if (url.startsWith("/processor")) {
        return "wisensys";
    } else if (url.startsWith("/plugins/UxxxxM") || url.startsWith("/plugins/Wxxxx") || url.startsWith("/plugins/intabsoap")) {
        return "comet";
    } else if (url.startsWith("/provision") || url.startsWith("/onep:v1") || url === "/timestamp") {
        return "novus";
    } else if (url.startsWith("/IntabWS")) {
        return "gprs";
    } else {
        return "ui";
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
 * @param {http.IncomingMessage} clientReq
 * @param {http.ServerResponse<http.IncomingMessage>} clientRes
 */
async function handleRequest(clientReq, clientRes) {
    const datetime = new Date();
    const serverType = getServerType(clientReq);
    const logRetention = config.logRetention[serverType] || 0;
    const requestChunks = [];
    const responseChunks = [];

    /** @type {ServerInfo} */
    const serverInfo = servers[serverType].reduce((a, b) => a.activeConnections <= b.activeConnections ? a : b);
    serverInfo.activeConnections++;

    /** @type {http.RequestOptions} */
    const targetReqConfig = {
        host:    serverInfo.host,
        port:    serverInfo.port,
        path:    clientReq.url,
        method:  clientReq.method,
        headers: clientReq.headers,
    };

    const targetReq = http.request(targetReqConfig, (targetRes) => {
        clientRes.writeHead(targetRes.statusCode || 500, targetRes.headers);
        targetRes.on("data", (chunk) => {
            responseChunks.push(chunk);
            clientRes.write(chunk);
        }).on("end", () => {
            if (logRetention > 0) {
                requestLogQueue.push({
                    requestLogId:    uuidv4(),
                    serverType,
                    datetime,
                    method:          clientReq.method || "",
                    url:             clientReq.url || "",
                    statusCode:      targetRes.statusCode || -1,
                    duration:        Date.now() - datetime.getTime(),
                    requestHeaders:  clientReq.headers || {},
                    requestBody:     Buffer.concat(requestChunks),
                    responseHeaders: targetRes.headers || {},
                    responseBody:    Buffer.concat(responseChunks),
                });
            }
            clientRes.end();
        });
    }).on("error", () => {
        clientRes.writeHead(500);
        clientRes.end("Internal Server Error");
    }).on("finish", () => {
        serverInfo.activeConnections--;
    });

    clientReq.on("data", (chunk) => {
        requestChunks.push(chunk);
        targetReq.write(chunk);
    }).on("end", () => {
        targetReq.end();
    });
}

const server = http.createServer(handleRequest);

server.listen(config.port, config.host, () => {
    console.log(`Listening on ${config.host}:${config.port}`);
});