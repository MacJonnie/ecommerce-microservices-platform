
 // Resolve the Cart Service base URL.
// Remove a trailing slash to prevent duplicate slashes in request URLs.
const baseUrl = () =>
  (
    process.env.CART_SERVICE_URL || "http://localhost:3003"
  ).replace(/\/$/, "");

// Shared HTTP request helper for Cart Service operations.
async function request(path, method = "GET", body) {
  // Retrieve the internal service authentication token.
  const token = process.env.INTERNAL_SERVICE_TOKEN;

  // Ensure internal service authentication is configured.
  if (!token) {
    throw new Error("INTERNAL_SERVICE_TOKEN is not configured");
  }

  // Send the HTTP request to the Cart Service.
  const response = await fetch(`${baseUrl()}${path}`, {
    method,

    // Include internal authentication and JSON headers.
    headers: {
      "x-internal-service-token": token,
      "content-type": "application/json",
    },

    // Include the request body only when one is provided.
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),

    // Abort the request if it takes longer than 10 seconds.
    signal: AbortSignal.timeout(10000),
  });

  // Parse the response body.
  // Return an empty object if the response is not valid JSON.
  const data = await response.json().catch(() => ({}));

  // Handle unsuccessful HTTP responses.
  if (!response.ok) {
    const e = new Error(
      data.message || `Cart Service request failed (${response.status})`
    );

    // Preserve the HTTP status for upstream error handling.
    e.statusCode = response.status;

    throw e;
  }

  // Return the parsed response data.
  return data;
}

// Retrieve a customer's cart through the internal Cart Service endpoint.
export async function getCart(userId) {
  const data = await request(
    `/internal/carts/${encodeURIComponent(userId)}`
  );

  // Ensure the Cart Service returned a valid cart structure.
  if (!data.cart || !Array.isArray(data.cart.items)) {
    throw new Error(
      "Cart Service returned an invalid cart response"
    );
  }

  return data.cart;
}

// Clear a customer's cart conditionally using its expected revision.
// Prevents clearing cart contents that changed during checkout.

export async function clearCart(userId, expectedRevision) {
  // TEMPORARY TEST: Simulate a Cart Service failure during checkout.
  // Cart retrieval remains functional; only cart clearing fails.
  // throw new Error("TEST_FAILURE: Simulated cart-clear outage");

  // Original implementation (restore after testing).
  return request(
    `/internal/carts/${encodeURIComponent(userId)}`,
    "DELETE",
    { expectedRevision }
  );
}

