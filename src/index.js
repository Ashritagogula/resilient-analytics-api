const express = require("express");
require("dotenv").config();

const { redisClient, connectRedis } = require("./config/redis");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8000;

let metrics = [];

/*
 ----------------------------
 Connect Redis
 ----------------------------
*/
connectRedis();

/*
 ----------------------------
 RATE LIMIT
 ----------------------------
*/
const RATE_LIMIT = 5;
const WINDOW_SECONDS = 60;

async function rateLimiter(req, res, next) {
    try {
        const ip = req.ip;
        const key = `rate_limit:${ip}`;

        const currentCount = await redisClient.incr(key);

        if (currentCount === 1) {
            await redisClient.expire(key, WINDOW_SECONDS);
        }

        if (currentCount > RATE_LIMIT) {
            const ttl = await redisClient.ttl(key);
            res.set("Retry-After", ttl);
            return res.status(429).json({
                error: "Too many requests. Try again later."
            });
        }

        next();
    } catch (error) {
        return res.status(500).json({ error: "Rate limiter failure" });
    }
}

/*
 ----------------------------
 CIRCUIT BREAKER
 ----------------------------
*/
const STATES = {
    CLOSED: "CLOSED",
    OPEN: "OPEN",
    HALF_OPEN: "HALF_OPEN"
};

let circuitState = STATES.CLOSED;
let failureCount = 0;
let lastFailureTime = null;

const FAILURE_THRESHOLD = 3;
const RESET_TIMEOUT = 30000; // 30 seconds

async function riskyExternalService() {
    // 50% failure simulation
    if (Math.random() < 0.5) {
        throw new Error("Simulated external failure");
    }
    return { external_data: "success" };
}

async function callWithCircuitBreaker() {
    if (circuitState === STATES.OPEN) {
        const now = Date.now();

        if (now - lastFailureTime > RESET_TIMEOUT) {
            circuitState = STATES.HALF_OPEN;
        } else {
            throw new Error("Circuit is OPEN");
        }
    }

    try {
        const result = await riskyExternalService();

        failureCount = 0;
        circuitState = STATES.CLOSED;

        return result;

    } catch (error) {
        failureCount++;

        if (failureCount >= FAILURE_THRESHOLD) {
            circuitState = STATES.OPEN;
            lastFailureTime = Date.now();
        }

        throw error;
    }
}

/*
 ----------------------------
 HEALTH
 ----------------------------
*/
app.get("/health", (req, res) => {
    res.status(200).json({ status: "OK" });
});

/*
 ----------------------------
 METRICS INGESTION
 ----------------------------
*/
app.post("/api/metrics", rateLimiter, (req, res) => {
    const { timestamp, value, type } = req.body;

    if (!timestamp || typeof value !== "number" || !type) {
        return res.status(400).json({
            error: "Invalid payload"
        });
    }

    metrics.push({ timestamp, value, type });

    res.status(201).json({ message: "Metric stored successfully" });
});

/*
 ----------------------------
 SUMMARY (WITH CACHE)
 ----------------------------
*/
app.get("/api/metrics/summary", async (req, res) => {
    const { type } = req.query;

    if (!type) {
        return res.status(400).json({
            error: "Query parameter 'type' is required"
        });
    }

    const cacheKey = `summary:${type}`;

    try {
        const cachedData = await redisClient.get(cacheKey);

        if (cachedData) {
            return res.status(200).json(JSON.parse(cachedData));
        }

        const filtered = metrics.filter(m => m.type === type);

        if (filtered.length === 0) {
            return res.status(404).json({
                message: "No metrics found"
            });
        }

        const total = filtered.reduce((sum, m) => sum + m.value, 0);
        const average = total / filtered.length;

        const response = {
            type,
            count: filtered.length,
            average_value: average
        };

        await redisClient.setEx(cacheKey, 60, JSON.stringify(response));

        res.status(200).json(response);

    } catch (error) {
        res.status(500).json({ error: "Summary error" });
    }
});

/*
 ----------------------------
 EXTERNAL DATA ENDPOINT
 ----------------------------
*/
app.get("/api/external-data", async (req, res) => {
    try {
        const result = await callWithCircuitBreaker();
        res.status(200).json({
            circuit_state: circuitState,
            data: result
        });
    } catch (error) {
        res.status(503).json({
            circuit_state: circuitState,
            message: "Fallback response: External service unavailable"
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
