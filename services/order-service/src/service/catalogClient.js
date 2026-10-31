
 // Returns the base URL of the Catalog Service.
 // Uses the environment variable if configured; otherwise,
 // defaults to the local development URL.
const baseUrl = () =>
  (
    process.env.CATALOG_SERVICE_URL ||
    "http://localhost:3002"
  ).replace(/\/$/, "");

// Sends an authenticated internal POST request to the Catalog Service.
async function post(path, body) {
  // Retrieve the shared secret used for service-to-service authentication.
  const token = process.env.INTERNAL_SERVICE_TOKEN;

  // Prevent internal requests from being sent without the required token.
  if (!token) {
    throw new Error("INTERNAL_SERVICE_TOKEN is not configured");
  }

  // Send the request with a JSON body and the internal authentication header.
  const response = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-service-token": token,
    },
    body: JSON.stringify(body),

    // Abort the request if the Catalog Service takes longer than 10 seconds.
    signal: AbortSignal.timeout(10000),
  });

  // Parse the JSON response. Use an empty object if the response
  // body is empty or contains invalid JSON.
  const data = await response.json().catch(() => ({}));

  // Convert unsuccessful HTTP responses into errors so the calling
  // controller can handle them.
  if (!response.ok) {
    const error = new Error(
      data.message || `Catalog request failed (${response.status})`
    );

    // Preserve the HTTP status code for error handling upstream.
    error.statusCode = response.status;
    throw error;
  }

  // Return the parsed response data to the caller.
  return data;
}

// Requests the Catalog Service to reserve stock for an order.
// The reservation ID allows the reservation to be tracked.
export const reserveInventory = (reservationId, items) =>
  post("/internal/inventory/reservations", {
    reservationId,
    items,
  });

// Requests the Catalog Service to release stock associated
// with an existing inventory reservation.
export const releaseInventory = (reservationId, items) =>
  post("/internal/inventory/releases", {
    reservationId,
    items,
  });

// Retrieves a product's details from the Catalog Service
// using its product ID.
export async function getProduct(productId) {
  // Send a GET request to the product endpoint.
  const response = await fetch(
    `${baseUrl()}/api/products/${productId}`,
    {
      // Prevent the request from waiting indefinitely.
      signal: AbortSignal.timeout(10000),
    }
  );

  // Parse the response body, falling back to an empty object
  // if the body is empty or invalid JSON.
  const data = await response.json().catch(() => ({}));

  // Treat unsuccessful HTTP responses or missing product data
  // as errors.
  if (!response.ok || !data.product) {
    const error = new Error(
      data.message || "Product not found."
    );

    // Use the HTTP status code, or 502 if no status is available.
    error.statusCode = response.status || 502;
    throw error;
  }

  // Return the product object for use by the Order Service.
  return data.product;
}
