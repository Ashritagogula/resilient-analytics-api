const express = require("express");
require("dotenv").config();

const { redisClient, connectRedis } = require("./config/redis");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8000;

/*
 In-memory storage
*/
let metrics = [];

/*
 Connect to Redis
*/
connectRedis();

/*
 Health Endpoint
*/
app.get("/health", (req, res) => {
    res.status(200).json({ status: "OK" });
});

/*
 POST /api/metrics
*/
app.post("/api/metrics", (req, res) => {
    const { timestamp, value, type } = req.body;

    if (!timestamp || typeof value !== "number" || !type) {
        return res.status(400).json({
            error: "Invalid payload. Required: timestamp (string), value (number), type (string)"
        });
    }

    metrics.push({ timestamp, value, type });

    return res.status(201).json({
        message: "Metric stored successfully"
    });
});

/*
 GET /api/metrics/summary
 With Redis Caching
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
        // 1️⃣ Check cache
        const cachedData = await redisClient.get(cacheKey);

        if (cachedData) {
            console.log("Serving from cache");
            return res.status(200).json(JSON.parse(cachedData));
        }

        // 2️⃣ Compute summary
        const filteredMetrics = metrics.filter(m => m.type === type);

        if (filteredMetrics.length === 0) {
            return res.status(404).json({
                message: "No metrics found for this type"
            });
        }

        const total = filteredMetrics.reduce((sum, m) => sum + m.value, 0);
        const average = total / filteredMetrics.length;

        const response = {
            type: type,
            count: filteredMetrics.length,
            average_value: average
        };

        // 3️⃣ Store in Redis (TTL 60 sec)
        await redisClient.setEx(cacheKey, 60, JSON.stringify(response));

        console.log("Computed and cached result");

        return res.status(200).json(response);

    } catch (error) {
        console.error("Error in summary endpoint:", error);
        return res.status(500).json({
            error: "Internal Server Error"
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
