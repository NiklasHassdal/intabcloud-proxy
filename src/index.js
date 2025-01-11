import {v4 as uuidv4} from "uuid";
import http from "http";
import config from "./config.js";
import {flushRequestLogs, removeOldLogs, requestLogQueue} from "./logging.js";

/**
 * @typedef {keyof typeof config.servers} ServerType
 */

/**
 * @typedef ServerInfo
 * @property {string} host
 * @property {number} port
 * @property {number} activeConnections
 */

const logFlushTimer = setInterval(flushRequestLogs, 10000);
const logRemoveTimer = setInterval(removeOldLogs, 60000);

process.once("SIGINT", () => {
    clearInterval(logFlushTimer);
    clearInterval(logRemoveTimer);
});

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
        headers: {
            ...clientReq.headers,
            "x-forwarded-for": clientReq.socket.remoteAddress,
        },
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