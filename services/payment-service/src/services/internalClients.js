import axios from "axios";

// Shared authentication for service-to-service requests.
const internalHeaders = () => ({
  "x-internal-service-token": process.env.INTERNAL_SERVICE_TOKEN,
});

const serviceUrl = (environmentVariable, fallback) =>
  (process.env[environmentVariable] || fallback).replace(/\/$/, "");

/** Retrieve an order through the Order Service's protected internal API. */
export async function getOrder(orderId) {
  const baseUrl = serviceUrl("ORDER_SERVICE_URL", "http://localhost:3004");
  const response = await axios.get(`${baseUrl}/internal/orders/${orderId}`, {
    headers: internalHeaders(),
    timeout: 10000,
  });
  return response.data.order;
}

/** Retrieve a user profile through the User Service's protected internal API. */
export async function getUser(userId) {
  const baseUrl = serviceUrl("USER_SERVICE_URL", "http://localhost:3001");
  const response = await axios.get(`${baseUrl}/internal/users/${userId}`, {
    headers: internalHeaders(),
    timeout: 10000,
  });
  return response.data.user;
}

/** Update payment fields on an order through its internal API. */
export async function updateOrderPayment(orderId, payload) {
  const baseUrl = serviceUrl("ORDER_SERVICE_URL", "http://localhost:3004");
  return axios.post(
    `${baseUrl}/internal/orders/${orderId}/payment-status`,
    payload,
    { headers: internalHeaders(), timeout: 10000 }
  );
}

/** Enqueue an email notification through the Notification Service. */
export async function notify(payload) {
  const baseUrl = serviceUrl("NOTIFICATION_SERVICE_URL", "http://localhost:3006");
  return axios.post(`${baseUrl}/internal/notifications`, payload, {
    headers: internalHeaders(),
    timeout: 10000,
  });
}
