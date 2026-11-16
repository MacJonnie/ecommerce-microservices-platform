import axios from "axios";

/** Send an event to the internal Notification Service. */
export async function enqueueNotification(payload) {
  const baseUrl = (
    process.env.NOTIFICATION_SERVICE_URL || "http://localhost:3006"
  ).replace(/\/$/, "");

  return axios.post(`${baseUrl}/internal/notifications`, payload, {
    headers: {
      "x-internal-service-token": process.env.INTERNAL_SERVICE_TOKEN,
    },
    timeout: 10000,
  });
}
