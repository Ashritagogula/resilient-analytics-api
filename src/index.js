const express = require("express");
const { connectRedis } = require("./config/redis");
require("dotenv").config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8000;

/*
 In-memory storage for metrics
 Each metric:
 {
   timestamp: string,
   value: number,
   type: string
 }
*/
let metrics = [];

/*
 Health Check Endpoint
*/
app.get("/health", (req, res) => {
    res.status(200).json({ status: "OK" });
});

/*
 POST /api/metrics
 Stores incoming metric data
*/
app.post("/api/metrics", (req, res) => {
    const { timestamp, value, type } = req.body;

    // Basic validation
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
 Returns average value for given type
 Example:
 /api/metrics/summary?type=cpu_usage
*/
app.get("/api/metrics/summary", (req, res) => {
    const { type } = req.query;

    if (!type) {
        return res.status(400).json({
            error: "Query parameter 'type' is required"
        });
    }

    const filteredMetrics = metrics.filter(m => m.type === type);

    if (filteredMetrics.length === 0) {
        return res.status(404).json({
            message: "No metrics found for this type"
        });
    }

    const total = filteredMetrics.reduce((sum, m) => sum + m.value, 0);
    const average = total / filteredMetrics.length;

    return res.status(200).json({
        type: type,
        count: filteredMetrics.length,
        average_value: average
    });
});
connectRedis();

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
