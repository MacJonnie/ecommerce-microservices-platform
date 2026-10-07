import { createServer } from "node:http";

const PORT = 3000;
const CATALOG_SERVICE_URL = "http://localhost:3002"; // URL of the Catalog Service

const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");

    if(req.method === "GET" && req.url === "/"){
        res.statusCode = 200;
        res.end(JSON.stringify({ message: "Welcome to the API Gateway!" }));

        return;
    }

    if(req.method === "GET" && req.url === "/health"){
        res.statusCode = 200;
        res.end(JSON.stringify({ 
            status: "OK", 
            service: "api-gateway",
            timestamp: new Date().toISOString() }));
        return;
    }


    // Forward product requests to the Catalog Service
  if (req.method === "GET" && req.url === "/products") {
    try {
      const response = await fetch(
        `${CATALOG_SERVICE_URL}/products`
      );

      const data = await response.json();

      res.statusCode = response.status;
      res.end(JSON.stringify(data));
    } catch (error) {
      res.statusCode = 502;
      res.end(
        JSON.stringify({
          message: "Catalog Service is unavailable"
        })
      );
    }
    return;
  }

    res.statusCode = 404;
    res.end(
        JSON.stringify({
            message: "Route not found",
        })
    );

});

server.listen(PORT, () => {
    console.log(`API Gateway is running on http://localhost:${PORT}`);
});